import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C1): catalog rows match the current Home's (same descriptors,
// order, keys, request options, release filter); a dead catalog no longer blocks later rows.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.fetch = async () => {
  throw new Error("No network is permitted in this fixture");
};

let now = 100_000;
let nextTimer = 0;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextTimer;
  timers.set(id, { callback, at: now + Number(delay) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
async function flush() {
  for (let i = 0; i < 64; i++) await Promise.resolve();
}
async function advance(ms) {
  const until = now + ms;
  for (let i = 0; ; i++) {
    assert.ok(i < 2000, "No permanent polling");
    const next = [...timers]
      .filter(([, timer]) => timer.at <= until)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]);
    now = next[1].at;
    next[1].callback();
    await flush();
  }
  now = until;
  await flush();
}

const {
  Router,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchProgressRepository,
  LayoutPreferences,
  CollectionsStore,
  HomeCatalogStore,
  buildCatalogOrderKey,
  buildCatalogDisableKey
} = await import("../js/ui/screens/home/homeScreenContext.js");
const { createHomeScreenMethods03 } =
  await import("../js/ui/screens/home/homeScreenMethods-03-is-scroll-animation-active.js");
const { createHomeScreenMethods21 } =
  await import("../js/ui/screens/home/homeScreenMethods-21-load-data.js");
const { createHomeScreenMethods22 } =
  await import("../js/ui/screens/home/homeScreenMethods-22-pick-initial-hero.js");
const { buildVisibleHomeCatalogDescriptors } =
  await import("../js/ui/screens/home/homeCatalogDescriptors.js");
const { formatCatalogRowTitle } = await import("../js/ui/screens/home/homeUtils.js");
const { t } =
  await import("../js/ui/screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js");
const { loadHomeRows } = await import("../js/ui/tv2/homeModel.js");

const originals = [];
function replace(object, key, value) {
  originals.push([object, key, object[key]]);
  object[key] = value;
}

