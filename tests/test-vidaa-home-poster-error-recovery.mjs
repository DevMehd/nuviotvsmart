import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.document = { documentElement: { classList: { contains: () => false } } };
const timers = new Map();
const frames = new Map();
let timerId = 0;
globalThis.setTimeout = (callback) => {
  const id = ++timerId;
  timers.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.cancelAnimationFrame = () => {};
globalThis.requestAnimationFrame = (callback) => {
  const id = ++timerId;
  frames.set(id, callback);
  return id;
};
class Poster extends EventTarget {
  constructor(source, fallbacks = []) {
    super();
    this.dataset = { src: source, fallbackSrcs: fallbacks.map(encodeURIComponent).join("|") };
    this.isConnected = true;
    this.attributes = new Map();
    this.requests = [];
    const values = new Set(["content-poster"]);
    this.classList = {
      add: (name) => values.add(name),
      remove: (name) => values.delete(name),
      contains: (name) => values.has(name)
    };
  }
  get src() {
    return this.getAttribute("src") || "";
  }
  set src(value) {
    this.attributes.set("src", value);
    this.requests.push(value);
    this.complete = false;
    this.naturalWidth = 0;
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    if (name === "data-src") delete this.dataset.src;
    else this.attributes.delete(name);
  }
  error() {
    this.complete = true;
    this.naturalWidth = 0;
    this.onerror?.();
    this.dispatchEvent(new Event("error"));
  }
  loaded() {
    this.complete = true;
    this.naturalWidth = 180;
    this.dispatchEvent(new Event("load"));
  }
}
globalThis.HTMLImageElement = Poster;
const { observeVidaaPosterReady, cancelVidaaPosterObservation } =
  await import("../js/ui/screens/home/vidaaHomePosterPrefetch.js");
const { createHomeScreenMethods24 } =
  await import("../js/ui/screens/home/homeScreenMethods-24-schedule-home-lazy-image-hydration.js");
const { buildImageFallbackErrorHandler } =
  await import("../js/ui/screens/home/homeImageHelpers.js");
const fallbackHandler = new Function(buildImageFallbackErrorHandler());
async function flush() {
  for (let pass = 0; pass < 5; pass++) await Promise.resolve();
}
function fixture(fallbacks = []) {
  const image = new Poster("https://fixture.invalid/poster.jpg", fallbacks);
  const node = {
    isConnected: true,
    classList: { contains: () => false },
    querySelector: (selector) =>
      selector.includes("[data-src]") && image.dataset.src ? image : null
  };
  const screen = {
    ...createHomeScreenMethods24(),
    container: { isConnected: true },
    getCurrentFocusedNode: () => node,
    isVidaaHomeLoadingBusy: () => false
  };
  const hydrate = () => screen.scheduleVidaaHomeLazyImageHydration(node);
  return { image, screen, hydrate };
}

for (const posterClass of ["content-poster", "home-continue-bg"]) {
  const { image, screen, hydrate } = fixture();
  image.classList.remove("content-poster");
  image.classList.add(posterClass);
  screen.commitHomeLazyImageSources([{ image, src: image.dataset.src, priority: 1 }]);
  for (const [id, callback] of frames) {
    frames.delete(id);
    callback();
  }
  assert.equal(image.dataset.src, undefined);
  image.error();
  await flush();
  assert.equal(
    image.dataset.src,
    "https://fixture.invalid/poster.jpg",
    "A visible poster loaded by the viewport batch must recover like a focused poster"
  );
  hydrate();
  image.loaded();
  assert.equal(image.requests.length, 2);
  assert.equal(image.classList.contains("placeholder"), false);
  console.log(
    `PASS visible/appended ${posterClass} viewport images recover when subsequently focused`
  );
}

{
  const { image, hydrate } = fixture();
  hydrate();
  assert.equal(image.dataset.src, undefined);
  image.error();
  await flush();
  assert.equal(
    image.getAttribute("src"),
    null,
    "A failed native image must not be mistaken for a loaded poster"
  );
  assert.equal(image.dataset.src, "https://fixture.invalid/poster.jpg");
  assert.equal(image.requests.length, 1, "Error handling itself must not issue requests");
  hydrate();
  image.loaded();
  assert.equal(image.requests.length, 2);
  assert.equal(image.classList.contains("placeholder"), false);
  assert.equal(image.dataset.src, undefined);
  console.log(
    "PASS returning to a transiently failed poster hydrates it again and clears its placeholder"
  );
}
{
  const { image, hydrate } = fixture();
  hydrate();
  image.error();
  await flush();
  hydrate();
  image.error();
  await flush();
  for (let repeat = 0; repeat < 50; repeat++) hydrate();
  assert.equal(
    image.requests.length,
    2,
    "One failed retry must not create a loop during repeated navigation/hydration"
  );
  assert.equal(image.dataset.src, undefined);
  console.log("PASS a permanently broken poster receives at most one additional hydration request");
}
{
  const alternative = "https://fixture.invalid/fallback.jpg";
  const { image, hydrate } = fixture([alternative]);
  image.onerror = fallbackHandler;
  hydrate();
  image.error();
  await flush();
  assert.equal(image.src, alternative);
  assert.equal(
    image.dataset.src,
    undefined,
    "Normal fallback loading must not be reset to the failed primary"
  );
  image.loaded();
  assert.equal(image.classList.contains("placeholder"), false);
  assert.deepEqual(image.requests, ["https://fixture.invalid/poster.jpg", alternative]);
  console.log(
    "PASS the existing inline artwork fallback completes normally without a duplicate primary request"
  );
}
{
  const alternative = "https://fixture.invalid/fallback.jpg";
  const { image, hydrate } = fixture([alternative]);
  image.onerror = fallbackHandler;
  hydrate();
  image.error();
  await flush();
  image.error();
  await flush();
  assert.equal(image.src, "");
  assert.equal(image.dataset.src, "https://fixture.invalid/poster.jpg");
  assert.equal(image.dataset.fallbackSrcs, encodeURIComponent(alternative));
  hydrate();
  image.error();
  await flush();
  image.loaded();
  assert.equal(image.src, alternative);
  assert.equal(image.classList.contains("placeholder"), false);
  assert.equal(image.dataset.src, undefined);
  console.log(
    "PASS an exhausted fallback chain can recover once while preserving its original alternatives"
  );
}
{
  const { image, hydrate } = fixture();
  hydrate();
  image.error();
  image.dataset.src = "https://fixture.invalid/new-metadata-poster.jpg";
  await flush();
  assert.equal(image.dataset.src, "https://fixture.invalid/new-metadata-poster.jpg");
  hydrate();
  image.loaded();
  assert.equal(image.src, "https://fixture.invalid/new-metadata-poster.jpg");
  console.log("PASS an old image error cannot replace an updated metadata artwork source");
}
{
  const { image, screen, hydrate } = fixture();
  hydrate();
  image.error();
  cancelVidaaPosterObservation(image);
  await flush();
  assert.equal(
    image.dataset.src,
    undefined,
    "Released observations must not resurrect pending image hydration"
  );
  observeVidaaPosterReady(screen, image);
  image.isConnected = false;
  image.error();
  await flush();
  assert.equal(image.dataset.src, undefined);
  console.log("PASS cancellation and detached cards discard queued recovery without requests");
}
timers.clear();
