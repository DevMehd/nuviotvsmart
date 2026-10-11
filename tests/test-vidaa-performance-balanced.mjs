import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const { Platform } = await import("../js/platform/index.js");
const { createHomeScreenMethods22 } =
  await import("../js/ui/screens/home/homeScreenMethods-22-pick-initial-hero.js");
const { catalogRepository, Router } = await import("../js/ui/screens/home/homeScreenContext.js");
const { normalizeTmdbCardBackdropUrl, normalizeTmdbBackdropUrl } =
  await import("../js/core/tmdb/tmdbImageUrl.js");
const { getVidaaArtworkUrl, getVidaaArtworkOriginal, VIDAA_ARTWORK_FALLBACK_HANDLER } =
  await import("../js/ui/screens/home/vidaaArtworkOptimization.js");
const { buildLazyImageAttributes } =
  await import("../js/ui/screens/home/homeScreenHelpers-14-get-home-grid-column-count.js");
const { buildHeroBackdropSources } = await import("../js/ui/screens/home/homeImageHelpers.js");
const { createPosterCardMarkup } =
  await import("../js/ui/screens/home/homeScreenHelpers-15-create-poster-card-markup.js");

const tmdb = "https://image.tmdb.org/t/p/w1280/example.jpg";
assert.equal(normalizeTmdbCardBackdropUrl(tmdb), tmdb.replace("w1280", "w780"));
assert.equal(normalizeTmdbBackdropUrl(tmdb), tmdb);
assert.equal(
  normalizeTmdbCardBackdropUrl(tmdb.replace("w1280", "w300")),
  tmdb.replace("w1280", "w300")
);
const publicImage = "https://raw.githubusercontent.com/ImKaptain/nuvio-art/main/folder/art.jpg";
globalThis.__NUVIO_IMAGE_OPTIMIZATION__ = false;
assert.equal(
  getVidaaArtworkUrl(publicImage),
  publicImage,
  "Offline/local packages retain original artwork"
);
globalThis.__NUVIO_IMAGE_OPTIMIZATION__ = true;
const optimized = getVidaaArtworkUrl(publicImage);
assert.equal(new URL(optimized, "https://nuvio.test").searchParams.get("w"), "640");
assert.equal(getVidaaArtworkOriginal(optimized), publicImage);
for (const source of [
  publicImage + "?token=private",
  publicImage + "#private",
  publicImage.replace("ImKaptain", "another-owner"),
  publicImage.replace(".jpg", ".gif"),
  publicImage.replace("https:", "http:"),
  "https://addon.test/private-key/art.jpg"
]) {
  assert.equal(getVidaaArtworkUrl(source), source, "Private or unknown artwork must stay direct");
}
Platform.current = { name: "webos" };
assert.equal(getVidaaArtworkUrl(publicImage), publicImage);
Platform.current = { name: "vidaa" };
const sources = buildHeroBackdropSources({ background: optimized });
assert.equal(
  new URL(sources[0], "https://nuvio.test").searchParams.get("w"),
  "1280",
  "Hero retains larger artwork"
);
assert.equal(sources[1], publicImage);
const markup = createPosterCardMarkup(
  { id: "tt1", type: "movie", name: "Fixture", poster: publicImage, background: publicImage },
  0,
  0,
  "movie",
  null,
  true,
  "modern",
  false,
  true,
  true
);
assert.ok(markup.includes('data-poster-src="/_vercel/image?'));
assert.ok(markup.includes('data-original-src="' + publicImage + '"'));
assert.ok(buildLazyImageAttributes(publicImage, { defer: true }).includes('onerror="'));
assert.ok(
  !buildLazyImageAttributes(publicImage, { fallbackHandler: false }).includes('onerror="'),
  "Continue Watching owns its existing fallback handler"
);
const image = { dataset: { originalSrc: publicImage }, src: optimized };
vm.runInNewContext("(function(){" + VIDAA_ARTWORK_FALLBACK_HANDLER + "}).call(image)", { image });
assert.equal(image.src, publicImage);
assert.equal(image.dataset.originalSrc, undefined, "The fallback cannot retry indefinitely");

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
const descriptors = Array.from({ length: 6 }, (_, i) => ({
  addonId: "fixture",
  addonBaseUrl: "https://fixture.test",
  catalogId: "catalog-" + i,
  catalogName: "Fixture " + i,
  type: "movie"
}));
const screen = () => ({
  ...createHomeScreenMethods22(),
  layoutPrefs: {},
  getLoadingRowItemCount: () => 4
});
const success = { status: "success", data: { items: [] } };
let requests = [];
let active = true;
let published = [];
const pending = deferred();
catalogRepository.getCatalog = async (c) => {
  requests.push(c.catalogId);
  return pending.promise;
};
const cancelled = screen().fetchCatalogRows(descriptors, {
  batchSize: 2,
  allowLoading: true,
  shouldContinue: () => active,
  onRow: (r) => published.push(r)
});
await Promise.resolve();
await Promise.resolve();
assert.equal(requests.length, 2);
active = false;
pending.resolve(success);
assert.deepEqual(await cancelled, []);
assert.equal(requests.length, 2, "Leaving Home stops all not-yet-started batches");
assert.equal(published.length, 0, "Late results cannot publish into a different screen");

requests = [];
active = true;
let busy = true;
catalogRepository.getCatalog = async (c) => {
  requests.push(c.catalogId);
  return success;
};
const paused = screen().fetchCatalogRows(descriptors, {
  batchSize: 2,
  batchYieldMs: 5,
  shouldContinue: () => active,
  isBusy: () => busy
});
await new Promise((r) => setTimeout(r, 10));
assert.equal(requests.length, 0, "Secondary catalogs yield to active navigation");
busy = false;
assert.equal((await paused).length, 6, "All catalogs remain available after navigation settles");
assert.equal(requests.length, 6);

requests = [];
published = [];
active = true;
catalogRepository.getCatalog = async (c) => {
  requests.push(c.catalogId);
  return success;
};
const state = screen();
state.homeLoadToken = 7;
state.rows = descriptors.map((c) => ({ ...c, result: { status: "loading" } }));
state.getDeferredCatalogBatchSize = () => 2;
state.isVidaaHomeLoadingBusy = () => true;
Router.getCurrent = () => (active ? "home" : "player");
state.retryPendingCatalogRows();
await new Promise((r) => setTimeout(r, 10));
active = false;
await new Promise((r) => setTimeout(r, 90));
assert.equal(requests.length, 0, "Retries waiting on navigation cannot start during playback");
assert.equal(state.catalogRetryInFlight, false);

const sw = await fs.readFile(new URL("../sw.js", import.meta.url), "utf8");
const precache = sw.match(/var ASSETS = \[([\s\S]*?)\];/)[1];
for (const library of ["quickjs-emscripten", "plugin-worker", "hls.min", "dash.all", "ass.min"])
  assert.ok(!precache.includes(library), "Heavy libraries load only when needed");
console.log(
  "Balanced VIDAA performance passed: artwork scope/sizing/fallback, navigation priority, stale catalog cancellation, retry lifecycle and lazy precache."
);
