import assert from "node:assert/strict";

// Catalog page merge and See All payload shared by the current Home and the new Home (nuv-091, C6).
const { mergeCatalogPage, catalogPageSkip, buildCatalogSeeAllPayload } =
  await import("../js/ui/screens/home/homeCatalogPage.js");

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };
const noId = { name: "no id" };

// Next skip: the stored nextSkip when it is past the loaded items, else the item count.
assert.equal(catalogPageSkip({ items: [a, b], nextSkip: 200 }), 200);
assert.equal(catalogPageSkip({ items: [a, b], nextSkip: 150.7 }), 150);
assert.equal(catalogPageSkip({ items: [a, b], nextSkip: 1 }), 2);
assert.equal(catalogPageSkip({ items: [a, b] }), 2);
assert.equal(catalogPageSkip({}), 0);

const table = [
  {
    name: "dedupe by id, items without id are kept, nextSkip = skip + page size",
    payload: { items: [a, b], currentPage: 1 },
    result: { data: { items: [b, c, noId] } },
    skip: 2,
    patch: {
      items: [a, b, c, noId],
      supportsSkip: true,
      hasMore: true,
      currentPage: 1,
      nextSkip: 5
    },
    newItems: [c, noId]
  },
  {
    name: "empty page stops pagination and changes nothing else",
    payload: { items: [a], hasMore: true, nextSkip: 1 },
    result: { data: { items: [] } },
    skip: 1,
    patch: { hasMore: false },
    newItems: []
  },
  {
    name: "a reported nextSkip past skip wins and the reported hasMore is kept",
    payload: { items: [a] },
    result: { data: { items: [b], nextSkip: 120.9, hasMore: false, currentPage: 3 } },
    skip: 100,
    patch: { items: [a, b], supportsSkip: true, hasMore: false, currentPage: 3, nextSkip: 120 },
    newItems: [b]
  },
  {
    name: "a reported nextSkip at or before skip is ignored",
    payload: { items: [a] },
    result: { data: { items: [b], nextSkip: 1 } },
    skip: 1,
    patch: {
      items: [a, b],
      supportsSkip: true,
      hasMore: true,
      currentPage: undefined,
      nextSkip: 2
    },
    newItems: [b]
  },
  {
    name: "a page without skip support ends pagination",
    payload: { items: [a] },
    result: { data: { items: [b], supportsSkip: false, hasMore: true } },
    skip: 1,
    patch: {
      items: [a, b],
      supportsSkip: false,
      hasMore: false,
      currentPage: undefined,
      nextSkip: 2
    },
    newItems: [b]
  },
  {
    name: "a page of duplicates adds nothing but keeps hasMore from the addon",
    payload: { items: [a, b] },
    result: { data: { items: [a, b], hasMore: true } },
    skip: 2,
    patch: {
      items: [a, b],
      supportsSkip: true,
      hasMore: true,
      currentPage: undefined,
      nextSkip: 4
    },
    newItems: []
  }
];
for (const entry of table) {
  const before = JSON.stringify(entry.payload);
  const merged = mergeCatalogPage(entry.payload, entry.result, entry.skip);
  assert.deepEqual(merged.patch, entry.patch, entry.name);
  assert.deepEqual(merged.newItems, entry.newItems, entry.name);
  assert.equal(JSON.stringify(entry.payload), before, `${entry.name}: payload not mutated`);
}
// The current Home passes the items of its live row when the payload has none.
assert.deepEqual(
  mergeCatalogPage({}, { data: { items: [b] } }, 1, [a]).patch.items,
  [a, b],
  "fallback items"
);

// See All payload: same shape as the current Home's catalogSeeAllMap entries.
const items = [a, b];
assert.deepEqual(
  buildCatalogSeeAllPayload({
    addonBaseUrl: "https://addon.example",
    addonId: "addon",
    addonName: "Addon",
    catalogId: "top",
    catalogName: "Top",
    type: "series",
    skipStep: 50,
    result: { data: { items, nextSkip: 40, hasMore: 1 } }
  }),
  {
    addonBaseUrl: "https://addon.example",
    addonId: "addon",
    addonName: "Addon",
    catalogId: "top",
    catalogName: "Top",
    type: "series",
    initialItems: items,
    initialNextSkip: 40,
    initialHasMore: true,
    supportsSkip: true,
    skipStep: 50
  }
);
assert.deepEqual(
  buildCatalogSeeAllPayload({ supportsSkip: false, result: { data: { skipStep: 20 } } }),
  {
    addonBaseUrl: "",
    addonId: "",
    addonName: "",
    catalogId: "",
    catalogName: "",
    type: "movie",
    initialItems: [],
    initialNextSkip: 0,
    initialHasMore: false,
    supportsSkip: false,
    skipStep: 20
  }
);
assert.equal(
  buildCatalogSeeAllPayload({ result: { data: { supportsSkip: false } } }).supportsSkip,
  false
);
assert.equal(buildCatalogSeeAllPayload({}).skipStep, 100);

console.log("PASS: catalog page merge and See All payload");
