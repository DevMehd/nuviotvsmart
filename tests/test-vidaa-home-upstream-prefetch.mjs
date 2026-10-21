import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.fetch = async () => {
  throw new Error("No network is permitted in this fixture");
};

const context = await import("../js/ui/screens/home/homeScreenContext.js");
const {
  Router,
  Platform,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchProgressRepository,
  LayoutPreferences,
  CollectionsStore,
  HomeCatalogStore,
  buildCatalogOrderKey,
  buildCatalogDisableKey,
  buildCollectionHomeRow
} = context;
const { createHomeScreenMethods03 } =
  await import("../js/ui/screens/home/homeScreenMethods-03-is-scroll-animation-active.js");
const { createHomeScreenMethods04 } =
  await import("../js/ui/screens/home/homeScreenMethods-04-get-hero-focus-delay.js");
const { createHomeScreenMethods21 } =
  await import("../js/ui/screens/home/homeScreenMethods-21-load-data.js");
const { createHomeScreenMethods22 } =
  await import("../js/ui/screens/home/homeScreenMethods-22-pick-initial-hero.js");
const { resetTvRuntimePerformanceProfile, setTvPerformanceMode } =
  await import("../js/platform/tvRuntimePerformance.js");

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
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
async function advance(ms) {
  const until = now + ms;
  for (let i = 0; ; i++) {
    assert.ok(i < 1000, "No permanent polling");
    const next = [...timers]
      .filter(([, timer]) => timer.at <= until)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]);
    now = next[1].at;
    next[1].callback();
    await settle();
  }
  now = until;
  await settle();
}
function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const success = (id) => ({ status: "success", data: { items: [{ id, type: "movie" }] } });
const originals = [];
function replace(object, key, value) {
  originals.push([object, key, object[key]]);
  object[key] = value;
}
replace(Router, "getCurrent", () => "home");
replace(LayoutPreferences, "get", () => ({ homeLayout: "modern", continueWatchingEnabled: false }));
replace(CollectionsStore, "get", () => []);
// These unrelated sections must not contribute rows, renders or requests.
const never = () => new Promise(() => {});
replace(watchedItemsRepository, "getAll", never);
replace(watchProgressRepository, "getAllForContinueWatching", never);
replace(watchProgressRepository, "getRecent", never);
const originalCatalog = catalogRepository.getCatalog;
const originalAddons = addonRepository.getInstalledAddons;

function fixture({
  count = 20,
  batchSize = 8,
  constrained = false,
  legacy = false,
  actualVidaa = false,
  catalogPrefs = {},
  collections = []
} = {}) {
  timers.clear();
  HomeCatalogStore.set(
    { order: [], disabled: [], customTitles: {}, ...catalogPrefs },
    { silentSync: true }
  );
  CollectionsStore.get = () => collections;
  const requests = [];
  const commits = [];
  addonRepository.getInstalledAddons = async () => [
    {
      id: "fixture-addon",
      baseUrl: "https://fixture.invalid",
      displayName: "Fixture",
      catalogs: Array.from({ length: count }, (_, index) => ({
        id: `catalog-${index}`,
        name: `Row ${index}`,
        apiType: "movie"
      }))
    }
  ];
  catalogRepository.getCatalog = (args) => {
    const pending = deferred();
    requests.push({ args, ...pending });
    return pending.promise;
  };
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
    getInitialCatalogLoadCount: () => 2,
    getDeferredCatalogBatchSize: () => batchSize,
    getLoadingRowItemCount: () => 3,
    sortAndFilterRows: (rows) => rows,
    collectHeroCandidates: (rows) => rows.flatMap((row) => row.result?.data?.items || []),
    pickHeroItem: () => null,
    releaseInitialHomeLoading() {},
    maybeStartPendingHomeBackgroundRefresh() {},
    refreshWatchedTitleState() {},
    retryPendingCatalogRows() {},
    render() {
      commits.push(this.rows.slice());
    },
    requestRender() {
      commits.push(this.rows.slice());
    },
    requestBackgroundRender() {
      commits.push(this.rows.slice());
    }
  };
  if (!actualVidaa) {
    ui.isPerformanceConstrained = () => constrained;
    ui.isLegacyTvRuntime = () => legacy;
  }
  return { ui, requests, commits };
}
function resolve(request) {
  request.resolve(success(request.args.catalogId));
}
const tests = [];
const test = (name, run) => tests.push([name, run]);

