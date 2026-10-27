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
  insertBefore(node) {
    return this.appendChild(node);
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
// Hero swaps (lot C8) act on real images only: the fake nodes are skipped.
globalThis.HTMLImageElement = class {};

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
const { noteVidaaNavigationKeyDown, noteVidaaNavigationKeyUp, resetVidaaNavigationActivity } =
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
// Hero enrichment (lot C9) reads addon metadata with options (a signal); Continue Watching
// enrichment calls the real repository without. Until the C9 case, hero metadata never answers.
const { metaRepository } = await import("../js/data/repository/metaRepository.js");
const originalMeta = metaRepository.getMetaFromAllAddons;
let heroMeta = () => new Promise(() => {});
metaRepository.getMetaFromAllAddons = function (type, id, base, options) {
  return options ? heroMeta(type, id, options) : originalMeta.call(this, type, id, base);
};
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
    const heroesBefore = calls.setHero.length;
    assert.ok(before > 0, "rows reached the renderer before cleanup");
    screen.cleanup();
    pending.resolve(catalogPage);
    await advance(1000);
    assert.equal(calls.setRows, before, "no setRows after cleanup");
    assert.equal(calls.setHero.length, heroesBefore, "no hero after cleanup");
    assert.equal(screen.view, null);
    catalogResult = async () => catalogPage;
  }

  // Empty Continue Watching: focus lands on the first filled row; the first catalog title is the
  // initial hero at once (current Home pickInitialHero), and the same title is not written again.
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
    const heroes = () => calls.setHero.filter(Boolean);
    assert.deepEqual(
      heroes().map((item) => item.id),
      ["m0"],
      "initial hero before any calm delay"
    );
    await advance(1000);
    assert.equal(heroes().length, 1, "the focused title is already the hero: no second write");

    // One tap: one hero 450 ms later, artwork warmed 20 ms after the move.
    screen.onKeyDown({ keyCode: 39 });
    const tapped = now;
    // A rows refresh (late catalog, next page) keeps the pending hero of the same title.
    await advance(tapped + 300);
    screen.applyRows(screen.rows);
    await advance(tapped + 449);
    assert.equal(heroes().length, 1, "no hero before 450 ms");
    await advance(tapped + 450);
    assert.deepEqual(
      heroes().map((item) => item.id),
      ["m0", "m1"],
      "exactly one hero after 450 ms"
    );

    // Held right key: repeats every 100 ms never let the hero timer fire; rapid moves wait 600 ms.
    let released = now;
    for (let step = 1; step <= 10; step += 1) {
      released = now;
      screen.onKeyDown({ keyCode: 39, repeat: step > 1 });
      await advance(now + 100);
    }
    assert.equal(heroes().length, 2, "no hero while the key is held");
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "m11");
    await advance(released + 599);
    assert.equal(heroes().length, 2, "rapid moves: no hero before 600 ms");
    await advance(released + 600);
    assert.equal(heroes().length, 3, "one hero once the key is released");
    assert.equal(heroes()[2].id, "m11");

    // VIDAA navigation busy: the commit re-polls every 60 ms until 60 ms of quiet.
    screen.onKeyDown({ keyCode: 37 });
    const moved = now;
    noteVidaaNavigationKeyDown(37);
    await advance(moved + 900);
    assert.equal(heroes().length, 3, "no hero while navigation is busy");
    noteVidaaNavigationKeyUp(37);
    const up = now;
    await advance(up + 59);
    assert.equal(heroes().length, 3, "no hero before 60 ms of quiet");
    await advance(up + 120);
    assert.equal(heroes().length, 4, "hero once navigation is quiet");
    assert.equal(heroes()[3].id, "m10");
    // The next cases restart the fake clock at 0.
    resetVidaaNavigationActivity();

    // Opening the sidebar drops the pending hero.
    screen.onKeyDown({ keyCode: 39 });
    await advance(now + 200);
    screen.openSidebar(false);
    await advance(now + 1000);
    assert.equal(heroes().length, 4, "no hero once the sidebar opened");
    screen.closeSidebar();
    await advance(now + 450);
    assert.equal(heroes().length, 5, "back in the rails: the focused title once calm");
    assert.equal(heroes()[4].id, "m11");
    screen.cleanup();
  }

  // Continue Watching loading: hero skeleton, no catalog hero; its first title becomes the hero.
  {
    now = 0;
    timers.clear();
    const recent = deferred();
    watchProgressRepository.getRecent = () => recent.promise;
    const { screen, calls } = mountScreen();
    await flush();
    assert.ok(
      screen.rows.some((row) => row.items.length),
      "catalog rows arrived while Continue Watching loads"
    );
    assert.equal(calls.setHero[0], null, "skeleton first");
    assert.equal(calls.setHero.filter(Boolean).length, 0, "no catalog hero while it loads");
    // The focused catalog card does not replace the held skeleton once calm (no key yet).
    await advance(now + 1000);
    assert.equal(calls.setHero.filter(Boolean).length, 0, "skeleton held until Continue Watching");
    recent.resolve([
      {
        contentId: "tt9",
        contentType: "movie",
        title: "Resume",
        poster: "https://img.invalid/tt9.jpg",
        positionMs: 10,
        durationMs: 100,
        updatedAt: 1
      }
    ]);
    await flush();
    // Later emits follow pickInitialHero again until the first key (here the enrichment fixture
    // drops the artwork, so the first catalog title takes over).
    const heroes = calls.setHero.filter(Boolean);
    assert.equal(heroes[0]?.contentId, "tt9", "the first hero is the Continue Watching title");
    screen.cleanup();
    watchProgressRepository.getRecent = async () => [];
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

  // Hero enrichment (lot C9): the current Home's enrichCurrentHeroAsync and MDBList ratings run on
  // a facade; Italian TMDB first, addon fallback, and a move, the sidebar or cleanup abort it.
  {
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    const { TmdbSettingsStore, TmdbService, TmdbMetadataService, mdbListRepository } =
      await import("../js/ui/screens/home/homeScreenContext.js");
    const { MdbListSettingsStore } = await import("../js/data/local/mdbListSettingsStore.js");
    const { buildModernHeroPresentation } =
      await import("../js/ui/screens/home/homeScreenHelpers-11-build-hero-display-model.js");
    const saved = {
      tmdbSettings: TmdbSettingsStore.get,
      ensureTmdbId: TmdbService.ensureTmdbId,
      fetchEnrichment: TmdbMetadataService.fetchEnrichment,
      mdbSettings: MdbListSettingsStore.get,
      imdbRating: mdbListRepository.getImdbRatingForItem,
      ratings: mdbListRepository.getRatingsForMeta
    };
    let mdbSettings = { enabled: true, apiKey: "fixture-mdb-key", showImdb: true };
    TmdbSettingsStore.get = () => ({
      enabled: true,
      modernHomeEnabled: true,
      language: "it-IT",
      apiKey: "fixture-tmdb-key",
      useBasicInfo: true,
      useArtwork: true,
      useDetails: true
    });
    MdbListSettingsStore.get = () => mdbSettings;
    // One set of answers per title, released by the test.
    const requests = new Map();
    const request = (id) => {
      if (!requests.has(id))
        requests.set(id, { tmdb: deferred(), addon: deferred(), mdb: deferred() });
      return requests.get(id);
    };
    TmdbService.ensureTmdbId = async (id) => Number(String(id).slice(2));
    TmdbMetadataService.fetchEnrichment = (options) => {
      request(`tt${options.tmdbId}`).language = options.language;
      return request(`tt${options.tmdbId}`).tmdb.promise;
    };
    heroMeta = (type, id, options) => {
      request(id).signal = options.signal;
      return request(id).addon.promise;
    };
    mdbListRepository.getImdbRatingForItem = (id) => request(id).mdb.promise;
    mdbListRepository.getRatingsForMeta = (hero, id) => request(id).mdb.promise;
    catalogRepository.getCatalog = () => catalogResult();
    catalogResult = async () => ({
      status: "success",
      data: {
        items: Array.from({ length: 40 }, (_, i) => ({
          id: `tt${100 + i}`,
          type: "movie",
          name: `English ${i}`,
          logo: `https://img.invalid/en-${i}.png`,
          background: `https://img.invalid/bg-${i}.jpg`
        }))
      }
    });
    const english = { status: "success", data: { description: "English addon overview" } };
    try {
      const { screen, calls } = mountScreen();
      await flush();
      const heroes = () => calls.setHero.filter(Boolean);
      assert.equal(heroes().at(-1).id, "tt100");
      const first = requests.get("tt100");
      assert.ok(first?.signal, "the initial hero is enriched");
      assert.equal(first.language, "it-IT");
      const shown = heroes().length;
      first.addon.resolve(english);
      await flush();
      assert.equal(heroes().length, shown, "English addon data waits for the Italian preview");
      first.tmdb.resolve({
        localizedTitle: "Titolo italiano",
        description: "Descrizione italiana",
        logo: "https://img.invalid/it-logo.png",
        backdrop: "https://img.invalid/it-bg.jpg"
      });
      await flush();
      assert.equal(heroes().at(-1).name, "Titolo italiano", "same title, enriched hero written");
      assert.equal(heroes().at(-1).description, "Descrizione italiana");
      assert.equal(screen.rows[screen.focus.row].items[0].name, "Titolo italiano", "card patched");
      first.mdb.resolve(8.6);
      await flush();
      assert.equal(heroes().at(-1).imdbRating, 8.6);

      // A move aborts the running enrichment: its late answers are never shown.
      screen.onKeyDown({ keyCode: 39 });
      await advance(now + 450);
      assert.equal(heroes().at(-1).id, "tt101");
      const second = requests.get("tt101");
      assert.ok(second?.signal && !second.signal.aborted);
      screen.onKeyDown({ keyCode: 39 });
      assert.ok(second.signal.aborted, "a move aborts the enrichment");
      second.tmdb.resolve({ localizedTitle: "Tardivo" });
      second.addon.resolve(english);
      second.mdb.resolve(7);
      await flush();
      assert.ok(!heroes().some((hero) => hero.name === "Tardivo"), "no late enrichment");

      // TMDB failure: the addon data is the fallback, without the English logo (title shown).
      await advance(now + 450);
      assert.equal(heroes().at(-1).id, "tt102");
      const third = requests.get("tt102");
      third.tmdb.resolve(null);
      third.addon.resolve(english);
      third.mdb.resolve(null);
      await flush();
      const fallback = heroes().at(-1);
      assert.equal(fallback.description, "English addon overview");
      assert.equal(buildModernHeroPresentation(fallback).logo, "", "missing logo");
      assert.equal(buildModernHeroPresentation(fallback).title, "English 2", "title instead");

      // The sidebar aborts it; back in the rails the unfinished title is enriched again.
      screen.onKeyDown({ keyCode: 39 });
      await advance(now + 450);
      const fourth = requests.get("tt103");
      const opened = fourth.signal;
      screen.openSidebar(false);
      assert.ok(opened.aborted, "the sidebar aborts the enrichment");
      screen.closeSidebar();
      await advance(now + 450);
      assert.ok(fourth.signal !== opened && !fourth.signal.aborted, "enriched again once calm");
      screen.cleanup();
      assert.ok(fourth.signal.aborted, "cleanup aborts the enrichment");

      // MDBList hero ratings (showOnHero) reach the hero of the new Home.
      requests.clear();
      mdbSettings = { ...mdbSettings, showOnHero: true };
      const mdb = mountScreen();
      await flush();
      request("tt100").mdb.resolve({ ratings: { imdb: 7.9, tomatoes: 91 } });
      await flush();
      const rated = mdb.calls.setHero.filter(Boolean).at(-1);
      assert.equal(rated.id, "tt100");
      assert.equal(rated.mdbListRatings?.tomatoes, 91, "MDBList ratings on the hero");
      mdb.screen.cleanup();
    } finally {
      TmdbSettingsStore.get = saved.tmdbSettings;
      TmdbService.ensureTmdbId = saved.ensureTmdbId;
      TmdbMetadataService.fetchEnrichment = saved.fetchEnrichment;
      MdbListSettingsStore.get = saved.mdbSettings;
      mdbListRepository.getImdbRatingForItem = saved.imdbRating;
      mdbListRepository.getRatingsForMeta = saved.ratings;
      catalogResult = async () => catalogPage;
    }
  }
} finally {
  metaRepository.getMetaFromAllAddons = originalMeta;
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
