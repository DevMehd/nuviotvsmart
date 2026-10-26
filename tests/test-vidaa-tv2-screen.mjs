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
  // Enough for a NuvioDialog (lot C7 menus).
  setAttribute() {}
  addEventListener() {}
  focus() {}
}
const container = new El();
globalThis.document = {
  getElementById: () => container,
  createElement: (tag) => new El(tag),
  documentElement: new El("html"),
  body: new El("body"),
  addEventListener() {},
  removeEventListener() {},
  querySelector: (selector) =>
    selector === ".nuvio-dialog-backdrop"
      ? document.body.children.find((node) => node.classList.contains(selector.slice(1))) || null
      : null
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

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
// The router fills this singleton in the app; card models read the current route (lot C4).
const { Router } = await import("../js/ui/navigation/routerState.js");
Router.getCurrent = () => "home";
const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");
const { focusedIndex } = await import("../js/ui/tv2/focusModel.js");
const { homeLayout, rowCardSize, RAIL_VIEWPORT } = await import("../js/ui/tv2/railEngine.js");
const { noteVidaaNavigationKeyDown, noteVidaaNavigationKeyUp } =
  await import("../js/ui/navigation/vidaaNavigationActivity.js");
const { PosterOptionsDialogController } = await import("../js/ui/components/posterOptionsMenu.js");
const { normalizeContinueWatchingItem } =
  await import("../js/ui/screens/home/homeScreenHelpers-09-normalize-continue-watching-item.js");

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
const originalRecent = watchProgressRepository.getRecent;
const originalAddons = addonRepository.getInstalledAddons;
const originalCatalog = catalogRepository.getCatalog;
watchProgressRepository.getAllForContinueWatching = async () => [];
watchProgressRepository.getRecent = async () => [];
addonRepository.getInstalledAddons = async () => [
  {
    baseUrl: "https://addon.example",
    id: "addon",
    name: "Addon",
    catalogs: [{ id: "top", apiType: "movie", name: "Top" }]
  }
];
catalogRepository.getCatalog = () => catalogResult();
// The post-load recommendation refresh (lot C2) is covered by test-vidaa-tv2-collections.mjs.
const originalRefresh = Recommendations.refresh;
const originalNavigate = Router.navigate;
const originalPosterOpen = PosterOptionsDialogController.prototype.open;
const originalRemoveProgress = watchProgressRepository.removeProgress;
Recommendations.refresh = async () => {};
try {
  // cleanup() before getCatalog resolves: the late result never reaches the renderer.
  {
    const pending = deferred();
    catalogResult = () => pending.promise;
    const { screen, calls } = mountScreen();
    await flush();
    // Like the current Home, a catalog row appears once its page answers or times out,
    // and an empty Continue Watching row is not drawn once its progress is read (lot C3).
    assert.deepEqual(
      screen.rows.map((row) => `${row.key}:${row.status}`),
      []
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
    assert.ok(
      !screen.rows.some((row) => row.kind === "continue"),
      "no empty Continue Watching row"
    );
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
    assert.deepEqual(position(), ["0", "0"], "first catalog row");
    screen.onKeyDown({ keyCode: 39 });
    assert.deepEqual(position(), ["0", "1"]);
    const continueRow = {
      key: "continue_watching",
      kind: "continue",
      title: "CW",
      status: "success",
      items: [{ id: "cw1", type: "movie", name: "CW" }]
    };
    screen.applyRows([continueRow, ...screen.rows]);
    assert.deepEqual(position(), ["1", "1"], "a filled Continue Watching row shifts navRow");
    screen.cleanup();
    assert.equal(screen.getCurrentFocusedNode(), null);

    const { renderLegacySidebar } =
      await import("../js/ui/components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js");
    const buttons = renderLegacySidebar({ selectedRoute: "home" }).match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length > 0);
    for (const button of buttons) assert.match(button, /data-nav-zone="sidebar"/);
  }

  // A slower catalog answering above the focused row: focus stays on the same row.
  {
    now = 0;
    timers.clear();
    const slow = deferred();
    addonRepository.getInstalledAddons = async () => [
      {
        baseUrl: "https://addon.example",
        id: "addon",
        name: "Addon",
        catalogs: [
          { id: "slow", apiType: "movie", name: "Slow" },
          { id: "fast", apiType: "movie", name: "Fast" }
        ]
      }
    ];
    catalogRepository.getCatalog = ({ catalogId }) =>
      catalogId === "slow"
        ? slow.promise
        : Promise.resolve({ status: "success", data: { items: [{ id: "f0", type: "movie" }] } });
    const { screen } = mountScreen();
    await flush();
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "f0");
    slow.resolve({ status: "success", data: { items: [{ id: "s0", type: "movie" }] } });
    await flush();
    assert.ok(
      screen.rows.some((row) => row.items[0]?.id === "s0"),
      "the slow row arrived"
    );
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "f0", "focus kept its row");
    screen.cleanup();
  }

  // Modern pagination (C6): near the end of a catalog row, its next page is requested once
  // and appended in place; focus, column and the rendered rows stay.
  {
    now = 0;
    timers.clear();
    addonRepository.getInstalledAddons = async () => [
      {
        baseUrl: "https://addon.example",
        id: "addon",
        name: "Addon",
        catalogs: [{ id: "top", apiType: "movie", name: "Top", extra: [{ name: "skip" }] }]
      }
    ];
    const page = (from, count) =>
      Array.from({ length: count }, (_, i) => ({ id: `p${from + i}`, type: "movie" }));
    const requests = [];
    let nextPage = null;
    catalogRepository.getCatalog = (params) => {
      if (!params.skip)
        return Promise.resolve({
          status: "success",
          data: { items: page(0, 20), hasMore: true, supportsSkip: true }
        });
      requests.push(params);
      nextPage = deferred();
      return nextPage.promise;
    };
    const { screen, calls } = mountScreen();
    await flush();
    const row = () => screen.rows[screen.focus.row];
    assert.equal(row().items.length, 20);
    // Current Home trigger: the projected last visible card (focus + visible - 1) within 4 cards
    // of the end, early enough that the page lands before the camera reaches the row end.
    const geometry = screen.viewOptions.geometry;
    const visible = Math.ceil(RAIL_VIEWPORT / (rowCardSize(row(), geometry).width + geometry.gap));
    const triggerAt = (count) => count - 4 - visible + 1;
    const cameraOffset = () =>
      homeLayout(screen.rows, screen.focus, geometry).rows[screen.focus.row].win.offset;
    for (let step = 0; step < triggerAt(20) - 1; step += 1) screen.onKeyDown({ keyCode: 39 });
    assert.equal(requests.length, 0, "no page before the last visible card nears the end");
    await advance(now + 1000);
    screen.onKeyDown({ keyCode: 39 });
    assert.equal(focusedIndex(screen.focus, screen.rows), triggerAt(20));
    assert.equal(requests.length, 1, "one page once the last visible card is 4 from the end");
    assert.equal(requests[0].skip, 20);
    assert.equal(requests[0].catalogId, "top");
    assert.equal(requests[0].supportsSkip, true);
    screen.onKeyDown({ keyCode: 39 });
    assert.equal(requests.length, 1, "no second request while the page is in flight");
    const setRowsBefore = calls.setRows;
    const offsetBefore = cameraOffset();
    nextPage.resolve({
      status: "success",
      data: { items: [...page(18, 2), ...page(20, 10)], hasMore: true }
    });
    await flush();
    assert.equal(row().items.length, 30, "duplicates dropped, 10 cards appended");
    assert.equal(row().items[29].id, "p29");
    assert.equal(row().nextSkip, 32);
    const column = triggerAt(20) + 1;
    assert.equal(focusedIndex(screen.focus, screen.rows), column, "same column");
    assert.equal(screen.view.focusedNode()?.dataset.itemId, `p${column}`, "same focused card");
    assert.equal(cameraOffset(), offsetBefore, "the row does not slide when the page lands");
    assert.equal(calls.setRows, setRowsBefore, "appended without rebuilding the rows");

    // VIDAA: a page is not requested while keys are moving; it follows once navigation settles.
    while (focusedIndex(screen.focus, screen.rows) < triggerAt(30) - 1)
      screen.onKeyDown({ keyCode: 39 });
    assert.equal(requests.length, 1);
    noteVidaaNavigationKeyDown(39);
    screen.onKeyDown({ keyCode: 39 });
    assert.equal(focusedIndex(screen.focus, screen.rows), triggerAt(30));
    assert.equal(requests.length, 1, "deferred while navigation is busy");
    noteVidaaNavigationKeyUp(39);
    await advance(now + 1000);
    assert.equal(requests.length, 2, "requested once navigation settled");
    assert.equal(requests[1].skip, 32);
    // A late page after cleanup changes nothing.
    const lastRow = row();
    screen.cleanup();
    nextPage.resolve({ status: "success", data: { items: page(30, 5) } });
    await flush();
    assert.equal(lastRow.items.length, 30, "late page ignored");
    assert.equal(lastRow.entry.result.data.items.length, 30, "shared page data untouched");
  }
  // Actions (C7): OK acts on key-up, a 650 ms hold opens the menu, an orphan key-up does nothing.
  {
    now = 0;
    timers.clear();
    addonRepository.getInstalledAddons = async () => [
      {
        baseUrl: "https://addon.example",
        id: "addon",
        displayName: "Addon",
        catalogs: [{ id: "top", apiType: "movie", name: "Top" }]
      }
    ];
    // A fresh page: cards are mapped once per page object, with the addon of their first row.
    catalogRepository.getCatalog = async () => ({ ...catalogPage });
    const navigations = [];
    Router.navigate = (route, params) => navigations.push([route, params]);
    const menus = [];
    PosterOptionsDialogController.prototype.open = async function (item) {
      menus.push(item.id);
      return true;
    };
    const ok = (screen, keyDownDurationMs = 0) => {
      screen.onKeyDown({ keyCode: 13 });
      screen.onKeyUp({ keyCode: 13, keyDownDurationMs });
    };
    const { screen } = mountScreen();
    await flush();
    screen.onKeyUp({ keyCode: 13, keyDownDurationMs: 0 });
    assert.equal(navigations.length, 0, "an orphan key-up (changelog OK) does nothing");
    ok(screen);
    assert.deepEqual(navigations, [
      [
        "detail",
        {
          itemId: "m0",
          itemType: "movie",
          fallbackTitle: "M0",
          fallbackPoster: "",
          fallbackBackground: "",
          addonBaseUrl: "https://addon.example",
          addonId: "addon",
          addonName: "Addon",
          catalogType: "movie"
        }
      ]
    ]);
    screen.onKeyDown({ keyCode: 13 });
    await advance(now + 649);
    assert.equal(menus.length, 0);
    await advance(now + 1);
    assert.deepEqual(menus, ["m0"], "a 650 ms hold opens the poster menu");
    screen.onKeyUp({ keyCode: 13, keyDownDurationMs: 700 });
    assert.deepEqual(menus, ["m0"], "once");
    assert.equal(navigations.length, 1, "the key-up after the menu opens nothing");
    ok(screen, 700);
    assert.equal(menus.length, 2, "a long key-up opens it when the timer is late");
    screen.onKeyDown({ keyCode: 13 });
    screen.onKeyDown({ keyCode: 39 });
    await advance(now + 1000);
    screen.onKeyUp({ keyCode: 13, keyDownDurationMs: 1000 });
    assert.equal(menus.length, 2, "another key cancels the hold");
    assert.equal(navigations.length, 1);

    // A Continue Watching row filled after a key does not take focus.
    const catalogRows = screen.rows;
    const show = normalizeContinueWatchingItem({
      contentId: "tt1",
      type: "series",
      title: "Show",
      videoId: "tt1:1:2",
      season: 1,
      episode: 2,
      positionMs: 60000,
      durationMs: 1200000,
      poster: "https://img.example/p.jpg"
    });
    const film = normalizeContinueWatchingItem({
      contentId: "tt2",
      type: "movie",
      title: "Film",
      positionMs: 1000,
      durationMs: 5000,
      poster: "https://img.example/f.jpg"
    });
    const cwRow = {
      key: "continue_watching",
      kind: "continue",
      title: "CW",
      status: "success",
      items: [show, film]
    };
    screen.applyRows([cwRow, ...catalogRows]);
    assert.equal(screen.rows[screen.focus.row].key, catalogRows[0].key, "no late jump after a key");
    screen.cleanup();

    // Before any key, it does (current Home shouldApplyLateContinueWatchingFocus).
    const second = mountScreen().screen;
    await flush();
    second.applyRows([cwRow, ...second.rows]);
    assert.equal(second.focus.row, 0, "late Continue Watching takes focus before any key");
    ok(second);
    const [route, params] = navigations.at(-1);
    assert.equal(route, "detail");
    assert.equal(params.itemId, "tt1");
    assert.equal(params.autoOpenContinueWatching, true);
    assert.equal(params.returnHomeOnBack, true);
    assert.equal(params.resumeProgressMs, 60000);
    assert.equal(params.resumeDurationMs, 1200000);
    assert.equal(params.startFromBeginning, false);
    assert.equal(params.resumeVideoId, "tt1:1:2");
    assert.equal(params.resumeSeason, 1);
    assert.equal(params.resumeEpisode, 2);

    // Continue Watching menu: Details, Start from beginning, Remove.
    const removed = [];
    watchProgressRepository.removeProgress = async (id) => removed.push(id);
    second.onKeyDown({ keyCode: 13 });
    await advance(now + 650);
    const dialog = second.cwDialog;
    assert.deepEqual(
      dialog.buttons.map((button) => button.key),
      ["details", "startOver", "remove"]
    );
    assert.ok(document.body.classList.contains("nuvio-modal-open"));
    dialog.buttons[2].onAction();
    await flush();
    assert.deepEqual(removed, ["tt1"], "Remove drops all the title's progress");
    assert.deepEqual(
      second.rows[0].items.map((item) => item.contentId),
      ["tt2"],
      "the row shrinks"
    );
    assert.equal(second.focus.row, 0);
    assert.equal(second.view.focusedNode()?.dataset.itemId, "tt2", "focus clamped in the row");
    second.applyRows([cwRow, ...catalogRows]);
    assert.deepEqual(
      second.rows[0].items.map((item) => item.contentId),
      ["tt2"],
      "a later emit of the running load keeps it out"
    );
    await advance(now + 220);
    assert.ok(!document.body.classList.contains("nuvio-modal-open"));

    // cleanup() with an open menu releases the modal lock.
    second.onKeyDown({ keyCode: 13 });
    await advance(now + 650);
    assert.ok(second.cwDialog && document.body.classList.contains("nuvio-modal-open"));
    second.cleanup();
    await advance(now + 220);
    assert.ok(!document.body.classList.contains("nuvio-modal-open"), "cleanup closes the menu");
    assert.equal(document.body.children.length, 0);
  }
} finally {
  watchProgressRepository.getAllForContinueWatching = originalAllProgress;
  watchProgressRepository.getRecent = originalRecent;
  addonRepository.getInstalledAddons = originalAddons;
  catalogRepository.getCatalog = originalCatalog;
  Recommendations.refresh = originalRefresh;
  Router.navigate = originalNavigate;
  PosterOptionsDialogController.prototype.open = originalPosterOpen;
  watchProgressRepository.removeProgress = originalRemoveProgress;
}

console.log("PASS: new TV Home screen with real rows and DOM renderer");
