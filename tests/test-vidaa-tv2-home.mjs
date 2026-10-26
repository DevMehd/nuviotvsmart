import assert from "node:assert/strict";

// New TV Home (nuv-091, lot B): pure engines, beta setting and route choice, key handling.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { cardGeometry, railWindow, slotFor, rowsOffset } =
  await import("../js/ui/tv2/railEngine.js");
const { createFocus, moveFocus, focusSnapshot, restoreFocus } =
  await import("../js/ui/tv2/focusModel.js");
const { sizedImageUrl, createImageQueue } = await import("../js/ui/tv2/imagePipeline.js");
const { homeCatalogEntries, continueWatchingRow } = await import("../js/ui/tv2/homeModel.js");
const setting = await import("../js/ui/tv2/newHomeSetting.js");
const { Router, HomeScreen } = await import("../js/ui/navigation/router.js");
const { NewHomeScreen } = await import("../js/ui/tv2/newHomeScreen.js");
const { Platform } = await import("../js/platform/index.js");

// Geometry: same formulas as the current Home, default 126dp.
const geometry = cardGeometry({});
assert.deepEqual(geometry.poster, { width: 229, height: 344 });
assert.equal(geometry.landscape.width, 419);
assert.equal(
  cardGeometry({ posterCardWidthDp: 10 }).poster.width,
  Math.round(72 * 0.84 * 1.08 * 2)
);

// Rail window: bounded pool, focus always drawn, slots never collide inside a window.
for (const focusIndex of [0, 1, 7, 28, 29]) {
  const win = railWindow({ count: 30, focusIndex, pitch: 253, viewport: 1700 });
  assert.equal(win.poolSize, 10);
  assert.ok(win.start <= focusIndex && focusIndex < win.end, `focus ${focusIndex} drawn`);
  assert.ok(win.end - win.start <= win.poolSize);
  const slots = new Set();
  for (let i = win.start; i < win.end; i += 1) slots.add(slotFor(i, win.poolSize));
  assert.equal(slots.size, win.end - win.start);
  assert.ok(win.offset <= 0);
}
assert.ok(railWindow({ count: 3, focusIndex: 2, pitch: 253, viewport: 1700 }).offset === 0);
assert.equal(rowsOffset([400, 300, 300], 2), -700);
assert.ok(rowsOffset([400], 0) === 0);

// Focus: per-row columns, empty rows skipped, left edge leaves to the sidebar.
const rows = [
  { key: "a", items: [{ id: "a0" }, { id: "a1" }] },
  { key: "empty", items: [] },
  { key: "b", items: [{ id: "b0" }, { id: "b1" }, { id: "b2" }] }
];
let focus = createFocus();
assert.equal(moveFocus(focus, rows, "left"), null);
focus = moveFocus(focus, rows, "right");
assert.equal(moveFocus(focus, rows, "right"), focus);
focus = moveFocus(focus, rows, "down");
assert.equal(focus.row, 2);
focus = moveFocus(moveFocus(focus, rows, "right"), rows, "right");
assert.deepEqual(focusSnapshot(focus, rows), { rowKey: "b", index: 2, identity: "b2" });
focus = moveFocus(focus, rows, "up");
assert.equal(focus.row, 0);
assert.equal(focus.columns.a, 1, "the row keeps its column");
const snapshot = { rowKey: "b", index: 2, identity: "b2" };
const reordered = [rows[0], { key: "b", items: [{ id: "b2" }, { id: "b0" }] }];
assert.deepEqual(
  restoreFocus(snapshot, reordered),
  { row: 1, columns: { b: 0 } },
  "same title after a return"
);
assert.deepEqual(restoreFocus({ rowKey: "gone", index: 3 }, rows), createFocus());

