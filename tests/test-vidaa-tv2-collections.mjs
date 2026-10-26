import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C2): collections and personal rows in the current Home's order.
// Pinned collections first, then catalogs and collections in store order, personal rows last.
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

const {
  Router,
  addonRepository,
  catalogRepository,
  watchProgressRepository,
  LayoutPreferences,
  CollectionsStore,
  HomeCatalogStore,
  buildCatalogOrderKey,
  buildCollectionHomeKey
} = await import("../js/ui/screens/home/homeScreenContext.js");
const { createHomeScreenMethods22 } =
  await import("../js/ui/screens/home/homeScreenMethods-22-pick-initial-hero.js");
const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");
const { loadHomeRows } = await import("../js/ui/tv2/homeModel.js");
const { NewHomeScreen } = await import("../js/ui/tv2/newHomeScreen.js");

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
      { id: "c0", name: "c0", apiType: "movie" },
      { id: "c1", name: "c1", apiType: "movie" }
    ]
  }
];
const folder = (id, extra = {}) => ({
  id,
  title: `Folder ${id}`,
  coverImageUrl: `https://img.invalid/${id}.jpg`,
  ...extra
});
const collections = [
  {
    id: "pinned",
    title: "Pinned",
    pinToTop: true,
    folders: [folder("p1", { tileShape: "LANDSCAPE" })]
  },
  { id: "mid", title: "Middle", folders: [folder("m1"), folder("m2")] },
  { id: "empty", title: "Empty", folders: [] }
];
const key = (id) => buildCatalogOrderKey("alpha", "movie", id);
const title = (id) => ({ type: "movie", id, name: id });
let personal = { forYou: [title("tt1")], because: [], becauseTitle: null };
let refreshDone;
let refreshCalls = 0;

replace(Router, "getCurrent", () => "home");
replace(LayoutPreferences, "get", () => ({ homeLayout: "modern", continueWatchingEnabled: false }));
replace(CollectionsStore, "get", () => collections);
replace(addonRepository, "getInstalledAddons", async () => addons);
replace(catalogRepository, "getCatalog", async (args) => ({
  status: "success",
  data: { items: [title(`${args.catalogId}-a`)] }
}));
replace(watchProgressRepository, "getAllForContinueWatching", async () => []);
replace(Recommendations, "snapshot", () => personal);
replace(Recommendations, "refresh", () => {
  refreshCalls += 1;
  return new Promise((resolve) => (refreshDone = resolve));
});

try {
  HomeCatalogStore.set(
    {
      order: [key("c1"), buildCollectionHomeKey(collections[1]), key("c0")],
      disabled: [],
      customTitles: {}
    },
    { silentSync: true }
  );
  const emits = [];
  await loadHomeRows({ onRows: (rows) => emits.push(rows) });
  const rows = emits.at(-1);
  // continueWatchingEnabled: false, so no Continue Watching row (lot C3).
  const expected = ["collection_pinned", key("c1"), "collection_mid", key("c0"), "perso:for-you"];
  assert.deepEqual(
    rows.map((row) => row.key),
    expected,
    "pinned first, store order, personal last"
  );
  assert.ok(
    emits.every((emitted) => emitted.at(-1).key === "perso:for-you"),
    "personal rows stay last in every emit"
  );

  // Same order as the current Home's sortAndFilterRows (the empty collection is dropped).
  const fetched = rows.filter((row) => row.kind === "poster" && row.entry).map((row) => row.entry);
  const old = createHomeScreenMethods22().sortAndFilterRows(fetched, collections);
  assert.deepEqual(
    old.map((row) => row.homeCatalogKey),
    expected.slice(0, -1)
  );

  const pinned = rows[0];
  assert.equal(pinned.kind, "collection");
  assert.equal(pinned.title, "Pinned");
  assert.equal(pinned.status, "success");
  assert.equal(pinned.tileShape, "LANDSCAPE");
  assert.equal(pinned.items[0].id, "collection:pinned:p1");
  assert.equal(pinned.items[0].tileShape, "LANDSCAPE");
  assert.deepEqual(
    rows[2].items.map((item) => item.folderId),
    ["m1", "m2"]
  );
  assert.equal(rows[2].tileShape, "SQUARE");

  // Recommendations refresh once after the load; a changed result is re-emitted, last.
  assert.ok(refreshDone, "Recommendations.refresh called");
  const count = emits.length;
  personal = { forYou: [title("tt1")], because: [title("tt2")], becauseTitle: "Dune" };
  refreshDone();
  await flush();
  assert.equal(emits.length, count + 1, "new personal rows re-emitted");
  assert.deepEqual(
    emits
      .at(-1)
      .slice(-2)
      .map((row) => row.key),
    ["perso:for-you", "perso:because"]
  );

  // A Home left during the load (cleanup, profile change) starts no recommendation refresh.
  let current = true;
  replace(catalogRepository, "getCatalog", async (args) => {
    current = false;
    return { status: "success", data: { items: [title(`${args.catalogId}-a`)] } };
  });
  const callsBefore = refreshCalls;
  await loadHomeRows({ isCurrent: () => current, onRows: () => {} });
  assert.equal(refreshCalls, callsBefore, "no refresh after the Home was left");

  // OK on a collection folder opens the folder on key-down, not Detail and with no hold.
  const navigations = [];
  replace(Router, "navigate", (route, params) => navigations.push([route, params]));
  const screen = Object.create(NewHomeScreen);
  screen.rows = emits.at(-1);
  screen.focus = { row: screen.rows.findIndex((row) => row.key === pinned.key), columns: {} };
  screen.onKeyDown({ keyCode: 13 });
  assert.deepEqual(navigations, [
    ["folderDetail", { collectionId: "pinned", folderId: "p1", collectionTitle: "Pinned" }]
  ]);
} finally {
  for (const [object, name, value] of originals.reverse()) object[name] = value;
}

console.log("PASS: new TV Home collections and personal rows follow the current Home's order");
