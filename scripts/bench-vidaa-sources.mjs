// Sources screen bench: runs tests/test-vidaa-sources-bench.html in headless
// Chrome with the VIDAA user agent and CPU throttling, three passes, medians.
// Desktop Chrome under emulated slowdown: comparable between implementations,
// never a TV measurement.
//   node scripts/bench-vidaa-sources.mjs [--runs=3] [--cpu=20] [--variant=on] [--json]
// --variant=on benches the new Sources screen (beta) instead of the current one.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const option = (name, fallback) =>
  Number(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1]) || fallback;
const RUNS = option("runs", 3);
const CPU = option("cpu", 20);
const VARIANT = process.argv.includes("--variant=on") ? "on" : "off";
const VIDAA_UA =
  "Mozilla/5.0 (Linux; VIDAA/9.0; Hisense 65U7Q) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36";
// 1x1 PNG served for external badge images so runs never depend on the network.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2"
};

async function findBrowser() {
  for (const candidate of [
    process.env.NUVIO_TV_TEST_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* next */
    }
  }
  throw Error("Chrome not found. Set NUVIO_TV_TEST_BROWSER.");
}

// Loopback static server over the source checkout (port chosen by the OS).
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1/").pathname);
    const file = path.resolve(workspace, `.${pathname}`);
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type || path.relative(workspace, file).startsWith("..")) throw Error("denied");
    const contents = await readFile(file);
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});

async function runPass(browser, profile, url) {
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      "--window-size=1920,1080",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--mute-audio",
      `--user-data-dir=${profile}`,
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] }
  );
  const pending = new Map();
  let nextId = 0;
  let buffer = "";
  let sessionId;
  let intercepted = 0;
  const send = (method, params = {}, session) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdio[3].write(
        `${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`
      );
    });
  child.on("close", () => pending.forEach(({ reject }) => reject(Error("browser closed"))));
  child.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.method === "Fetch.requestPaused") {
        const { requestId, resourceType } = message.params;
        intercepted++;
        void (
          resourceType === "Image"
            ? send(
                "Fetch.fulfillRequest",
                {
                  requestId,
                  responseCode: 200,
                  responseHeaders: [{ name: "Content-Type", value: "image/png" }],
                  body: PIXEL
                },
                message.sessionId
              )
            : send(
                "Fetch.failRequest",
                { requestId, errorReason: "BlockedByClient" },
                message.sessionId
              )
        ).catch(() => {});
        continue;
      }
      const command = pending.get(message.id);
      if (!command) continue;
      pending.delete(message.id);
      if (message.error) command.reject(Error(message.error.message));
      else command.resolve(message.result);
    }
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (exceptionDetails)
      throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const metrics = async () =>
    Object.fromEntries(
      (await send("Performance.getMetrics", {}, sessionId)).metrics.map(({ name, value }) => [
        name,
        value
      ])
    );
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
    await send("Emulation.setUserAgentOverride", { userAgent: VIDAA_UA }, sessionId);
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] }, sessionId);
    await send("Performance.enable", {}, sessionId);
    await send("Page.navigate", { url }, sessionId);
    const deadline = Date.now() + 60000;
    for (;;) {
      // The context is replaced while navigating; retry until the page answers.
      const state = await evaluate(
        "({ ready: window.__benchReady === true, error: window.__benchError || '' })"
      ).catch(() => null);
      if (state?.error) throw Error(state.error);
      if (state?.ready) break;
      if (Date.now() > deadline) throw Error("bench page did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const info = await evaluate("window.__benchInfo");
    // Throttle only the measured phases, not module loading.
    await send("Emulation.setCPUThrottlingRate", { rate: CPU }, sessionId);
    const phases = {};
    for (const name of await evaluate("window.__bench.phases")) {
      const before = await metrics();
      const result = await evaluate(`window.__bench.run(${JSON.stringify(name)})`);
      const after = await metrics();
      const delta = (key) => Math.round((after[key] - before[key]) * 10000) / 10;
      phases[name] = {
        ...result,
        taskMs: delta("TaskDuration"),
        scriptMs: delta("ScriptDuration"),
        layoutMs: delta("LayoutDuration"),
        styleMs: delta("RecalcStyleDuration")
      };
    }
    return { info: { ...info, externalRequests: intercepted }, phases };
  } finally {
    child.kill("SIGKILL");
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

let profileRoot;
try {
  const browser = await findBrowser();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  profileRoot = await mkdtemp(path.join(os.tmpdir(), "nuvio-sources-bench-"));
  const url = `http://127.0.0.1:${server.address().port}/tests/test-vidaa-sources-bench.html?variant=${VARIANT}`;
  const passes = [];
  for (let run = 0; run < RUNS; run++) {
    passes.push(await runPass(browser, path.join(profileRoot, String(run)), url));
    console.error(`pass ${run + 1}/${RUNS} done`);
  }
  const phases = {};
  for (const name of Object.keys(passes[0].phases)) {
    phases[name] = {};
    for (const [key, value] of Object.entries(passes[0].phases[name])) {
      phases[name][key] =
        typeof value === "number" ? median(passes.map((pass) => pass.phases[name][key])) : value;
    }
  }
  const report = {
    variant: VARIANT,
    cpuThrottle: CPU,
    runs: RUNS,
    userAgent: VIDAA_UA,
    ...passes[0].info,
    phases
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `Sources bench, variant ${VARIANT} (medians of ${RUNS}, CPU x${CPU}, ${report.streams} streams / ${report.addons} addons, ${report.badgeFilters} badge filters, ${report.externalRequests} external requests stubbed). Desktop Chrome, not a TV measure.`
    );
    for (const [name, values] of Object.entries(phases)) {
      console.log(
        `${name}: ${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")}`
      );
    }
  }
} finally {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (profileRoot && path.basename(profileRoot).startsWith("nuvio-sources-bench-"))
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