// Images: TMDB size buckets; queue bounded, latest request per node wins, waits while busy.
assert.equal(
  sizedImageUrl("https://image.tmdb.org/t/p/original/x.jpg", 229),
  "https://image.tmdb.org/t/p/w342/x.jpg"
);
assert.equal(
  sizedImageUrl("https://image.tmdb.org/t/p/w500/x.jpg", 1280),
  "https://image.tmdb.org/t/p/w1280/x.jpg"
);
assert.equal(sizedImageUrl("", 300), "");
const fakeImage = () => ({
  src: "",
  getAttribute(name) {
    return name === "src" && this.src ? this.src : null;
  },
  removeAttribute() {
    this.src = "";
  }
});
let busy = true;
const queue = createImageQueue({ concurrency: 2, isBusy: () => busy, retryMs: 1 });
const images = [fakeImage(), fakeImage(), fakeImage()];
images.forEach((image, i) => queue.request(image, `u${i}`));
queue.request(images[0], "u0-new");
assert.equal(images[0].src, "", "nothing loads while navigation is busy");
busy = false;
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(images[1].src, "u1");
assert.equal(images[2].src, "u2");
assert.equal(images[0].src, "", "the re-requested node waits for a free slot");
images[1].onload();
assert.equal(images[0].src, "u0-new", "only its latest URL loads");
queue.request(images[1], "");
assert.equal(images[1].src, "", "a recycled card drops its image");
queue.clear();

// Model: disabled catalogs filtered, bounded; continue watching sorted by recency.
const addons = [
  {
    baseUrl: "https://addon.example",
    id: "addon",
    name: "Addon",
    catalogs: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, type: "movie", name: `C${i}` }))
  }
];
const entries = homeCatalogEntries(addons, { order: [], disabled: [], customTitles: {} });
assert.equal(entries.length, 10);
const continueRow = continueWatchingRow([
  { contentId: "old", contentType: "movie", updatedAt: 1, positionMs: 10, durationMs: 100 },
  { contentId: "new", contentType: "movie", updatedAt: 2, positionMs: 10, durationMs: 100 }
]);
assert.equal(continueRow.kind, "continue");
assert.deepEqual(
  continueRow.items.map((item) => item.id),
  ["new", "old"]
);

// Setting: off by default, the route keeps the current HomeScreen; read once per launch.
setting.resetSessionNewHomeMode();
assert.equal(setting.getNewHomeMode(), "off");
assert.equal(Router.routes.home, HomeScreen);
assert.equal(setting.setNewHomeMode("canvas"), "off", "unknown modes are not selectable");
assert.equal(setting.setNewHomeMode("dom"), "dom");
assert.equal(Router.routes.home, HomeScreen, "no switch under a running session");
setting.resetSessionNewHomeMode();
assert.equal(Router.routes.home, NewHomeScreen);
assert.equal(setting.setNewHomeMode("off"), "off");
assert.equal(store.has("tvNewHome"), false);
setting.resetSessionNewHomeMode();

// Keys on the new Home, with a fake view.
const node = {
  dataset: { itemId: "b0", itemType: "series", itemTitle: "B0", catalogType: "series" }
};
let navigated = null;
let exited = 0;
Router.navigate = (route, params) => (navigated = { route, params });
Platform.exitApp = () => (exited += 1);
Platform.isBackEvent = (event) => event.keyCode === 8;
const screen = Object.create(NewHomeScreen);
Object.assign(screen, {
  rows,
  focus: { row: 2, columns: {} },
  sidebarIndex: -1,
  view: {
    update() {},
    setHero() {},
    focusedNode: () => node,
    sidebarItems: () => [{ dataset: { action: "gotoHome" } }]
  }
});
screen.onKeyDown({ keyCode: 13 });
assert.equal(navigated.route, "detail");
assert.equal(navigated.params.itemId, "b0");
assert.equal(navigated.params.itemType, "series");
assert.deepEqual(screen.lastSnapshot, { rowKey: "b", index: 0, identity: "b0" });
screen.onKeyDown({ keyCode: 37 });
assert.equal(screen.sidebarIndex, 0, "left edge opens the sidebar");
screen.onKeyDown({ keyCode: 39 });
assert.equal(screen.sidebarIndex, -1);
screen.onKeyDown({ keyCode: 8 });
assert.equal(screen.sidebarIndex, 0, "Back opens the sidebar first");
assert.equal(exited, 0);
screen.onKeyDown({ keyCode: 8 });
assert.equal(exited, 1, "second Back exits");
clearTimeout(screen.heroTimer);

console.log("PASS: new TV Home engines, setting, route choice and keys");
