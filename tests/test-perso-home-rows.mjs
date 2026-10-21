import assert from "node:assert/strict";

// "Pour toi" / "Parce que tu as aimé" home rows use the catalog row format (nuv-090).
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");
const { personalHomeRows } = await import("../js/ui/screens/perso/personalUi.js");

const title = (id) => ({ type: "movie", id, name: `Film ${id}`, poster: `https://example.org/${id}.jpg` });
Recommendations.snapshot = () => ({ forYou: [title("tt1"), title("tt2")], because: [title("tt3")], becauseTitle: "Dune" });

const catalog = { id: "c1", catalogId: "top", result: { status: "success", data: { items: [title("tt9")] } } };
const stale = { id: "perso:for-you", catalogId: "perso:for-you", items: [] };
const rows = personalHomeRows([catalog, stale]);

assert.equal(rows.length, 3, "old personal rows are replaced, catalogs kept");
const forYou = rows.find((row) => row.catalogId === "perso:for-you");
const because = rows.find((row) => row.catalogId === "perso:because");
assert.equal(forYou.result.status, "success");
assert.deepEqual(forYou.result.data.items.map((item) => item.id), ["tt1", "tt2"]);
assert.equal(forYou.homeCatalogKey, "perso:for-you");
assert.equal(because.title, "Parce que tu as aimé Dune");
assert.deepEqual(because.result.data.items.map((item) => item.id), ["tt3"]);

Recommendations.snapshot = () => ({ forYou: [], because: [], becauseTitle: null });
assert.equal(personalHomeRows([catalog]).length, 1, "no empty personal rows");

console.log("perso home rows tests passed");
