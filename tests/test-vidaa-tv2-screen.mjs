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
  // The shared sidebar helpers (lot C13) filter legacy items by their panel.
  closest() {
    return null;
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
// The remote sidebar profile (lot C13) reads membership and avatars: no network in tests.
const { MemberAccessRepository } =
  await import("../js/data/remote/supabase/memberAccessRepository.js");
const { AvatarRepository } = await import("../js/data/remote/supabase/avatarRepository.js");
MemberAccessRepository.getAccess = async () => null;
AvatarRepository.getAvatarCatalog = async () => [];
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { StartupSyncService } = await import("../js/core/profile/startupSyncService.js");
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
      // A rows refresh that puts focus back on the hero drops the other title's pending hero,
      // so moving to that title again still makes it the hero.
      const onHero = mdb.screen.focus;
      mdb.screen.onKeyDown({ keyCode: 39 });
      mdb.screen.focus = onHero;
      mdb.screen.applyRows(mdb.screen.rows);
      await advance(now + 450);
      mdb.screen.onKeyDown({ keyCode: 39 });
      await advance(now + 1000);
      assert.equal(mdb.calls.setHero.filter(Boolean).at(-1).id, "tt101", "pending dropped");
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

  // Hero trailer (lot C10): once the hero is calm, the focused poster's trailer plays in the hero
  // after max(250, expand delay) plus the constrained-TV delay, never while navigation is busy;
  // every move, OK, the sidebar and cleanup stop it. Folders get their hero video and focus GIF.
  {
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    const { createHomeScreenMethods03 } =
      await import("../js/ui/screens/home/homeScreenMethods-03-is-scroll-animation-active.js");
    const savedPrefs = LayoutPreferences.get;
    LayoutPreferences.get = function () {
      return {
        ...savedPrefs.call(this),
        focusedPosterBackdropTrailerEnabled: true,
        focusedPosterBackdropExpandDelaySeconds: 1
      };
    };
    const policy = createHomeScreenMethods03();
    const dwell = 1000 + policy.getFocusedPosterTrailerDelayMs("hero_media");
    const deferredStop = { deferred: Boolean(policy.shouldUseImmediateFocusScroll()) };
    catalogResult = async () => ({
      status: "success",
      data: {
        items: Array.from({ length: 40 }, (_, i) => ({
          id: `tt${200 + i}`,
          type: "movie",
          name: `T${i}`,
          trailerYtIds: ["dQw4w9WgXcQ"]
        }))
      }
    });
    const mountRecorded = () => {
      const calls = { play: [], stop: [], gif: [] };
      const screen = Object.create(NewHomeScreen);
      screen.domView = function () {
        const view = NewHomeScreen.domView.call(this);
        const { playHeroTrailer, stopHeroTrailer, setFocusGif } = view;
        view.playHeroTrailer = (source) => {
          calls.play.push(source);
          playHeroTrailer(source);
        };
        view.stopHeroTrailer = (options) => {
          calls.stop.push(options);
          stopHeroTrailer(options);
        };
        view.setFocusGif = (url) => {
          calls.gif.push(url);
          setFocusGif(url);
        };
        return view;
      };
      void screen.mount();
      return { screen, calls };
    };
    try {
      const { screen, calls } = mountRecorded();
      await flush();
      const start = now;
      await advance(start + dwell - 1);
      assert.equal(calls.play.length, 0, "no trailer before the dwell");
      await advance(start + dwell);
      assert.equal(calls.play.length, 1, "the initial hero's trailer after the dwell");
      assert.equal(calls.play[0].kind, "youtube");
      assert.equal(calls.play[0].muted, true, "muted by default");
      screen.applyRows(screen.rows);
      await advance(now + dwell * 2);
      assert.equal(calls.play.length, 1, "a rows refresh keeps the trailer");
      assert.equal(calls.stop.length, 0);

      // A move stops it; a held key keeps the next one from starting.
      screen.onKeyDown({ keyCode: 39 });
      assert.deepEqual(calls.stop, [deferredStop], "a move stops the trailer");
      noteVidaaNavigationKeyDown(39);
      await advance(now + 900);
      assert.equal(calls.play.length, 1, "no hero nor trailer while navigation is busy");
      noteVidaaNavigationKeyUp(39);
      await advance(now + 120);
      assert.equal(screen.heroItem.id, "tt201");
      // A key held at the dwell's end (no move) delays the trailer until 60 ms of quiet.
      await advance(now + dwell - 100);
      noteVidaaNavigationKeyDown(38);
      await advance(now + 500);
      assert.equal(calls.play.length, 1, "the trailer waits for calm");
      noteVidaaNavigationKeyUp(38);
      await advance(now + 120);
      assert.equal(calls.play.length, 2, "the next title's trailer once calm");

      // OK and the sidebar stop it.
      screen.onKeyDown({ keyCode: 13 });
      assert.equal(calls.stop.length, 2, "OK stops the trailer");
      screen.cancelPendingContinueWatchingHold();
      screen.openSidebar(false);
      screen.closeSidebar();
      await advance(now + 450 + dwell);
      assert.equal(calls.play.length, 3, "back on the hero, its trailer again");
      screen.openSidebar(false);
      assert.equal(calls.stop.length, 3, "the sidebar stops the trailer");
      screen.closeSidebar();
      await advance(now + 450 + 10);
      screen.cleanup();
      assert.equal(calls.stop.length, 4, "cleanup stops a pending trailer");
      await advance(now + dwell * 2);
      assert.equal(calls.play.length, 3, "nothing after cleanup");

      // Leaving Home drops the trailer lookups, as the current Home's cleanup: back on Home
      // (another profile, a lookup that failed), a title's trailer is looked up again.
      catalogResult = async () => ({
        status: "success",
        data: {
          items: Array.from({ length: 40 }, (_, i) => ({
            id: `tt${200 + i}`,
            type: "movie",
            name: `T${i}`,
            trailerYtIds: ["aBcDeFgHiJk"]
          }))
        }
      });
      const again = mountRecorded();
      await flush();
      await advance(now + dwell);
      assert.match(
        again.calls.play.at(-1)?.embedUrl || "",
        /aBcDeFgHiJk/,
        "a new visit looks the trailer up again"
      );
      again.screen.cleanup();

      // Folders: hero video (muted loop) and focus GIF once calm, both stopped by a move.
      const folder = {
        collectionId: "c1",
        folderId: "f1",
        title: "Folder",
        coverImageUrl: "https://img.invalid/cover.jpg",
        focusGifUrl: "https://img.invalid/focus.gif",
        heroVideoUrl: "https://video.invalid/hero.mp4"
      };
      const folderRow = {
        key: "collection_c1",
        kind: "collection",
        title: "C",
        items: [folder],
        status: "success",
        entry: { rowKind: "collection", collection: { id: "c1", title: "C" } }
      };
      const second = mountRecorded();
      await flush();
      second.screen.applyRows([folderRow, ...second.screen.rows]);
      second.screen.onKeyDown({ keyCode: 38 });
      await advance(now + 449);
      assert.equal(second.calls.gif.filter(Boolean).length, 0, "no GIF before calm");
      await advance(now + 1);
      assert.equal(second.screen.heroItem.folderId, "f1");
      assert.deepEqual(second.calls.gif.at(-1), "https://img.invalid/focus.gif");
      assert.deepEqual(second.calls.play.at(-1), {
        kind: "video",
        url: "https://video.invalid/hero.mp4",
        muted: true
      });
      second.screen.onKeyDown({ keyCode: 40 });
      assert.equal(second.calls.gif.at(-1), "", "a move clears the GIF");
      assert.ok(second.calls.stop.length >= 1, "a move stops the folder video");
      second.screen.cleanup();
    } finally {
      LayoutPreferences.get = savedPrefs;
      catalogResult = async () => catalogPage;
    }
  }

  // Layouts (lot C11): classic/grid hero row, capped catalogs ending with See All, no pagination;
  // key 76 cycles modern -> grid -> classic, saves it and gives each layout its focus back.
  {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    const { HOME_MAX_ITEMS_PER_ROW_CONSTRAINED } =
      await import("../js/ui/screens/home/homeConstants.js");
    const navigations = [];
    Router.navigate = (route, params) => navigations.push({ route, params });
    LayoutPreferences.set({ homeLayout: "classic" });
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    try {
      const { screen, calls } = mountScreen();
      await flush();
      assert.equal(screen.layoutMode, "classic");
      assert.equal(screen.rows[0].kind, "hero", "classic starts with its hero row");
      assert.equal(screen.focus.row, 0, "focus starts on the hero card");
      assert.equal(screen.view.focusedNode()?.classList.contains("focused"), true);
      assert.equal(screen.heroItem.id, "m0", "the first candidate, not the focused card");
      // A late Continue Watching row does not take the focus from the classic hero.
      const cw = { id: "tt9", type: "movie", name: "Late", progressPercent: 40 };
      screen.applyRows([
        { key: "continue_watching", kind: "continue", title: "CW", items: [cw], status: "success" },
        ...screen.modelRows
      ]);
      assert.equal(screen.rows[screen.focus.row].kind, "hero");
      const catalogIndex = screen.rows.findIndex((row) => row.entry && row.kind === "poster");
      const catalog = screen.rows[catalogIndex];
      assert.equal(
        catalog.items.length,
        HOME_MAX_ITEMS_PER_ROW_CONSTRAINED + 1,
        "VIDAA keeps 10 cards (D4), then See All"
      );
      assert.equal(catalog.items.at(-1).seeAll, true);
      // Left/Right on the hero rotate it, never open the sidebar.
      screen.onKeyDown({ keyCode: 39 });
      await advance(now + 2000);
      assert.equal(screen.sidebarIndex, -1);
      assert.equal(screen.heroItem.id, "m1", "Right shows the next candidate");
      const heroes = calls.setHero.filter(Boolean).length;
      // Moving in the rows never changes a classic hero, nor asks for a next page (D3).
      const requested = [];
      catalogRepository.getCatalog = (params) => (requested.push(params), catalogResult());
      screen.onKeyDown({ keyCode: 40 });
      while (screen.focus.row !== catalogIndex) screen.onKeyDown({ keyCode: 40 });
      for (let step = 0; step < 12; step += 1) screen.onKeyDown({ keyCode: 39 });
      await advance(now + 2000);
      assert.equal(calls.setHero.filter(Boolean).length, heroes, "the hero does not follow focus");
      assert.equal(requested.length, 0, "no pagination outside modern");
      assert.equal(screen.currentItem().seeAll, true, "focus stops on See All");
      const left = homeLayout(screen.rows, screen.focus, screen.viewOptions.geometry).rows[
        catalogIndex
      ];
      assert.ok(left.win.offset + 10 * left.pitch >= 0, "See All is inside the rail");
      screen.onKeyDown({ keyCode: 13 });
      assert.equal(navigations.at(-1).route, "catalogSeeAll", "See All opens on key-down");
      assert.equal(navigations.at(-1).params.catalogId, "top");
      assert.equal(navigations.at(-1).params.initialItems.length, 40);
      catalogRepository.getCatalog = () => catalogResult();

      // Key 76 (modern -> grid -> classic): each layout its own view, saved and focus restored.
      const viewsBefore = calls.setRows;
      screen.onKeyDown({ keyCode: 76 });
      assert.equal(screen.layoutMode, "modern");
      assert.equal(LayoutPreferences.get().homeLayout, "modern", "the layout is saved");
      assert.ok(calls.setRows > viewsBefore, "the rows are replayed into the new view");
      assert.ok(!screen.rows.some((row) => row.kind === "hero"), "modern has no hero row");
      assert.ok(!screen.rows.some((row) => row.items.some((item) => item.seeAll)));
      assert.equal(screen.heroItem.id, screen.currentItem().id, "modern shows the focused title");
      screen.onKeyDown({ keyCode: 76 });
      assert.equal(screen.layoutMode, "grid");
      const lines = screen.rows.filter((row) => row.key.startsWith(`${catalog.key}#`));
      assert.ok(lines.length >= 2, "a grid catalog splits into line rows");
      assert.ok(lines.at(-1).items.at(-1).seeAll, "See All closes the section");
      assert.equal(screen.heroItem.id, "m0", "the grid hero is re-picked");
      while (screen.rows[screen.focus.row].key !== lines[0].key) screen.onKeyDown({ keyCode: 40 });
      screen.onKeyDown({ keyCode: 39 });
      screen.onKeyDown({ keyCode: 39 });
      screen.onKeyDown({ keyCode: 40 });
      assert.equal(screen.rows[screen.focus.row].key, lines[1].key);
      assert.equal(focusedIndex(screen.focus, screen.rows), 2, "Down keeps the grid column");
      screen.onKeyDown({ keyCode: 76 });
      assert.equal(screen.layoutMode, "classic");
      assert.equal(screen.rows[screen.focus.row].key, catalog.key);
      assert.equal(screen.currentItem().seeAll, true, "classic focus restored");
      screen.onKeyDown({ keyCode: 76 });
      screen.onKeyDown({ keyCode: 76 });
      assert.equal(screen.layoutMode, "grid");
      assert.equal(screen.rows[screen.focus.row].key, lines[1].key, "grid focus restored");
      assert.equal(focusedIndex(screen.focus, screen.rows), 2);
      screen.cleanup();
    } finally {
      LayoutPreferences.set({ homeLayout: "modern" });
      Router.navigate = originalNavigate;
      catalogRepository.getCatalog = () => catalogResult();
    }
  }

  // C11 review: a modern page landing after key 76 goes into the data rows, never into the
  // capped classic copy (which would lose its cap and its See All card).
  {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    const { HOME_MAX_ITEMS_PER_ROW_CONSTRAINED } =
      await import("../js/ui/screens/home/homeConstants.js");
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    const page = (from, count) =>
      Array.from({ length: count }, (_, i) => ({ id: `q${from + i}`, type: "movie" }));
    const addons = addonRepository.getInstalledAddons;
    addonRepository.getInstalledAddons = async () => [
      {
        baseUrl: "https://addon.example",
        id: "addon",
        name: "Addon",
        catalogs: [{ id: "top", apiType: "movie", name: "Top", extra: [{ name: "skip" }] }]
      }
    ];
    let nextPage = null;
    catalogRepository.getCatalog = (params) => {
      if (!params.skip)
        return Promise.resolve({
          status: "success",
          data: { items: page(0, 20), hasMore: true, supportsSkip: true }
        });
      nextPage = deferred();
      return nextPage.promise;
    };
    try {
      const { screen } = mountScreen();
      await flush();
      const key = screen.rows[screen.focus.row].key;
      for (let step = 0; step < 20 && !nextPage; step += 1) {
        screen.onKeyDown({ keyCode: 39 });
        await advance(now + 1000);
      }
      assert.ok(nextPage, "a modern page is in flight");
      screen.onKeyDown({ keyCode: 76 });
      screen.onKeyDown({ keyCode: 76 });
      assert.equal(screen.layoutMode, "classic");
      nextPage.resolve({ status: "success", data: { items: page(20, 10), hasMore: true } });
      await flush();
      const classic = screen.rows.find((row) => row.key === key);
      assert.equal(classic.items.length, HOME_MAX_ITEMS_PER_ROW_CONSTRAINED + 1, "cap kept");
      assert.equal(classic.items.at(-1).seeAll, true, "See All kept");
      const model = screen.modelRows.find((row) => row.key === key);
      assert.equal(model.items.length, 30, "the page reached the data row");
      screen.cleanup();
    } finally {
      LayoutPreferences.set({ homeLayout: "modern" });
      addonRepository.getInstalledAddons = addons;
      catalogRepository.getCatalog = () => catalogResult();
    }
  }

  // C12, every layout: a timed-out catalog draws skeleton cards (not focusable, no image), is
  // retried silently after the deferred pass, fills in place, and focus does not move.
  for (const mode of ["modern", "classic", "grid"]) {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    LayoutPreferences.set({ homeLayout: mode });
    const addons = addonRepository.getInstalledAddons;
    addonRepository.getInstalledAddons = async () => [
      {
        baseUrl: "https://addon.example",
        id: "addon",
        name: "Addon",
        catalogs: [
          { id: "top", apiType: "movie", name: "Top" },
          { id: "slow", apiType: "movie", name: "Slow" }
        ]
      }
    ];
    const slowCalls = [];
    catalogRepository.getCatalog = (params) => {
      if (params.catalogId !== "slow") return Promise.resolve(catalogPage);
      const call = deferred();
      slowCalls.push(call);
      return call.promise;
    };
    try {
      const { screen } = mountScreen();
      await flush();
      if (screen.rows[screen.focus.row]?.kind === "hero") screen.onKeyDown({ keyCode: 40 });
      screen.onKeyDown({ keyCode: 39 });
      await advance(now + 1000);
      const focusedKey = screen.rows[screen.focus.row].key;
      const focusedId = screen.view.focusedNode()?.dataset.itemId;
      assert.equal(focusedId, "m1", `${mode}: focus on the second card`);

      await advance(now + 3500);
      const slowModel = screen.modelRows.find((row) => row.key.includes("slow"));
      assert.equal(slowModel?.status, "loading", `${mode}: timed-out row stays loading`);
      // Grid turns the filled row into line rows (`slow#0`): the loading section goes away.
      const section = () =>
        container
          .querySelector(".tv2-rows")
          .children.find((node) =>
            node.querySelector(".tv2-row-title").textContent.includes("Slow")
          );
      const skeletons = () =>
        section()
          .querySelector(".tv2-track")
          .children.filter((node) => node.classList.contains("tv2-card-skeleton"));
      assert.equal(skeletons().length, slowModel.loadingCount, `${mode}: skeleton cards`);
      assert.ok(slowModel.loadingCount > 0);
      assert.ok(
        skeletons().every((node) => !node.classList.contains("focusable") && !node.dataset.itemId),
        `${mode}: skeletons are not focusable and carry no item`
      );
      assert.equal(section().querySelector(".tv2-row-status").textContent, "");
      assert.equal(screen.rows[screen.focus.row].key, focusedKey, `${mode}: focus kept`);

      assert.equal(slowCalls.length, 2, `${mode}: one silent retry after the deferred pass`);
      slowCalls[1].resolve({
        status: "success",
        data: { items: [{ id: "s0", type: "movie", name: "S0" }] }
      });
      await flush();
      assert.equal(
        screen.modelRows.find((row) => row.key.includes("slow")).status,
        "success",
        `${mode}: the retry fills the row`
      );
      assert.equal(skeletons().length, 0, `${mode}: skeletons removed`);
      assert.equal(screen.rows[screen.focus.row].key, focusedKey, `${mode}: focus did not jump`);
      assert.equal(screen.view.focusedNode()?.dataset.itemId, focusedId);
      screen.cleanup();
    } finally {
      LayoutPreferences.set({ homeLayout: "modern" });
      addonRepository.getInstalledAddons = addons;
      catalogRepository.getCatalog = () => catalogResult();
    }
  }

  // C13: a route return draws the last visit's rows before any repository call, then merges a
  // background refresh (same page-one head keeps the cards, a removed catalog leaves); catalogs
  // refresh again after 15 min while mounted; the phone remote's Home is a sidebar reselect.
  {
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    catalogResult = async () => catalogPage;
    const addons = addonRepository.getInstalledAddons;
    const recent = watchProgressRepository.getRecent;
    const repoCalls = [];
    addonRepository.getInstalledAddons = async (...args) => {
      repoCalls.push("addons");
      return addons(...args);
    };
    watchProgressRepository.getRecent = async (...args) => {
      repoCalls.push("recent");
      return recent(...args);
    };
    try {
      const { screen, calls } = mountScreen();
      await advance(now + 1000);
      const posterKey = screen.rows.find((row) => row.kind === "poster").key;
      const cards = screen.modelRows.find((row) => row.key === posterKey).items;
      screen.onKeyDown({ keyCode: 39 });
      screen.cleanup();
      repoCalls.length = 0;
      const drawn = calls.setRows;
      screen.applyRows = function (rows) {
        repoCalls.push(`rows:${rows.some((row) => row.key === posterKey)}`);
        return NewHomeScreen.applyRows.call(this, rows);
      };
      void screen.mount({}, { previousRoute: "detail" });
      delete screen.applyRows;
      assert.ok(calls.setRows > drawn);
      assert.equal(repoCalls[0], "rows:true", "cached rows drawn before any repository call");
      assert.ok(screen.rows.some((row) => row.key === posterKey && row.items.length));
      assert.equal(screen.rows[screen.focus.row].key, posterKey, "focus restored");
      assert.equal(focusedIndex(screen.focus, screen.rows), 1);
      await advance(now + 1000);
      assert.ok(repoCalls.includes("addons"), "background refresh");
      assert.equal(
        screen.modelRows.find((row) => row.key === posterKey).items,
        cards,
        "same page-one head: cards (and pagination) kept"
      );
      assert.equal(focusedIndex(screen.focus, screen.rows), 1, "focus kept by the refresh");

      // Stale catalogs: a refresh 15 min after the last load, none after cleanup.
      repoCalls.length = 0;
      await advance(now + 15 * 60 * 1000);
      assert.ok(repoCalls.includes("addons"), "catalogs refreshed once stale");
      repoCalls.length = 0;

      // Phone remote Home while on Home: remount on the first card, sidebar closed.
      screen.cleanup();
      void screen.mount({}, { previousRoute: "home" });
      assert.equal(screen.sidebarIndex, -1);
      assert.equal(focusedIndex(screen.focus, screen.rows), 0, "back on the first card");
      await advance(now + 1000);
      screen.cleanup();
      repoCalls.length = 0;
      await advance(now + 16 * 60 * 1000);
      assert.deepEqual(repoCalls, [], "no refresh after cleanup");

      // A catalog removed meanwhile leaves on return (configured keys).
      addonRepository.getInstalledAddons = async () => [
        { baseUrl: "https://addon.example", id: "addon", name: "Addon", catalogs: [] }
      ];
      void screen.mount({}, { previousRoute: "addons" });
      assert.ok(
        screen.rows.some((row) => row.key === posterKey),
        "drawn until the refresh"
      );
      await advance(now + 1000);
      assert.ok(!screen.modelRows.some((row) => row.key === posterKey), "removed catalog left");
      screen.cleanup();
    } finally {
      addonRepository.getInstalledAddons = addons;
      watchProgressRepository.getRecent = recent;
    }
  }

  // C13: a profile change (or forceReload) reloads everything and drops the return snapshot.
  {
    now = 0;
    timers.clear();
    const active = ProfileManager.getActiveProfileId;
    try {
      const { screen } = mountScreen();
      await advance(now + 1000);
      const posterKey = screen.rows.find((row) => row.kind === "poster").key;
      screen.onKeyDown({ keyCode: 39 });
      screen.cleanup();
      assert.ok(screen.lastSnapshot);
      ProfileManager.getActiveProfileId = () => "another-profile";
      void screen.mount({}, { previousRoute: "profileSelection" });
      assert.equal(screen.lastSnapshot, null, "snapshot dropped");
      assert.equal(screen.pendingSnapshot, null);
      assert.ok(!screen.rows.some((row) => row.key === posterKey), "nothing cached drawn");
      await advance(now + 1000);
      assert.equal(focusedIndex(screen.focus, screen.rows), 0, "first card");
      screen.onKeyDown({ keyCode: 39 });
      screen.cleanup();
      void screen.mount({ forceReload: true }, { previousRoute: "settings" });
      assert.equal(screen.lastSnapshot, null, "forceReload drops it too");
      assert.ok(!screen.rows.some((row) => row.key === posterKey));
      screen.cleanup();
    } finally {
      ProfileManager.getActiveProfileId = active;
    }
  }

  // C13: a startup pull refreshes Continue Watching alone (watch state) or everything (changed
  // inputs); another profile's pull is ignored; cleanup unsubscribes. Addon manifests refresh.
  {
    now = 0;
    timers.clear();
    const subscribe = StartupSyncService.subscribeToPullCompleted;
    const recent = watchProgressRepository.getRecent;
    let listener = null;
    // Catalog pages count full refreshes (Continue Watching enrichment also reads the addons).
    let addonCalls = 0;
    StartupSyncService.subscribeToPullCompleted = (fn) => {
      listener = fn;
      return () => listener === fn && (listener = null);
    };
    catalogRepository.getCatalog = () => {
      addonCalls += 1;
      return catalogResult();
    };
    try {
      const { screen } = mountScreen();
      await advance(now + 1000);
      assert.ok(!screen.rows.some((row) => row.key === "continue_watching"));
      addonCalls = 0;
      watchProgressRepository.getRecent = async () => [
        {
          contentId: "tt9",
          contentType: "movie",
          title: "Resume",
          poster: "https://img.invalid/tt9.jpg",
          positionMs: 10,
          durationMs: 100,
          updatedAt: 1
        }
      ];
      listener({ profileId: "another-profile", source: "watch-state" });
      await advance(now + 1000);
      assert.ok(!screen.rows.some((row) => row.key === "continue_watching"), "other profile");
      listener({ source: "watch-state" });
      await advance(now + 1000);
      assert.ok(
        screen.rows.some((row) => row.key === "continue_watching" && row.items.length),
        "Continue Watching refreshed"
      );
      assert.equal(addonCalls, 0, "Continue Watching only");
      assert.ok(screen.rows.some((row) => row.kind === "poster" && row.items.length));
      listener({ changedHomeInputs: true });
      await advance(now + 1000);
      assert.equal(addonCalls, 1, "changed inputs refresh everything");
      addonRepository.notifyManifestCacheChanged();
      await advance(now + 1000);
      assert.equal(addonCalls, 2, "a manifest change refreshes everything");
      screen.cleanup();
      assert.equal(listener, null, "unsubscribed on cleanup");
      addonRepository.notifyManifestCacheChanged();
      await advance(now + 1000);
      assert.equal(addonCalls, 2, "no addon refresh after cleanup");
    } finally {
      StartupSyncService.subscribeToPullCompleted = subscribe;
      catalogRepository.getCatalog = () => catalogResult();
      watchProgressRepository.getRecent = recent;
    }
  }

  // C13 review: a watch-state pull queued during the cold load neither ends the timed-out row's
  // silent retry (D1) nor cancels the 15 min catalog refresh.
  {
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    const subscribe = StartupSyncService.subscribeToPullCompleted;
    const addons = addonRepository.getInstalledAddons;
    let listener = null;
    let addonCalls = 0;
    StartupSyncService.subscribeToPullCompleted = (fn) => {
      listener = fn;
      return () => listener === fn && (listener = null);
    };
    addonRepository.getInstalledAddons = async () => {
      addonCalls += 1;
      return [
        {
          baseUrl: "https://addon.example",
          id: "addon",
          name: "Addon",
          catalogs: [
            { id: "top", apiType: "movie", name: "Top" },
            { id: "slow", apiType: "movie", name: "Slow" }
          ]
        }
      ];
    };
    const slowCalls = [];
    catalogRepository.getCatalog = (params) => {
      if (params.catalogId !== "slow") return Promise.resolve(catalogPage);
      const call = deferred();
      slowCalls.push(call);
      return call.promise;
    };
    try {
      const { screen } = mountScreen();
      await flush();
      listener({ source: "watch-state" });
      await advance(now + 3500);
      assert.ok(slowCalls.length >= 2, "retried after the deferred pass");
      slowCalls.forEach((call) =>
        call.resolve({ status: "success", data: { items: [{ id: "s0", type: "movie" }] } })
      );
      await advance(now + 1000);
      assert.equal(
        screen.modelRows.find((row) => row.key.includes("slow"))?.status,
        "success",
        "the pending row still fills"
      );
      addonCalls = 0;
      await advance(now + 15 * 60 * 1000);
      assert.ok(addonCalls > 0, "catalogs still refresh once stale");
      screen.cleanup();

      // Every catalog loaded: the queued pull refreshes Continue Watching alone, the timer stays.
      catalogRepository.getCatalog = () => Promise.resolve(catalogPage);
      const cold = mountScreen().screen;
      assert.ok(cold.loading);
      listener({ source: "watch-state" });
      await advance(now + 1000);
      addonCalls = 0;
      await advance(now + 15 * 60 * 1000);
      assert.ok(addonCalls > 0, "the 15 min refresh survives a queued Continue Watching refresh");
      cold.cleanup();
    } finally {
      StartupSyncService.subscribeToPullCompleted = subscribe;
      addonRepository.getInstalledAddons = addons;
      catalogRepository.getCatalog = () => catalogResult();
    }
  }

  // C13: the remote sidebar profile replaces the local one; an open sidebar keeps a real item.
  {
    now = 0;
    timers.clear();
    const profiles = ProfileManager.getProfiles;
    const names = ["Local", "Remote"];
    ProfileManager.getProfiles = async () => [{ id: "1", name: names.shift() || "Remote" }];
    // The profile pill's accent fallback reads the theme.
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    try {
      const { screen } = mountScreen();
      screen.sidebarIndex = 7;
      await flush();
      assert.equal(screen.profile.activeProfileName, "Remote", "remote profile shown");
      assert.equal(screen.sidebarIndex, 0, "sidebar focus clamped");
      screen.cleanup();
    } finally {
      ProfileManager.getProfiles = profiles;
      delete globalThis.getComputedStyle;
    }
  }

  // C13: modern sidebar pill: label, icon-only after 4 s or on Down, label again on Up; a Back
  // return starts icon-only.
  {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    now = 0;
    timers.clear();
    LayoutPreferences.set({ modernSidebar: true });
    try {
      const { screen } = mountScreen();
      const pill = () => container.querySelector(".modern-sidebar-pill");
      await flush();
      assert.equal(screen.pillIconOnly, false);
      await advance(now + 4000);
      assert.equal(screen.pillIconOnly, true, "icon only after 4 s");
      assert.ok(pill().classList.contains("icon-only"));
      screen.onKeyDown({ keyCode: 38 });
      assert.equal(screen.pillIconOnly, false, "Up shows the label");
      assert.ok(!pill().classList.contains("icon-only"));
      screen.onKeyDown({ keyCode: 40 });
      assert.equal(screen.pillIconOnly, true, "Down hides it");
      screen.cleanup();
      void screen.mount({}, { isBackNavigation: true, previousRoute: "detail" });
      assert.equal(screen.pillIconOnly, true, "a Back return starts icon-only");
      screen.cleanup();
    } finally {
      LayoutPreferences.set({ modernSidebar: false });
    }
  }

  // G2: Home left from the sidebar comes back with its sidebar open on Home (current Home
  // restoreSidebarFocusState), the rails focus kept underneath; a Back return with a content
  // route state goes back to the card, as the current Home's captureRouteState prefers it.
  {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    LayoutPreferences.set({ modernSidebar: true });
    try {
      const { screen } = mountScreen();
      await flush();
      screen.onKeyDown({ keyCode: 39 });
      const rowKey = screen.rows[screen.focus.row].key;
      screen.openSidebar(false);
      const routeState = screen.captureRouteState();
      screen.cleanup();
      void screen.mount({}, { previousRoute: "search" });
      assert.ok(screen.sidebarIndex >= 0, "the sidebar is open again");
      assert.equal(screen.sidebarOpenedByBack, false, "Back closes it, never exits");
      assert.equal(screen.pillIconOnly, false);
      assert.equal(screen.rows[screen.focus.row].key, rowKey, "rails focus kept underneath");
      assert.equal(focusedIndex(screen.focus, screen.rows), 1);
      screen.closeSidebar();
      screen.cleanup();
      void screen.mount({}, { isBackNavigation: true, restoredState: routeState });
      assert.equal(screen.sidebarIndex, -1, "a Back return to a card keeps the sidebar closed");
      assert.equal(screen.pillIconOnly, true);
      assert.equal(focusedIndex(screen.focus, screen.rows), 1);
      screen.cleanup();
      void screen.mount({}, { previousRoute: "search" });
      assert.equal(screen.sidebarIndex, -1, "left from the rails: no sidebar on return");
      screen.cleanup();
    } finally {
      LayoutPreferences.set({ modernSidebar: false });
    }
  }

  // G2: no focused card under a hold menu (current Home lockHomeHoldFocus); it comes back when
  // the menu is dismissed or closes after Remove.
  {
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    PosterOptionsDialogController.prototype.open = async () => true;
    const { screen } = mountScreen();
    await flush();
    const focusedCard = () =>
      container
        .querySelector(".tv2-rows")
        .children.flatMap((section) => section.querySelector(".tv2-track").children)
        .filter((node) => node.classList.contains("focused"));
    assert.equal(focusedCard().length, 1);
    screen.onKeyDown({ keyCode: 13 });
    await advance(now + 650);
    await flush();
    assert.equal(screen.view.focusedNode(), null, "no focused card under the poster menu");
    assert.equal(focusedCard().length, 0, "no focus ring under the poster menu");
    screen.posterMenu.onDismiss();
    assert.equal(focusedCard().length, 1, "the ring is back once the menu closes");
    assert.equal(screen.view.focusedNode()?.dataset.itemId, "m0");

    const cw = normalizeContinueWatchingItem({
      contentId: "tt3",
      type: "movie",
      title: "Film",
      positionMs: 1000,
      durationMs: 5000
    });
    screen.applyRows([
      { key: "continue_watching", kind: "continue", title: "CW", status: "success", items: [cw] },
      ...screen.modelRows
    ]);
    screen.focus = { ...screen.focus, row: 0 };
    screen.render();
    screen.onKeyDown({ keyCode: 13 });
    await advance(now + 650);
    assert.ok(screen.cwDialog);
    assert.equal(focusedCard().length, 0, "no focus ring under the Continue Watching menu");
    screen.cwDialog._dismiss();
    assert.equal(focusedCard().length, 1, "Back on the menu brings the ring back");
    screen.cleanup();
    await advance(now + 220);
    PosterOptionsDialogController.prototype.open = originalPosterOpen;
  }

  // G2: classic/grid with heroSectionEnabled off (current Home showHeroSection): no hero row, no
  // hero write or enrichment, and no rotation even where it would run (performance mode full).
  for (const mode of ["classic", "grid"]) {
    const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
    const { setTvPerformanceMode } = await import("../js/platform/tvRuntimePerformance.js");
    now = 0;
    timers.clear();
    resetVidaaNavigationActivity();
    LayoutPreferences.set({ homeLayout: mode, heroSectionEnabled: false });
    setTvPerformanceMode("full");
    const enriched = [];
    heroMeta = (type, id) => (enriched.push(id), new Promise(() => {}));
    try {
      const { screen, calls } = mountScreen();
      await flush();
      assert.ok(!screen.rows.some((row) => row.kind === "hero"), `${mode}: no hero row`);
      await advance(now + 60000);
      assert.deepEqual(calls.setHero.filter(Boolean), [], `${mode}: no hero written`);
      assert.deepEqual(enriched, [], `${mode}: no hero enrichment`);
      assert.equal(screen.rotateTimer || null, null, `${mode}: no hero rotation`);
      screen.cleanup();
    } finally {
      setTvPerformanceMode("auto");
      LayoutPreferences.set({ homeLayout: "modern", heroSectionEnabled: true });
      heroMeta = () => new Promise(() => {});
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
