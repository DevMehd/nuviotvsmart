import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C): screen-level checks with the real loadHomeRows and DOM renderer.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };

// Fake DOM: innerHTML is ignored, querySelector(sel) hands back one stub per selector. No CSS.
class El {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.children = [];
    this.kids = new Map();
    this.textContent = "";
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, on) => (on ? set.add(c) : set.delete(c))
    };
  }
  set className(value) {
    value.split(/\s+/).forEach((c) => c && this.classList.add(c));
  }
  set innerHTML(_) {
    this.kids.clear();
  }
  querySelector(selector) {
    if (!this.kids.has(selector)) this.kids.set(selector, new El());
    return this.kids.get(selector);
  }
  querySelectorAll(selector) {
    return selector === ".home-sidebar .focusable"
      ? [Object.assign(new El(), { dataset: { action: "gotoHome" } })]
      : [];
  }
  appendChild(node) {
    if (!this.children.includes(node)) this.children.push(node);
    node.parent = this;
    return node;
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
  getAttribute(name) {
    return name === "src" ? this.src || null : null;
  }
  removeAttribute() {
    this.src = "";
  }
}
const container = new El();
globalThis.document = {
  getElementById: () => container,
  createElement: (tag) => new El(tag),
  documentElement: new El("html"),
  body: new El("body")
};

// Fake clock, as in test-vidaa-home-loading.mjs.
let now = 0;
let nextId = 0;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextId;
  timers.set(id, { callback, at: now + Number(delay) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
async function flush() {
  for (let index = 0; index < 64; index++) await Promise.resolve();
}
async function advance(time) {
  for (;;) {
    const pending = [...timers]
      .filter(([, timer]) => timer.at <= time)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!pending) break;
    const [id, timer] = pending;
    now = timer.at;
    timers.delete(id);
    timer.callback();
    await flush();
  }
  now = time;
  await flush();
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const { watchProgressRepository } =
  await import("../js/data/repository/watchProgressRepository.js");
const { addonRepository } = await import("../js/data/repository/addonRepository.js");
const { catalogRepository } = await import("../js/data/repository/catalogRepository.js");
const { NewHomeScreen } = await import("../js/ui/tv2/newHomeScreen.js");

const catalogPage = {
  status: "success",
  data: {
    items: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, type: "movie", name: `M${i}` }))
  }
};
let catalogResult = async () => catalogPage;

/** Mounts a screen whose real DOM renderer counts setRows and setHero calls. */
function mountScreen() {
  const calls = { setRows: 0, setHero: [] };
  const screen = Object.create(NewHomeScreen);
  screen.domView = function () {
    const view = NewHomeScreen.domView.call(this);
    const { setRows, setHero } = view;
    view.setRows = (rows) => {
      calls.setRows += 1;
      setRows(rows);
    };
    view.setHero = (item) => {
      calls.setHero.push(item);
      setHero(item);
    };
    return view;
  };
  void screen.mount();
  return { screen, calls };
}

const originalAllProgress = watchProgressRepository.getAllForContinueWatching;
const originalAddons = addonRepository.getInstalledAddons;
const originalCatalog = catalogRepository.getCatalog;
watchProgressRepository.getAllForContinueWatching = async () => [];
addonRepository.getInstalledAddons = async () => [
  {
    baseUrl: "https://addon.example",
    id: "addon",
    name: "Addon",
    catalogs: [{ id: "top", apiType: "movie", name: "Top" }]
  }
];
catalogRepository.getCatalog = () => catalogResult();
try {
  // cleanup() before getCatalog resolves: the late result never reaches the renderer.
  {
    const pending = deferred();
    catalogResult = () => pending.promise;
    const { screen, calls } = mountScreen();
    await flush();
    assert.deepEqual(
      screen.rows.map((row) => `${row.key}:${row.status}`),
      ["continue_watching:success", "addon_movie_top:loading"]
    );
    const before = calls.setRows;
    assert.ok(before > 0, "rows reached the renderer before cleanup");
    screen.cleanup();
    pending.resolve(catalogPage);
    await advance(1000);
    assert.equal(calls.setRows, before, "no setRows after cleanup");
    assert.equal(calls.setHero.length, 0, "no hero after cleanup");
    assert.equal(screen.view, null);
    catalogResult = async () => catalogPage;
  }

  // Empty Continue Watching: focus lands on the first filled row; one hero once calm.
  {
    now = 0;
    timers.clear();
    const { screen, calls } = mountScreen();
    await flush();
    const filled = screen.rows.findIndex((row) => row.items.length);
    assert.ok(filled > 0, "Continue Watching is empty");
    assert.equal(screen.focus.row, filled);
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "m0");

    await advance(449);
    assert.equal(calls.setHero.length, 0, "no hero before 450 ms");
    await advance(450);
    assert.equal(calls.setHero.length, 1, "exactly one hero after 450 ms");
    assert.equal(calls.setHero[0].id, "m0");

    // Held right key: repeats every 100 ms never let the hero timer fire.
    let released = now;
    for (let step = 1; step <= 10; step += 1) {
      released = now;
      screen.onKeyDown({ keyCode: 39, repeat: step > 1 });
      await advance(now + 100);
    }
    assert.equal(calls.setHero.length, 1, "no hero while the key is held");
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "m10");
    await advance(released + 449);
    assert.equal(calls.setHero.length, 1);
    await advance(released + 450);
    assert.equal(calls.setHero.length, 2, "one hero once the key is released");
    assert.equal(calls.setHero[1].id, "m10");
    screen.cleanup();
  }

  // Diagnostics hooks read by the benchmark driver.
  {
    now = 0;
    timers.clear();
    const { screen } = mountScreen();
    await flush();
    const position = () => {
      const node = screen.getCurrentFocusedNode();
      return [node.dataset.navRow, node.dataset.navCol];
    };
    const node = screen.getCurrentFocusedNode();
    // Driver POSTER_SELECTOR: '.home-poster-card.focusable[data-action="openDetail"]'.
    assert.ok(node.classList.contains("home-poster-card") && node.classList.contains("focusable"));
    assert.equal(node.dataset.action, "openDetail");
    assert.deepEqual(position(), ["0", "0"], "the empty Continue Watching row is not counted");
    screen.onKeyDown({ keyCode: 39 });
    assert.deepEqual(position(), ["0", "1"]);
    const continueRow = { ...screen.rows[0], items: [{ id: "cw1", type: "movie", name: "CW" }] };
    screen.applyRows([continueRow, ...screen.rows.slice(1)]);
    assert.deepEqual(position(), ["1", "1"], "a filled Continue Watching row shifts navRow");
    screen.cleanup();
    assert.equal(screen.getCurrentFocusedNode(), null);

    const { renderLegacySidebar } =
      await import("../js/ui/components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js");
    const buttons = renderLegacySidebar({ selectedRoute: "home" }).match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length > 0);
    for (const button of buttons) assert.match(button, /data-nav-zone="sidebar"/);
  }
} finally {
  watchProgressRepository.getAllForContinueWatching = originalAllProgress;
  addonRepository.getInstalledAddons = originalAddons;
  catalogRepository.getCatalog = originalCatalog;
}

console.log("PASS: new TV Home screen with real rows and DOM renderer");
