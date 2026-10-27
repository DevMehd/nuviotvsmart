import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C12): loading, failure and offline states. A timed-out catalog keeps
// its skeleton count and is retried silently after the deferred pass (D1); a VIDAA cold load
// paints the saved page one of each catalog before the network, and a failed page keeps it.
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
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const {
  Router,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchProgressRepository,
  LayoutPreferences,
  CollectionsStore,
  buildCatalogOrderKey
} = await import("../js/ui/screens/home/homeScreenContext.js");
const { CatalogSnapshotStore } = await import("../js/data/local/catalogSnapshotStore.js");
const { loadHomeRows } = await import("../js/ui/tv2/homeModel.js");
const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");

const originals = [];
function replace(object, key, value) {
  originals.push([object, key, object[key]]);
  object[key] = value;
}

const addons = [
  {
    id: "alpha",
    baseUrl: "https://alpha.invalid",
    displayName: "Alpha",
    catalogs: [
      { id: "saved", name: "Saved", apiType: "movie" },
      { id: "slow", name: "Slow", apiType: "movie" },
      { id: "fresh", name: "Fresh", apiType: "series", extra: [{ name: "skip" }], pageSize: 50 }
    ]
  }
];
const key = (id, type = "movie") => buildCatalogOrderKey("alpha", type, id);
const page = (prefix) => ({
  status: "success",
  data: { items: [0, 1, 2].map((i) => ({ id: `${prefix}${i}`, type: "movie", name: `${i}` })) }
});
let requests = [];
let answer = () => Promise.resolve(page("x"));
replace(Router, "getCurrent", () => "home");
replace(LayoutPreferences, "get", () => ({ homeLayout: "modern", continueWatchingEnabled: false }));
replace(CollectionsStore, "get", () => []);
replace(addonRepository, "getInstalledAddons", async () => addons);
replace(catalogRepository, "getCatalog", (args) => {
  requests.push(args);
  return answer(args);
});
const never = () => new Promise(() => {});
replace(watchedItemsRepository, "getAll", async () => []);
replace(watchProgressRepository, "getRecent", never);
replace(watchProgressRepository, "getAllForContinueWatching", async () => []);
replace(Recommendations, "refresh", async () => {});

try {
  // Online load: every page answers. Its requests give the cache keys the repository saves under.
  await loadHomeRows({ onRows: () => {} });
  await flush();
  for (const args of requests.filter((args) => args.catalogId !== "slow")) {
    const cacheKey = catalogRepository.buildCacheKey({
      ...args,
      skipStep: catalogRepository.normalizeSkipStep(args.skipStep),
      extraArgs: {}
    });
    CatalogSnapshotStore.put(cacheKey, {
      addonId: "alpha",
      addonBaseUrl: "https://alpha.invalid",
      addonName: "Alpha",
      apiType: args.type,
      items: page(`saved-${args.catalogId}-`).data.items
    });
  }

  // Cold load: "saved" never answers, "slow" fails then answers its retry, "fresh" answers late.
  requests = [];
  const slowRetry = deferred();
  const freshPage = deferred();
  answer = (args) => {
    if (args.catalogId === "saved") return never();
    if (args.catalogId === "fresh") return freshPage.promise;
    return requests.filter((r) => r.catalogId === "slow").length === 1
      ? Promise.resolve({ status: "error", message: "offline" })
      : slowRetry.promise;
  };
  const emits = [];
  const loading = loadHomeRows({ onRows: (rows) => emits.push(rows) });
  await flush();
  const latest = () => new Map(emits.at(-1).map((row) => [row.key, row]));
  const ids = (row) => row?.items.map((item) => item.id);
  assert.deepEqual(
    ids(latest().get(key("saved"))),
    ["saved-saved-0", "saved-saved-1", "saved-saved-2"],
    "the saved page paints before the network"
  );
  assert.equal(latest().get(key("saved")).status, "success");
  assert.equal(ids(latest().get(key("fresh", "series")))[0], "saved-fresh-0");
  assert.equal(latest().has(key("slow")), true, "a failed catalog shows as a loading row");
  const slow = latest().get(key("slow"));
  assert.equal(slow.status, "loading", "failure stays loading (D1), never an error");
  assert.deepEqual(slow.items, []);
  assert.ok(slow.loadingCount > 0, "loading rows carry the current Home skeleton count");
  const slowIndex = emits.at(-1).findIndex((row) => row.key === key("slow"));

  freshPage.resolve(page("fresh-"));
  await flush();
  assert.equal(ids(latest().get(key("fresh", "series")))[0], "fresh-0", "network page wins");

  await advance(3500);
  await loading;
  assert.deepEqual(
    ids(latest().get(key("saved"))),
    ["saved-saved-0", "saved-saved-1", "saved-saved-2"],
    "a timed-out page keeps the saved one on screen"
  );
  // Retry after the deferred pass: the loading row and the saved row behind a failed page.
  assert.deepEqual(
    requests.map((args) => args.catalogId).sort(),
    ["fresh", "saved", "saved", "slow", "slow"],
    "one silent retry of each pending catalog"
  );
  slowRetry.resolve(page("slow-"));
  await flush();
  const filled = latest().get(key("slow"));
  assert.equal(filled.status, "success", "the retry fills the row");
  assert.deepEqual(ids(filled), ["slow-0", "slow-1", "slow-2"]);
  assert.equal(
    emits.at(-1).findIndex((row) => row.key === key("slow")),
    slowIndex,
    "filled in place"
  );
  await advance(12_000);
  assert.equal(ids(latest().get(key("saved")))[0], "saved-saved-0", "a failed retry keeps it");

  // A retry landing after a newer load (remount, profile change) is dropped.
  requests = [];
  const lateRetry = deferred();
  answer = (args) =>
    args.catalogId !== "slow"
      ? Promise.resolve(page("x"))
      : requests.filter((r) => r.catalogId === "slow").length === 1
        ? Promise.resolve({ status: "error", message: "offline" })
        : lateRetry.promise;
  let current = true;
  const staleEmits = [];
  await loadHomeRows({ isCurrent: () => current, onRows: (rows) => staleEmits.push(rows) });
  await flush();
  assert.equal(requests.filter((r) => r.catalogId === "slow").length, 2, "retry started");
  current = false;
  const count = staleEmits.length;
  lateRetry.resolve(page("late-"));
  await flush();
  assert.equal(staleEmits.length, count, "no emit from a stale retry");
} finally {
  for (const [object, name, value] of originals.reverse()) object[name] = value;
}

console.log("PASS: new TV Home loading, failure and offline states match the current Home");
