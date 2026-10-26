import assert from "node:assert/strict";

// New TV Home WebGL prototype (nuv-091, lot B2): engine choice, DOM fallback, engine reuse and
// rebuild after a context loss, SDF encoding of the font atlas.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const setting = await import("../js/ui/tv2/newHomeSetting.js");
const { createEngineKeeper } =
  await import("../js/ui/tv2/render/lightning/lightningHomeRenderer.js");
const { sdfFromAlpha, ATLAS_RANGE } = await import("../js/ui/tv2/render/lightning/sdfAtlas.js");
const { NewHomeScreen } = await import("../js/ui/tv2/newHomeScreen.js");
const { Router, HomeScreen } = await import("../js/ui/navigation/router.js");

// Choice: "webgl" is selectable, draws with WebGL until a failure, then DOM for the run.
setting.resetSessionNewHomeMode();
assert.equal(setting.homeEngine(), "off");
assert.equal(setting.setNewHomeMode("webgl"), "webgl");
setting.resetSessionNewHomeMode();
assert.equal(Router.routes.home, NewHomeScreen);
assert.equal(setting.homeEngine(), "webgl");
setting.markWebglFailed("context-lost");
setting.markWebglFailed("texture-budget");
assert.equal(setting.homeEngine(), "dom");
assert.equal(setting.homeEngineFallback(), "context-lost", "the first cause is kept");
setting.resetSessionNewHomeMode();
assert.equal(setting.homeEngine(), "webgl", "a new run tries WebGL again");
setting.setNewHomeMode("dom");
setting.resetSessionNewHomeMode();
assert.equal(setting.homeEngine(), "dom");
setting.setNewHomeMode("off");
setting.resetSessionNewHomeMode();
assert.equal(Router.routes.home, HomeScreen);

// Fallback: same rows, focus and hero on the DOM renderer, pending images dropped.
const calls = [];
const rows = [{ key: "a", kind: "poster", items: [{ id: "a0" }, { id: "a1" }] }];
let webglDestroyed = 0;
const screen = Object.create(NewHomeScreen);
const oldQueue = { clear: () => calls.push("queue-cleared") };
Object.assign(screen, {
  rows,
  focus: { row: 0, columns: { a: 1 } },
  sidebarIndex: -1,
  imageQueue: oldQueue,
  viewOptions: { geometry: {}, imageQueue: oldQueue, layout: {} },
  view: { destroy: () => (webglDestroyed += 1) },
  domView() {
    calls.push("dom");
    return {
      setRows: (value) => calls.push(["rows", value]),
      update: (value, focus, options) => calls.push(["update", focus.columns.a, options]),
      setHero: (item) => calls.push(["hero", item?.id])
    };
  }
});
screen.fallBackToDom("context-lost");
assert.equal(webglDestroyed, 1);
assert.equal(setting.activeHomeEngine(), "dom:context-lost");
assert.deepEqual(calls, [
  "queue-cleared",
  "dom",
  ["rows", rows],
  ["update", 1, { sidebarIndex: -1 }],
  ["hero", "a1"]
]);

// Keeper: one engine across mounts; a loss on screen goes to the view; a loss while away is
// rebuilt (textures re-uploaded) on the next mount.
const engines = [];
const keeper = createEngineKeeper(async (report) => {
  const engine = { report, disposed: 0, dispose: () => (engine.disposed += 1) };
  engines.push(engine);
  return engine;
});
const troubles = [];
const viewA = (reason) => troubles.push(reason);
const first = await keeper.acquire(viewA);
assert.equal(await keeper.acquire(viewA), first, "reused across mounts");
first.report("texture-budget");
assert.deepEqual(troubles, ["texture-budget"]);
keeper.release(viewA);
first.report("context-lost");
assert.deepEqual(troubles, ["texture-budget"], "nothing on screen to fail");
const rebuilt = await keeper.acquire(viewA);
assert.notEqual(rebuilt, first);
assert.equal(first.disposed, 1, "the lost engine is closed");
assert.equal(engines.length, 2);
rebuilt.report("context-lost");
assert.deepEqual(troubles, ["texture-budget", "context-lost"], "a loss on screen fails the view");
keeper.release(() => {});
rebuilt.report("texture-budget");
assert.equal(troubles.length, 3, "release only detaches its own view");
keeper.drop();
await Promise.resolve();
assert.equal(rebuilt.disposed, 1);
first.report("texture-budget");
assert.equal(troubles.length, 3, "a dropped engine reports nowhere");
const failing = createEngineKeeper(async () => {
  throw new Error("no-webgl");
});
await assert.rejects(
  failing.acquire(() => {}),
  /no-webgl/
);

// SDF encoding: 128 on the edge, above inside, below outside, `range` px across the scale.
const width = 21;
const alpha = new Uint8ClampedArray(width).map((_, x) => (x <= 10 ? 255 : 0));
const sdf = sdfFromAlpha(alpha, width, 1);
assert.ok(sdf[10] > 128 && sdf[11] < 128, "edge between the last covered and first empty pixel");
assert.ok(sdf[5] > sdf[9] && sdf[15] < sdf[12], "monotonic away from the edge");
assert.equal(sdf[0], 255);
assert.equal(sdf[20], 0);
assert.equal(Math.round(sdf[11] - sdf[12]), Math.round(255 / ATLAS_RANGE), "1 px = 255/range");

console.log("PASS: new TV Home WebGL choice, DOM fallback, engine reuse and SDF atlas");