test("Visible catalogs start first; foreground prefetch is one batch capped at eight", async () => {
  for (const batchSize of [3, 12]) {
    const { ui, requests } = fixture({ batchSize });
    const loading = ui.loadData();
    await settle();
    assert.deepEqual(
      requests.map((request) => request.args.catalogId),
      Array.from({ length: 2 + Math.min(8, batchSize) }, (_, i) => `catalog-${i}`)
    );
    assert.deepEqual(ui.rows, [], "Prefetch cannot publish deferred rows before visible rows");
    ui.homeLoadToken++;
    requests.forEach(resolve);
    await loading;
    await settle();
    assert.deepEqual(ui.rows, []);
  }
});

test("Deferred consumers reuse pending requests without duplicating the repository fetch", async () => {
  const { ui, requests } = fixture({ count: 5, batchSize: 3 });
  const loading = ui.loadData();
  await settle();
  assert.equal(requests.length, 5);
  requests.slice(0, 2).forEach(resolve);
  await loading;
  await settle();
  assert.equal(requests.length, 5, "All three deferred promises remain pending and are reused");
  requests.slice(2).forEach(resolve);
  await settle();
  assert.equal(requests.length, 5);
  assert.equal(ui.rows.length, 5);
  assert.ok(ui.rows.every((row) => row.result.status === "success"));
});

test("Background, constrained and legacy loads skip overlapping prefetch", async () => {
  for (const options of [{ background: true }, { constrained: true }, { legacy: true }]) {
    const { ui, requests } = fixture({ count: 5, batchSize: 3, ...options });
    const loading = ui.loadData({ background: options.background });
    await settle();
    assert.equal(requests.length, 2, JSON.stringify(options));
    requests.slice().forEach(resolve);
    await loading;
    await settle();
    assert.equal(requests.length, 5, "Deferred rows still load after the first batch");
    requests.slice(2).forEach(resolve);
    await settle();
    assert.equal(ui.rows.length, 5);
  }
});

test("Actual VIDAA auto performance policy excludes the extra prefetch batch", async () => {
  globalThis.__NUVIO_PLATFORM__ = "vidaa";
  Platform.current = null;
  setTvPerformanceMode("auto");
  resetTvRuntimePerformanceProfile();
  const { ui, requests } = fixture({ actualVidaa: true, count: 5, batchSize: 3 });
  assert.equal(ui.isPerformanceConstrained(), true);
  const loading = ui.loadData();
  await settle();
  assert.equal(requests.length, 2);
  ui.homeLoadToken++;
  requests.forEach(resolve);
  await loading;
});

test("Initial requests follow Home order and skip disabled rows before occupying a slot", async () => {
  const key = (index) => buildCatalogOrderKey("fixture-addon", "movie", `catalog-${index}`);
  const collection = {
    id: "fixture-collection",
    title: "Pinned collection",
    pinToTop: true,
    folders: [{ id: "fixture-folder", title: "Folder" }]
  };
  const collectionKey = buildCollectionHomeRow(collection).homeCatalogKey;
  const { ui, requests, commits } = fixture({
    count: 10,
    constrained: true,
    batchSize: 3,
    collections: [collection],
    catalogPrefs: {
      order: [key(8), key(5)],
      disabled: [
        key(0),
        buildCatalogDisableKey("https://fixture.invalid", "movie", "catalog-1", "Row 1")
      ]
    }
  });
  ui.sortAndFilterRows = createHomeScreenMethods22().sortAndFilterRows;
  const loading = ui.loadData();
  await settle();
  assert.deepEqual(
    requests.map((request) => request.args.catalogId),
    ["catalog-8", "catalog-5"]
  );
  resolve(requests[0]);
  await settle();
  assert.equal(
    requests.length,
    2,
    "The other initial request can stay pending without speculative work"
  );
  assert.deepEqual(
    ui.rows.map((row) => row.homeCatalogKey),
    [collectionKey, key(8)]
  );
  assert.ok(
    commits.some((rows) => rows.some((row) => row.catalogId === "catalog-8")),
    "Preferred row publishes progressively before the initial batch completes"
  );

  // Resolve each bounded deferred batch without advancing any network timeout.
  let resolved = 1;
  for (let batch = 0; batch < 5; batch++) {
    const pending = requests.slice(resolved);
    resolved = requests.length;
    pending.forEach(resolve);
    await settle();
    // This fork spaces deferred VIDAA batches by 120 ms (bounded loading).
    await advance(150);
  }
  await loading;
  assert.deepEqual(
    requests.map((request) => request.args.catalogId),
    [
      "catalog-8",
      "catalog-5",
      "catalog-2",
      "catalog-3",
      "catalog-4",
      "catalog-6",
      "catalog-7",
      "catalog-9"
    ]
  );
  assert.deepEqual(
    ui.rows.map((row) => row.homeCatalogKey),
    [collectionKey, key(8), key(5), key(2), key(3), key(4), key(6), key(7), key(9)],
    "Final Home order and pinned collections remain intact"
  );
});

