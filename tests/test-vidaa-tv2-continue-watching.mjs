import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C3): Continue Watching matches the current Home's
// (getRecent, snapshot first, enrichment after the first catalog batch, upcoming split, setting, startup pull).
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
async function flush() {
  for (let i = 0; i < 64; i++) await Promise.resolve();
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const {
  addonRepository,
  catalogRepository,
  metaRepository,
  watchedItemsRepository,
  watchProgressRepository,
  LayoutPreferences,
  CollectionsStore,
  StartupSyncService,
  WatchProgressSource,
  writeContinueWatchingDisplaySnapshot,
  buildVisibleContinueWatchingItems
} = await import("../js/ui/screens/home/homeScreenContext.js");
const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");
const { t } =
  await import("../js/ui/screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js");
const { loadHomeRows, continueWatchingRows } = await import("../js/ui/tv2/homeModel.js");

const originals = [];
function replace(object, key, value) {
  originals.push([object, key, object[key]]);
  object[key] = value;
}

const movie = (id, updatedAt, extra = {}) => ({
  contentId: id,
  contentType: "movie",
  title: `Raw ${id}`,
  poster: `https://img.invalid/${id}.jpg`,
  positionMs: 10,
  durationMs: 100,
  updatedAt,
  ...extra
});
const recent = [movie("r1", 5), movie("r2", 4)];
const allProgress = [
  ...recent,
  movie("done1", 3, { positionMs: 100 }),
  movie("done2", 2, { positionMs: 100 }),
  movie("done3", 1, { positionMs: 100 })
];
let prefs = { homeLayout: "modern", continueWatchingEnabled: true };
let recentCalls = 0;
let metaCalls = 0;
let catalogGate = deferred();
let recentResult = recent;

replace(LayoutPreferences, "get", () => prefs);
replace(CollectionsStore, "get", () => []);
replace(addonRepository, "getInstalledAddons", async () => [
  {
    id: "alpha",
    baseUrl: "https://alpha.invalid",
    displayName: "Alpha",
    catalogs: [{ id: "c0", name: "c0", apiType: "movie" }]
  }
]);
replace(catalogRepository, "getCatalog", async () => {
  await catalogGate.promise;
  return { status: "success", data: { items: [{ id: "m0", type: "movie", name: "M0" }] } };
});
replace(catalogRepository, "getSavedCatalog", () => null);
replace(watchedItemsRepository, "getAll", async () => []);
replace(watchProgressRepository, "getRecent", async () => {
  recentCalls += 1;
  return recentResult;
});
replace(watchProgressRepository, "getAllForContinueWatching", async () => allProgress);
replace(watchProgressRepository, "getContinueWatchingSource", () => WatchProgressSource.NUVIO_SYNC);
replace(metaRepository, "getMetaFromAllAddons", async (type, id) => {
  metaCalls += 1;
  return {
    status: "success",
    data: { id, type, name: `Meta ${id}`, poster: `https://img.invalid/m-${id}.jpg` }
  };
});
replace(Recommendations, "snapshot", () => ({ forYou: [], because: [], becauseTitle: null }));
replace(Recommendations, "refresh", async () => {});

const cw = (rows) => rows.find((row) => row.key === "continue_watching");
const ids = (row) => row?.items.map((item) => item.id);

try {
  // getRecent is the list (2 items), not every progress entry (5); enrichment waits for the first batch.
  const emits = [];
  const loading = loadHomeRows({ onRows: (rows) => emits.push(rows) });
  assert.equal(emits.length, 1, "first emit before any await");
  assert.equal(
    cw(emits[0]).status,
    "loading",
    "no snapshot: CW placeholder anchors the first paint"
  );
  await flush();
  assert.deepEqual(ids(cw(emits.at(-1))), ["r1", "r2"], "raw getRecent items before enrichment");
  assert.equal(cw(emits.at(-1)).items[0].title, "Raw r1");
  assert.equal(metaCalls, 0, "no meta request before the first catalog batch");
  catalogGate.resolve();
  await loading;
  await flush();
  const enriched = cw(emits.at(-1));
  assert.deepEqual(
    ids(enriched),
    ["r1", "r2"],
    "enriched getRecent items, not the 5 progress entries"
  );
  assert.equal(enriched.items[0].title, "Meta r1", "enriched in the background");
  assert.equal(enriched.kind, "continue");
  assert.equal(enriched.title, t("home.continueWatching", {}, "Continue Watching"));
  assert.equal(enriched.status, "success");
  assert.ok(metaCalls > 0);
  assert.ok(storage.size > 0, "display snapshot written");

  // Snapshot present: the first, synchronous emit already holds it.
  catalogGate = deferred();
  const snapshotEmits = [];
  const second = loadHomeRows({ onRows: (rows) => snapshotEmits.push(rows) });
  assert.equal(snapshotEmits.length, 1);
  assert.deepEqual(ids(cw(snapshotEmits[0])), ["r1", "r2"]);
  assert.equal(cw(snapshotEmits[0]).items[0].title, "Meta r1", "snapshot items, enriched");
  catalogGate.resolve();
  await second;
  await flush();

  // split_upcoming: unaired Next Up items move to their own row, drawn as continue cards.
  const display = [
    { id: "a", contentId: "a", isNextUp: true, hasAired: false },
    { id: "b", contentId: "b" }
  ];
  const split = continueWatchingRows(display, { sortMode: "split_upcoming" });
  assert.deepEqual(
    split.map((row) => [row.key, row.kind, ids(row)]),
    [
      ["continue_watching", "continue", ["b"]],
      ["upcoming_section", "continue", ["a"]]
    ]
  );
  assert.equal(continueWatchingRows(display).length, 1, "default mode keeps one row");
  assert.deepEqual(continueWatchingRows([]), [], "empty and resolved: no row");

  // Setting off: no CW row and no progress read.
  prefs = { homeLayout: "modern", continueWatchingEnabled: false };
  recentCalls = 0;
  const offEmits = [];
  await loadHomeRows({ onRows: (rows) => offEmits.push(rows) });
  await flush();
  assert.ok(offEmits.every((rows) => !rows.some((row) => row.kind === "continue")));
  assert.equal(recentCalls, 0);

  // Startup pull pending with empty local data: keep the placeholder, then reload once pulled.
  prefs = { homeLayout: "modern", continueWatchingEnabled: true };
  storage.clear();
  const pull = deferred();
  let pending = true;
  replace(StartupSyncService, "isCurrentProfilePullPending", () => pending);
  replace(StartupSyncService, "getCurrentProfilePullPromise", () =>
    pending ? pull.promise : null
  );
  recentResult = [];
  replace(watchProgressRepository, "getAllForContinueWatching", async () => []);
  const pullEmits = [];
  await loadHomeRows({ onRows: (rows) => pullEmits.push(rows) });
  await flush();
  assert.equal(cw(pullEmits.at(-1))?.status, "loading", "CW waits for the startup pull");
  pending = false;
  recentResult = recent;
  pull.resolve();
  await flush();
  await flush();
  assert.deepEqual(ids(cw(pullEmits.at(-1))), ["r1", "r2"], "pulled progress published");

  // Same visible items as the current Home's raw publish.
  assert.deepEqual(
    buildVisibleContinueWatchingItems(recent, { requireArtwork: false }).map((item) => item.id),
    ["r1", "r2"]
  );
  console.log("PASS: VIDAA tv2 Continue Watching parity");
} finally {
  for (const [object, key, value] of originals.reverse()) object[key] = value;
}
