import {
  ENGINES,
  SCENES,
  PERIOD,
  ANIMATION,
  WIDTH,
  HEIGHT,
  frameStats,
  stats,
  roundMs
} from "./protocol.js";
import { sceneAt, preload, checksum } from "./scene.js";
const loaders = {
  dom: () => import("./adapters/dom.js"),
  react: () => import("./adapters/react.js"),
  vue: () => import("./adapters/vue.js"),
  svelte: () => import("./adapters/svelte.js"),
  solid: () => import("./adapters/solid.js"),
  canvas2d: () => import("./adapters/canvas2d.js"),
  "lightning-webgl": () => import("./adapters/lightning.js"),
  "lightning-canvas": () => import("./adapters/lightning.js")
};
const params = new URLSearchParams(location.search),
  engine = params.get("engine"),
  token = params.get("token");
const post = (type, data = {}) => parent.postMessage({ type, token, ...data }, location.origin);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
let cancelled = false,
  adapter,
  images,
  assetsMs,
  moduleMs,
  mountMs,
  hidden = false,
  resized = false;
const heap = () => performance.memory?.usedJSHeapSize ?? null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hidden = true;
});
window.addEventListener("resize", () => {
  if (innerWidth !== WIDTH || innerHeight !== HEIGHT) resized = true;
});
window.addEventListener(
  "error",
  () => {
    post("error", { error: "runtime-or-resource-error" });
  },
  true
);
window.addEventListener("unhandledrejection", () => {
  post("error", { error: "unhandled-rejection" });
});
async function measure(scene, config) {
  const sceneErrors = [],
    frames = [],
    dispatch = [],
    commit = [],
    nextFrame = [],
    longTasks = [],
    actions = [];
  let nodes = sceneAt(scene, 0),
    active = false,
    raf = 0,
    last = 0;
  await adapter.update(nodes);
  await wait(Math.max(config.warmup, ANIMATION + 80));
  // Exercise the same short trajectory before every timed scene, not just the
  // first engine. Reset and allow native animations to settle before timing.
  if (scene !== "idle")
    for (let i = 1; i <= 3; i++) {
      await adapter.update(sceneAt(scene, i));
      await wait(PERIOD);
    }
  await adapter.update(nodes);
  await wait(ANIMATION + 80);
  const before = adapter.inspect(nodes);
  if (!before.ok) sceneErrors.push(...before.issues);
  let observer = null;
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (active) longTasks.push([roundMs(e.startTime), roundMs(e.duration)]);
    });
    observer.observe({ type: "longtask" });
  }
  const draw = (now) => {
    if (!active) return;
    if (last) frames.push(roundMs(now - last));
    last = now;
    raf = requestAnimationFrame(draw);
  };
  const started = performance.now(),
    memoryBefore = heap();
  active = true;
  raf = requestAnimationFrame(draw);
  const period = scene === "hero" ? 480 : PERIOD,
    expected = scene === "idle" ? 0 : Math.floor((config.duration - ANIMATION) / period);
  for (let i = 1; i <= expected && !cancelled; i++) {
    const due = started + i * period;
    await wait(Math.max(0, due - performance.now()));
    if (cancelled) break;
    const issued = performance.now();
    nodes = sceneAt(scene, i);
    const built = performance.now();
    await adapter.update(nodes);
    const committed = performance.now();
    const next = await frame();
    dispatch.push(roundMs(issued - due));
    commit.push(roundMs(committed - issued));
    nextFrame.push(roundMs(next - due));
    actions.push([
      roundMs(due - started),
      roundMs(issued - started),
      roundMs(built - issued),
      roundMs(committed - issued),
      roundMs(next - started)
    ]);
    // Validation stays outside the timed frame interval; all final nodes are
    // inspected below. No screenshots or DOM geometry reads in the hot loop.
  }
  await wait(Math.max(ANIMATION + 50, started + config.duration - performance.now()));
  const ended = performance.now();
  active = false;
  cancelAnimationFrame(raf);
  if (observer) {
    for (const e of observer.takeRecords())
      if (e.startTime >= started && e.startTime < ended)
        longTasks.push([roundMs(e.startTime), roundMs(e.duration)]);
    observer.disconnect();
  }
  const after = adapter.inspect(nodes);
  if (!after.ok) sceneErrors.push(...after.issues);
  if (hidden) sceneErrors.push("document-hidden");
  if (resized) sceneErrors.push("viewport-changed");
  if (cancelled) sceneErrors.push("cancelled");
  const valid = !sceneErrors.length && frames.length > 5 && actions.length === expected;
  return {
    scene,
    valid,
    errors: [...new Set(sceneErrors)],
    durationMs: roundMs(ended - started),
    expectedDurationMs: config.duration,
    expectedActions: expected,
    completedActions: actions.length,
    frame: frameStats(frames, config.frameBudget),
    input: stats(nextFrame),
    dispatch: stats(dispatch),
    commit: stats(commit),
    raw: { frames, actions, longTasks },
    longTasksSupported: Boolean(observer),
    blockingMs: roundMs(longTasks.reduce((s, e) => s + Math.max(0, e[1] - 50), 0)),
    memoryBefore,
    memoryAfter: heap(),
    validation: { before, after, expectedChecksum: checksum(nodes) }
  };
}
async function run(config) {
  const scenes = [];
  const start = performance.now();
  try {
    for (const scene of config.scenes || SCENES) {
      if (cancelled) break;
      post("progress", { scene });
      scenes.push(await measure(scene, config));
    }
    post("result", {
      result: {
        engine,
        status:
          !cancelled &&
          scenes.length === (config.scenes || SCENES).length &&
          scenes.every((s) => s.valid)
            ? "valid"
            : "invalid",
        assetsMs,
        moduleMs,
        mountMs,
        elapsedMs: roundMs(performance.now() - start),
        info: adapter.info || { engine: "DOM" },
        scenes,
        resources: performance
          .getEntriesByType("resource")
          .map((r) => ({
            name: new URL(r.name).pathname.split("/").pop(),
            duration: roundMs(r.duration),
            transfer: r.transferSize,
            encoded: r.encodedBodySize,
            decoded: r.decodedBodySize
          }))
          .slice(0, 120)
      }
    });
  } catch {
    post("error", { error: "trial-execution-failed", partial: scenes });
  }
}
window.addEventListener("message", ({ source, origin, data }) => {
  if (source !== parent || origin !== location.origin || data?.token !== token) return;
  if (data.type === "run") void run(data.config);
  if (data.type === "stop") {
    cancelled = true;
    adapter?.destroy();
  }
});
window.addEventListener("keydown", (event) => {
  if (["Escape", "Backspace"].includes(event.key) || [8, 461, 10009].includes(event.keyCode)) {
    event.preventDefault();
    post("stop-request");
  }
});
async function init() {
  if (!ENGINES.includes(engine)) throw Error("unknown-engine");
  let start = performance.now();
  const module = await loaders[engine]();
  moduleMs = roundMs(performance.now() - start);
  start = performance.now();
  images = await preload();
  assetsMs = roundMs(performance.now() - start);
  start = performance.now();
  adapter = await module.mount(document.getElementById("scene"), { images, engine });
  mountMs = roundMs(performance.now() - start);
  post("ready", { engine });
}
init().catch(() => post("error", { error: "adapter-load-or-init-failed" }));