// 17 manifest entries: an exact duplicate, a search-only catalog and a disabled one leave
// 14 visible; c5 answers empty, c3 never answers.
const movieCatalogs = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i}`,
  name: `movies ${i}`,
  apiType: "movie"
}));
const addons = [
  {
    id: "alpha",
    baseUrl: "https://alpha.invalid",
    displayName: "Alpha",
    catalogs: [
      ...movieCatalogs,
      movieCatalogs[0],
      { id: "find", name: "Find", apiType: "movie", extra: [{ name: "search", isRequired: true }] }
    ]
  },
  {
    id: "beta",
    baseUrl: "https://beta.invalid",
    displayName: "Beta",
    catalogs: [
      { id: "s0", name: "Shows", apiType: "series", extra: [{ name: "skip" }], pageSize: 50 },
      { id: "s1", name: "Shows 1", apiType: "series" },
      { id: "s2", name: "Shows 2", apiType: "series" }
    ]
  }
];
const key = (addonId, type, id) => buildCatalogOrderKey(addonId, type, id);
const catalogPrefs = {
  order: [key("beta", "series", "s2")],
  disabled: [buildCatalogDisableKey("https://alpha.invalid", "movie", "c11", "movies 11")],
  customTitles: { [key("alpha", "movie", "c1")]: "Mes favoris" }
};
const requests = [];
function getCatalog(args) {
  requests.push(args);
  if (args.catalogId === "c3") return new Promise(() => {});
  const items =
    args.catalogId === "c5"
      ? []
      : [
          { id: `${args.catalogId}-a`, type: args.type, name: "A" },
          { id: `${args.catalogId}-future`, type: args.type, released: "2099-01-01" }
        ];
  const data = { items, ...(args.catalogId === "s0" ? { hasMore: true, nextSkip: 50 } : {}) };
  return Promise.resolve({ status: "success", data });
}

replace(Router, "getCurrent", () => "home");
replace(LayoutPreferences, "get", () => ({
  homeLayout: "modern",
  continueWatchingEnabled: false,
  hideUnreleasedContent: true
}));
replace(CollectionsStore, "get", () => []);
replace(addonRepository, "getInstalledAddons", async () => addons);
replace(catalogRepository, "getCatalog", getCatalog);
replace(catalogRepository, "getSavedCatalog", () => null);
const never = () => new Promise(() => {});
replace(watchedItemsRepository, "getAll", never);
replace(watchProgressRepository, "getRecent", never);
replace(watchProgressRepository, "getAllForContinueWatching", async () => []);

try {
  HomeCatalogStore.set({ ...catalogPrefs }, { silentSync: true });
  const { uniqueCatalogDescriptors, visibleCatalogDescriptors } =
    buildVisibleHomeCatalogDescriptors(addons);
  assert.equal(uniqueCatalogDescriptors.length, 15, "duplicate collapsed, search-only hidden");
  assert.equal(visibleCatalogDescriptors.length, 14, "disabled catalog dropped");
  assert.equal(visibleCatalogDescriptors[0].catalogId, "s2", "user order first");
  const expectedKeys = visibleCatalogDescriptors
    .map((d) => key(d.addonId, d.type, d.catalogId))
    .filter((k) => k !== key("alpha", "movie", "c5"));

  // New Home.
  const emits = [];
  const loading = loadHomeRows({ onRows: (rows) => emits.push(rows) });
  await flush();
  const latest = () => emits.at(-1);
  assert.equal(latest()[0].key, "continue_watching");
  assert.equal(latest()[0].title, t("home.continueWatching", {}, "Continue Watching"));
  await advance(3499);
  assert.ok(
    !latest().some((row) => row.key === key("alpha", "movie", "c3")),
    "the dead catalog is still pending"
  );
  await advance(10_000);
  await loading;
  const rows = latest().filter((row) => row.kind !== "continue");
  assert.deepEqual(
    rows.map((row) => row.key),
    expectedKeys,
    "same rows, same order; the empty catalog is dropped"
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const dead = byKey.get(key("alpha", "movie", "c3"));
  assert.equal(dead.status, "loading", "a timed-out row stays loading (D1), never an error");
  assert.deepEqual(dead.items, []);
  const c2 = byKey.get(key("alpha", "movie", "c2"));
  assert.deepEqual(
    c2.items.map((item) => item.id),
    ["c2-a"],
    "unreleased items filtered"
  );
  assert.equal(c2.items[0].addonBaseUrl, "https://alpha.invalid");
  assert.equal(c2.items[0].catalogType, "movie");
  assert.equal(c2.title, formatCatalogRowTitle("movies 2", "movie", true));
  assert.equal(
    byKey.get(key("alpha", "movie", "c1")).title,
    formatCatalogRowTitle("Mes favoris", "movie", true)
  );
  const s0 = byKey.get(key("beta", "series", "s0"));
  assert.deepEqual(
    [s0.hasMore, s0.nextSkip, s0.supportsSkip, s0.skipStep],
    [true, 50, true, 50],
    "pagination fields kept on the row"
  );
  const s0Request = requests.find((args) => args.catalogId === "s0");
  assert.deepEqual([s0Request.supportsSkip, s0Request.skipStep], [true, 50]);
  const c0Request = requests.find((args) => args.catalogId === "c0");
  assert.deepEqual([c0Request.supportsSkip, c0Request.skipStep], [false, 100]);
  assert.equal(requests.length, 14, "one request per visible catalog");

  // Current Home on the same fixture: same keys in the same order, same items.
  requests.length = 0;
  replace(watchProgressRepository, "getAllForContinueWatching", never);
  const ui = {
    ...createHomeScreenMethods03(),
    ...createHomeScreenMethods21(),
    ...createHomeScreenMethods22(),
    homeLoadToken: 1,
    rows: [],
    collections: [],
    heroCandidates: [],
    heroItem: null,
    continueWatchingDisplay: [],
    continueWatchingInitialResolved: true,
    buildSyncSensitiveHomeSignature: () => "fixture",
    buildHomeRouteInputSignature: () => "fixture",
    isVidaaHomeLoadingBusy: () => false,
    collectHeroCandidates: () => [],
    pickHeroItem: () => null,
    releaseInitialHomeLoading() {},
    maybeStartPendingHomeBackgroundRefresh() {},
    refreshWatchedTitleState() {},
    retryPendingCatalogRows() {},
    render() {},
    requestRender() {},
    requestBackgroundRender() {}
  };
  const oldLoading = ui.loadData();
  // loadData reaches its requests after more microtasks than one flush: advance in steps.
  for (let step = 0; step < 40; step++) await advance(500);
  await oldLoading;
  const oldRows = ui.rows.filter(
    (row) => row.result?.status !== "success" || row.result.data.items.length
  );
  assert.deepEqual(
    oldRows.map((row) => row.homeCatalogKey),
    rows.map((row) => row.key)
  );
  for (const row of oldRows) {
    assert.deepEqual(
      byKey.get(row.homeCatalogKey).items.map((item) => item.id),
      (row.result?.data?.items || []).map((item) => item.id)
    );
  }
} finally {
  for (const [object, name, value] of originals.reverse()) object[name] = value;
}

console.log("PASS: new TV Home catalog rows match the current Home");