test("Last initial response uses the guarded render queue while VIDAA navigation is active", async () => {
  const savedRaf = globalThis.requestAnimationFrame;
  const savedCancelRaf = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let frameId = 0;
  const paint = async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
    await settle();
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const { ui, requests, commits } = fixture({ count: 2, constrained: true });
    ui.container = {};
    ui.requestRender = createHomeScreenMethods04().requestRender;
    ui.requestBackgroundRender = () => ui.requestRender();
    let navigationBusy = false;
    ui.shouldDeferHomeRenderForInput = () => navigationBusy;
    const loading = ui.loadData();
    await settle();
    resolve(requests[0]);
    await settle();
    await paint();
    assert.equal(commits.length, 1, "The first completed row can paint progressively");

    ui.hasUserInteractedSinceHomePaint = true;
    navigationBusy = true;
    resolve(requests[1]);
    await loading;
    await settle();
    assert.equal(
      commits.length,
      1,
      "Completing the initial batch cannot render synchronously over user navigation"
    );
    assert.equal(frames.size, 1, "Progressive and final render requests share one frame");
    await paint();
    assert.equal(commits.length, 1, "The queued frame must respect the navigation guard");
    navigationBusy = false;
    await advance(100);
    await paint();
    assert.equal(commits.length, 2, "The pending Home update paints after navigation settles");
    assert.equal(commits.at(-1).length, 2);
  } finally {
    globalThis.requestAnimationFrame = savedRaf;
    globalThis.cancelAnimationFrame = savedCancelRaf;
  }
});

test("Retired deferred responses cannot publish rows after a load token change", async () => {
  const { ui, requests, commits } = fixture({ count: 5, batchSize: 3 });
  const loading = ui.loadData();
  await settle();
  requests.slice(0, 2).forEach(resolve);
  await loading;
  await settle();
  const rows = ui.rows.slice();
  const previousCommits = commits.length;
  ui.homeLoadToken++;
  requests.slice(2).forEach(resolve);
  await settle();
  assert.deepEqual(ui.rows, rows);
  assert.equal(commits.length, previousCommits);
});

test("Prefetch timeout/error keeps placeholders and the existing retry recovery", async () => {
  for (const kind of ["timeout", "error"]) {
    const { ui, requests } = fixture({ count: 0 });
    const descriptor = {
      addonId: "fixture",
      addonBaseUrl: "https://fixture.invalid",
      catalogId: kind,
      catalogName: kind,
      type: "movie"
    };
    const pending = deferred();
    const fetching = ui.fetchCatalogRows([descriptor], {
      allowLoading: true,
      timeoutMs: 25,
      prefetchedResults: new Map([[descriptor, pending.promise]])
    });
    if (kind === "error") pending.resolve({ status: "error", message: "fixture failure" });
    else await advance(25);
    const rows = await fetching;
    assert.equal(requests.length, 0, "The pending prefetch is the only first attempt");
    assert.equal(rows[0].result.status, "loading");
    assert.equal(rows[0].loadingItems.length, 3);
    ui.rows = rows;
    ui.retryPendingCatalogRows = createHomeScreenMethods22().retryPendingCatalogRows;
    ui.retryPendingCatalogRows();
    assert.equal(requests.length, 1);
    resolve(requests[0]);
    await settle();
    assert.equal(ui.rows[0].result.status, "success");
    assert.equal(ui.catalogRetryInFlight, false);
    pending.resolve(success("late-prefetch"));
    await settle();
    assert.equal(
      ui.rows[0].result.data.items[0].id,
      kind,
      "Late timed-out prefetch cannot overwrite the successful retry"
    );
  }
});

let failures = 0;
try {
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.stack}`);
    }
  }
} finally {
  catalogRepository.getCatalog = originalCatalog;
  addonRepository.getInstalledAddons = originalAddons;
  for (const [object, key, original] of originals.reverse()) object[key] = original;
  timers.clear();
}
console.log(`Home upstream prefetch: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
