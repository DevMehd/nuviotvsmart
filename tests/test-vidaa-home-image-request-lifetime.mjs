import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";

let now = 0;
let nextTimerId = 0;
let decodeCalls = 0;
const timers = new Map();
const activeRequests = new Set();
const images = [];
Date.now = () => now;
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextTimerId;
  timers.set(id, { callback, at: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.Image = class {
  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    images.push(this);
  }
  set src(value) {
    this._src = value;
    if (value) activeRequests.add(this);
    else activeRequests.delete(this);
  }
  get src() {
    return this._src || "";
  }
  removeAttribute(name) {
    if (name === "src") this.src = "";
  }
  decode() {
    decodeCalls += 1;
    return this.decodeResult || Promise.resolve();
  }
};

const {
  preloadImageSource,
  heroImagePreloadCache,
  HERO_IMAGE_PRELOAD_CACHE_LIMIT,
  HERO_IMAGE_PRELOAD_TIMEOUT_MS
} = await import("../js/ui/screens/home/homeScreenHelpers-02-extract-release-date-text.js");

async function advance(delta) {
  now += delta;
  // The failed-cache cleanup is deliberately deferred to the next timer turn.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [id, timer] of [...timers]) {
      if (timer.at > now || !timers.has(id)) continue;
      timers.delete(id);
      timer.callback();
    }
    await Promise.resolve();
    await Promise.resolve();
  }
}

// A burst can evict a pending Promise before the Image deadline. Its native
// request must still be cancelled when the orphaned timeout expires.
const evicted = Array.from({ length: 64 }, (_, index) =>
  preloadImageSource(`evicted-artwork-${index}`)
);
assert.equal(heroImagePreloadCache.size, HERO_IMAGE_PRELOAD_CACHE_LIMIT);
assert.equal(heroImagePreloadCache.has("evicted-artwork-0"), false);
await advance(HERO_IMAGE_PRELOAD_TIMEOUT_MS);
assert.ok((await Promise.all(evicted)).every((loaded) => loaded === false));
assert.equal(activeRequests.size, 0, "Eviction must not strand an active native request");
assert.equal(timers.size, 0);

// Missing native load/error events must release the actual request, including
// requests whose Promise has already been evicted from the 32-entry cache.
const promises = [];
let retiredLoad;
const firstImageIndex = images.length;
for (let step = 0; step < 2000; step += 1) {
  await advance(80);
  promises.push(preloadImageSource(`stalled-artwork-${step}`));
  if (step === 0) retiredLoad = images[firstImageIndex].onload;
  assert.ok(heroImagePreloadCache.size <= HERO_IMAGE_PRELOAD_CACHE_LIMIT);
  assert.ok(
    activeRequests.size <= Math.ceil(HERO_IMAGE_PRELOAD_TIMEOUT_MS / 80),
    "Timed-out preloads must release native Image sources during long navigation"
  );
}
await advance(HERO_IMAGE_PRELOAD_TIMEOUT_MS);
assert.ok((await Promise.all(promises)).every((loaded) => loaded === false));
assert.equal(activeRequests.size, 0, "No stalled request survives its deadline");
assert.equal(heroImagePreloadCache.size, 0);
assert.equal(timers.size, 0);
images.forEach((image) => {
  assert.equal(image.src, "");
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
});
if (retiredLoad) {
  images[firstImageIndex].naturalWidth = 100;
  retiredLoad();
  assert.equal(decodeCalls, 0, "An obsolete load cannot restart decode work");
}

// A native decode that never settles shares the same lifetime bound.
const stuckDecode = preloadImageSource("stuck-decode");
const decodingImage = images.at(-1);
decodingImage.naturalWidth = 100;
decodingImage.decodeResult = new Promise(() => {});
decodingImage.onload();
await advance(HERO_IMAGE_PRELOAD_TIMEOUT_MS);
assert.equal(await stuckDecode, false);
assert.equal(decodingImage.src, "");
assert.equal(decodingImage.onload, null);

// Successful assets remain cached as booleans without retaining a decoder
// image, and failed URLs can be requested again after the cleanup turn.
const loaded = preloadImageSource("loaded-artwork");
const loadedImage = images.at(-1);
loadedImage.naturalWidth = 100;
loadedImage.onload();
assert.equal(await loaded, true);
assert.equal(loadedImage.src, "");
assert.equal(loadedImage.onload, null);
assert.equal(preloadImageSource("loaded-artwork"), loaded);
const failed = preloadImageSource("retry-artwork");
const failedImage = images.at(-1);
failedImage.onerror();
assert.equal(await failed, false);
assert.equal(failedImage.src, "");
await advance(0);
const retry = preloadImageSource("retry-artwork");
assert.notEqual(retry, failed);
images.at(-1).onerror();
assert.equal(await retry, false);
await advance(0);
heroImagePreloadCache.clear();
assert.equal(activeRequests.size, 0);
assert.equal(timers.size, 0);

console.log(
  "VIDAA image lifetime checks passed: 2000 stalled preloads, cache eviction, decode deadline, retry and successful cleanup."
);
