// DevTools trace of the old Home vs the new Home DOM (tests/bench-vidaa-home-trace.html), per key
// press: Recalculate Style, Layout, Paint, Layerize, Commit, Rasterize, Decode Image and the
// compositor layer count. Desktop Chrome with software raster/compositing and a VIDAA UA: it
// ranks rendering work, it is not a TV measure (the TV Diagnostic is).
// Usage: node tests/bench-vidaa-home-trace.mjs [--cpu=4] [--depth] [--hero] [--big] [--layers] [--json=out.json]
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const arg = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const cpu = Number(arg("cpu", 4));
const depth = process.argv.includes("--depth");
const showLayers = process.argv.includes("--layers");
// --hero: the hero artwork changes 150 ms after each press (calm focus), as on the TV between taps.
const hero = process.argv.includes("--hero");
const big = process.argv.includes("--big");
const browserPath =
  process.env.NUVIO_TV_TEST_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIDAA_UA =
  "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.5563.111 Safari/537.36 VIDAA/9.0(Hisense;SmartTV;55U67LEVS)";
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
const server = http.createServer(async (request, response) => {
  const file = path.resolve(workspace, `.${decodeURIComponent(new URL(request.url, "http://x/").pathname)}`);
  if (!file.startsWith(workspace) || !types[path.extname(file)]) return response.writeHead(404).end();
  try {
    response.writeHead(200, { "Content-Type": types[path.extname(file)] }).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Main-thread and raster events summed per press (trace event names of Chrome's timeline).
const EVENTS = {
  style: ["UpdateLayoutTree"],
  layout: ["Layout"],
  prePaint: ["PrePaint"],
  paint: ["Paint"],
  layerize: ["Layerize", "UpdateLayer", "CompositeLayers"],
  commit: ["Commit"],
  raster: ["RasterTask"],
  decode: ["Decode Image", "ImageDecodeTask"]
};

async function run(which, scenario) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "nuvio-trace-"));
  const child = spawn(
    browserPath,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      "--window-size=1920,1080",
      "--force-device-scale-factor=1",
      "--disable-gpu",
      "--disable-gpu-rasterization",
      "--disable-gpu-compositing",
      "--disable-extensions",
      "--no-first-run",
      `--user-agent=${VIDAA_UA}`,
      `--user-data-dir=${profile}`,
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] }
  );
  let id = 0;
  let buffer = "";
  const pending = new Map();
  const listeners = [];
  child.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(Error(message.error.message)) : resolve(message.result);
      } else listeners.forEach((listener) => listener(message));
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const commandId = ++id;
      pending.set(commandId, { resolve, reject });
      child.stdio[3].write(`${JSON.stringify({ id: commandId, method, params, sessionId })}\0`);
    });
  try {
    const query = `home=${which}${depth ? "&depth=1" : ""}${hero ? "&hero=1" : ""}${big ? "&big=1" : ""}`;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: 4 });
    await page("Page.enable");
    await page("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/tests/bench-vidaa-home-trace.html?${query}` });
    for (let n = 0; ; n += 1) {
      const { result } = await page("Runtime.evaluate", { expression: "Boolean(window.bench?.ready)", returnByValue: true });
      if (result.value) break;
      if (n > 200) throw Error(`${which}: bench not ready`);
      await delay(50);
    }
    await delay(2500);
    let layers = 0;
    let maxLayers = 0;
    let lastTree = [];
    listeners.push((message) => {
      if (message.method === "LayerTree.layerTreeDidChange" && message.params.layers) {
        lastTree = message.params.layers;
        layers = message.params.layers.length;
        maxLayers = Math.max(maxLayers, layers);
      }
    });
    await page("LayerTree.enable");
    await delay(300);
    const layersBefore = layers;
    await page("Emulation.setCPUThrottlingRate", { rate: cpu });
    const events = [];
    let done;
    const complete = new Promise((resolve) => (done = resolve));
    listeners.push((message) => {
      if (message.method === "Tracing.dataCollected") events.push(...message.params.value);
      if (message.method === "Tracing.tracingComplete") done();
    });
    await page("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        includedCategories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "blink",
          "cc",
          "toplevel"
        ]
      }
    });
    // "right*" is a held key: a repeat every 90 ms (the Diagnostic driver's REPEAT_MS).
    for (const key of scenario) {
      await page("Runtime.evaluate", { expression: `bench.step(${JSON.stringify(key.replace("*", ""))})` });
      await delay(key.endsWith("*") ? 90 : 360);
    }
    await delay(600);
    await page("Tracing.end");
    await complete;
    const { result } = await page("Runtime.evaluate", { expression: "bench.counts()", returnByValue: true });
    // Why each compositor layer exists (LayerTree.compositingReasons), tallied.
    const reasons = {};
    const owners = {};
    let layerPx = 0;
    for (const layer of lastTree) {
      const { compositingReasonIds = [] } = await page("LayerTree.compositingReasons", { layerId: layer.layerId }).catch(() => ({}));
      for (const reason of compositingReasonIds.length ? compositingReasonIds : ["none"]) reasons[reason] = (reasons[reason] || 0) + 1;
      if (layer.drawsContent) layerPx += layer.width * layer.height;
      if (!showLayers || !layer.backendNodeId) continue;
      const { node } = await page("DOM.describeNode", { backendNodeId: layer.backendNodeId }).catch(() => ({}));
      const attrs = node?.attributes || [];
      const owner = `${node?.localName || "?"}.${String(attrs[attrs.indexOf("class") + 1] || "").split(" ").slice(0, 2).join(".")}`;
      owners[owner] = (owners[owner] || 0) + 1;
    }
    // Renderer main thread of the page: the CrRendererMain with the most work.
    const names = new Map();
    for (const event of events)
      if (event.ph === "M" && event.name === "thread_name") names.set(`${event.pid}:${event.tid}`, event.args.name);
    const totals = Object.fromEntries(Object.keys(EVENTS).map((key) => [key, 0]));
    const stacks = new Map();
    const mainWork = new Map();
    const tasks = new Map();
    const add = (event, dur) => {
      const thread = `${event.pid}:${event.tid}`;
      const threadName = names.get(thread) || "";
      if (event.name === "RunTask" && threadName === "CrRendererMain") {
        if (!tasks.has(thread)) tasks.set(thread, []);
        tasks.get(thread).push(dur);
      }
      for (const [key, list] of Object.entries(EVENTS)) {
        if (!list.includes(event.name)) continue;
        if (key !== "raster" && key !== "decode" && threadName !== "CrRendererMain") continue;
        totals[key] += dur;
        if (threadName === "CrRendererMain") mainWork.set(thread, (mainWork.get(thread) || 0) + dur);
      }
    };
    for (const event of events) {
      if (event.ph === "X") add(event, event.dur || 0);
      else if (event.ph === "B") {
        const key = `${event.pid}:${event.tid}`;
        if (!stacks.has(key)) stacks.set(key, []);
        stacks.get(key).push(event);
      } else if (event.ph === "E") {
        const begin = stacks.get(`${event.pid}:${event.tid}`)?.pop();
        if (begin) add(begin, event.ts - begin.ts);
      }
    }
    const main = [...mainWork.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mainTasks = tasks.get(main) || [];
    const per = (us) => Math.round((us / 1000 / scenario.length) * 100) / 100;
    return {
      which,
      perPressMs: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, per(value)])),
      longTasks: mainTasks.filter((dur) => dur > 50000).length,
      maxTaskMs: Math.round(Math.max(0, ...mainTasks) / 100) / 10,
      layers: { before: layersBefore, max: maxLayers, after: layers, drawnMpx: Math.round(layerPx / 1e4) / 100, reasons, ...(showLayers ? { owners } : {}) },
      ...result.value
    };
  } finally {
    child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// Diagnostic-like: taps (360 ms apart) then a hold (90 ms repeats).
const horizontal = [...Array(5).fill("right"), ...Array(12).fill("right*"), ...Array(5).fill("left")];
const vertical = [...Array(3).fill("down"), ...Array(3).fill("down*"), ...Array(4).fill("up"), "down", "down"];
const results = [];
try {
  for (const [label, scenario] of [["horizontal", horizontal], ["vertical", vertical]])
    for (const which of ["old", "new"]) {
      const result = { scenario: label, cpu, depth, hero, big, ...(await run(which, scenario)) };
      results.push(result);
      console.log(JSON.stringify(result));
    }
} finally {
  server.close();
}
const out = arg("json", "");
if (out) await writeFile(out, JSON.stringify(results, null, 2));
