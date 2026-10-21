import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.HTMLElement = class {};
globalThis.HTMLImageElement = class extends HTMLElement {};
const { createHomeScreenMethods24 } =
  await import("../js/ui/screens/home/homeScreenMethods-24-schedule-home-lazy-image-hydration.js");
const {
  cancelVidaaHomePosterPrefetches,
  observeVidaaPosterReady,
  cancelVidaaPosterObservation,
  prefetchVidaaPosterSource,
  reconcileVidaaHomePosterPrefetches
} = await import("../js/ui/screens/home/vidaaHomePosterPrefetch.js");
const { releaseVidaaHomeImage } = await import("../js/ui/screens/home/vidaaHomeImageWindow.js");
const { getVidaaPosterSchedulerStats } =
  await import("../js/ui/components/vidaaPosterScheduler.js");
let now = 0,
  id = 0,
  decoded = 0,
  starts = 0;
Date.now = () => now;
const timers = new Map();
const frames = new Map();
globalThis.setTimeout = (callback, delay) => {
  const key = ++id;
  timers.set(key, { callback, at: now + delay });
  return key;
};
globalThis.clearTimeout = (key) => timers.delete(key);
globalThis.requestAnimationFrame = (callback) => {
  const key = ++id;
  frames.set(key, callback);
  return key;
};
globalThis.cancelAnimationFrame = (key) => frames.delete(key);
const images = [];
globalThis.Image = class {
  constructor() {
    this._src = "";
    images.push(this);
  }
  set src(value) {
    this._src = value;
    if (value) starts++;
  }
  get src() {
    return this._src;
  }
  decode() {
    decoded++;
    return new Promise(() => {});
  }
  removeAttribute() {
    this._src = "";
  }
};
function frame() {
  const before = starts;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback());
  assert.ok(starts - before <= 2, "All native prefetch assignments share two starts/frame");
  assert.ok(getVidaaPosterSchedulerStats().active <= 4);
}
// A short reversal retains nearby HTTP progress while capacity is available.
{
  const near = {};
  reconcileVidaaHomePosterPrefetches(near, ["near-a"]);
  prefetchVidaaPosterSource(near, "near-a");
  frame();
  const first = near.homeVidaaPosterPrefetchInflight.get("near-a");
  now += 80;
  reconcileVidaaHomePosterPrefetches(near, ["near-b"]);
  prefetchVidaaPosterSource(near, "near-b");
  frame();
  assert.equal(first.image.src, "near-a");
  first.image.onload();
  assert.ok(near.homeVidaaPosterWarmUrls.has("near-a"));
  cancelVidaaHomePosterPrefetches(near);
}
const rows = Array.from({ length: 40 }, (_, r) =>
  Array.from({ length: 50 }, (_, c) => ({
    dataset: { navRow: String(r), navCol: String(c), posterSrc: `poster-${r}-${c}` },
    querySelector: () => null
  }))
);
const owner = {
  ...createHomeScreenMethods24(),
  container: { isConnected: true },
  navModel: { rows },
  getCurrentFocusedNode: () => rows[0][0]
};
function move(r, c, direction) {
  now += 80;
  owner.scheduleHomeLazyImageHydration(rows[r][c], { navigationDirection: direction });
}
move(0, 10, "down");
assert.equal(starts, 2, "Runway planning does not synchronously start requests");
frame();
frame();
assert.equal(getVidaaPosterSchedulerStats().active, 4);
assert.ok(
  owner.homeVidaaPosterPrefetchInflight.size <= 24,
  "Entered neighborhood and predicted runway are queued together"
);
const retired = [...owner.homeVidaaPosterPrefetchInflight.values()].find(
  (record) => record.image.onload
);
const lateLoad = retired.image.onload;
cancelVidaaHomePosterPrefetches(owner);
lateLoad();
assert.equal(
  owner.homeVidaaPosterWarmUrls.size,
  0,
  "Late events cannot revive a cancelled request"
);

// Thousands of rapid reversals prune queued work to the latest runway. Native
// requests, timers and warm cache remain bounded independently of visited cards.
for (let step = 0; step < 2000; step++) {
  move(5 + (step % 28), 8 + (step % 30), ["up", "right", "down", "left"][step % 4]);
  frame();
  frame();
  assert.ok(
    owner.homeVidaaPosterPrefetchInflight.size <= 28,
    "Only latest runway plus four retained requests remain"
  );
  assert.ok(timers.size <= 5, "Four active request deadlines plus one settle timer");
  if (step % 5 === 0)
    [...owner.homeVidaaPosterPrefetchInflight.values()].forEach((record) =>
      record.image.onload?.()
    );
  assert.ok(owner.homeVidaaPosterWarmUrls.size <= 96);
}
assert.equal(decoded, 0, "Invisible warming never forces decode");
assert.ok(images.filter((image) => image.src).length <= 4);
const pending = [...owner.homeVidaaPosterPrefetchInflight.values()].filter(
  (record) => record.image.src
);
now += 5000;
for (const [key, timer] of [...timers]) {
  if (timer.at <= now && key !== owner.homeLazyImageHydrationSettleTimer) {
    timers.delete(key);
    timer.callback();
  }
}
pending.forEach((record) =>
  assert.equal(record.image.src, "", "Deadline releases actual native sources")
);
cancelVidaaHomePosterPrefetches(owner);
clearTimeout(owner.homeLazyImageHydrationSettleTimer);
assert.equal(owner.homeVidaaPosterPrefetchInflight.size, 0);
assert.equal(getVidaaPosterSchedulerStats().active, 0);
assert.equal(getVidaaPosterSchedulerStats().queued, 0);
assert.equal(frames.size, 0);
assert.equal(timers.size, 0);
// Failed/cancelled live images cannot accumulate one-shot load listeners.
const listeners = new Map();
const live = {
  dataset: {},
  classList: { contains: () => false, add() {}, remove() {} },
  src: "visible-poster",
  addEventListener(type, callback) {
    const set = listeners.get(type) || new Set();
    set.add(callback);
    listeners.set(type, set);
  },
  removeEventListener(type, callback) {
    listeners.get(type)?.delete(callback);
  },
  getAttribute: () => live.src,
  removeAttribute() {
    live.src = "";
  }
};
for (let step = 0; step < 100; step++) {
  observeVidaaPosterReady(owner, live);
  assert.equal(listeners.get("load").size, 1);
  assert.equal(listeners.get("error").size, 1);
}
[...listeners.get("error")][0]();
await Promise.resolve(); // The observer lets inline fallback handlers run first.
assert.equal(listeners.get("load").size, 0);
live.src = live.dataset.src; // Hydration retries the retired source before observation.
delete live.dataset.src;
observeVidaaPosterReady(owner, live);
releaseVidaaHomeImage(live);
assert.equal(live.dataset.src, "visible-poster");
assert.equal(listeners.get("load").size, 0);
cancelVidaaPosterObservation(live);
console.log(
  "VIDAA poster stress passed: 2000 reversals, bounded requests/cache/listeners, timeout and cleanup recovery, no forced decode."
);
