import assert from "node:assert/strict";
import {
  scheduleVidaaPosterImage,
  cancelVidaaPosterImage,
  cancelVidaaPosterJobs,
  getVidaaPosterSchedulerStats
} from "../js/ui/components/vidaaPosterScheduler.js";

let time = 1000;
let id = 0;
let starts = 0;
const frames = new Map();
const timers = new Map();
Date.now = () => time;
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (key) => frames.delete(key);
globalThis.setTimeout = (callback, delay) => {
  timers.set(++id, { callback, at: time + delay });
  return id;
};
globalThis.clearTimeout = (key) => timers.delete(key);
function frame() {
  time += 16;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback());
}
async function flush() {
  for (let n = 0; n < 6; n++) await Promise.resolve();
}
class Poster extends EventTarget {
  constructor(source) {
    super();
    this.dataset = { src: source };
    this.attrs = new Map();
    this.isConnected = true;
    this.complete = false;
    this.naturalWidth = 0;
    this.decoded = Promise.resolve();
  }
  getAttribute(name) {
    return this.attrs.get(name) || null;
  }
  removeAttribute(name) {
    if (name === "data-src") delete this.dataset.src;
    else this.attrs.delete(name);
  }
  set src(value) {
    this.attrs.set("src", value);
    this.complete = false;
    starts++;
  }
  get src() {
    return this.attrs.get("src") || "";
  }
  decode() {
    return this.decoded;
  }
  load() {
    this.complete = true;
    this.naturalWidth = 248;
    this.dispatchEvent(new Event("load"));
  }
  error() {
    this.complete = true;
    this.naturalWidth = 0;
    this.onerror?.();
    this.dispatchEvent(new Event("error"));
  }
}
const owner = { container: { isConnected: true } };
const otherScreen = { container: { isConnected: true } };
const images = Array.from({ length: 20 }, (_, n) => new Poster(`fixture-poster-${n}`));
images.forEach((image, n) =>
  scheduleVidaaPosterImage(n % 2 ? owner : otherScreen, image, { priority: 2 })
);
scheduleVidaaPosterImage(owner, images[19], { priority: 0 });
frame();
assert.equal(starts, 2, "Only two native requests start in a frame across both screens");
assert.ok(images[19].src, "A newly focused poster moves ahead of speculative artwork");
assert.equal(images[19].fetchPriority, "high", "Promotion updates the native request priority too");
frame();
assert.equal(starts, 4);
assert.equal(getVidaaPosterSchedulerStats().active, 4);
assert.equal(frames.size, 0, "A full request pool does not poll on every animation frame");
let resolveDecode;
images[19].decoded = new Promise((resolve) => {
  resolveDecode = resolve;
});
images[19].load();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 4, "Native decode retains the shared slot");
assert.equal(frames.size, 0);
resolveDecode();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 3);
frame();
assert.equal(getVidaaPosterSchedulerStats().active, 4);
assert.equal(starts, 5);
cancelVidaaPosterJobs(owner);
cancelVidaaPosterJobs(otherScreen);
assert.equal(timers.size, 0);
assert.equal(frames.size, 0);
assert.equal(getVidaaPosterSchedulerStats().active, 0);
assert.equal(getVidaaPosterSchedulerStats().queued, 0);

// A fallback belongs to the original slot. Error handlers must not start a
// duplicate primary request or release capacity before fallback completion.
const fallback = new Poster("primary-poster");
fallback.onerror = () => {
  fallback.src = "fallback-poster";
};
scheduleVidaaPosterImage(owner, fallback);
frame();
fallback.error();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 1);
assert.equal(fallback.src, "fallback-poster");
fallback.load();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 0);

// New metadata and viewport cancellation cannot delete the replacement source
// or revive a retired request after its delayed load/decode callback.
const stale = new Poster("obsolete-poster");
scheduleVidaaPosterImage(owner, stale);
stale.dataset.src = "replacement-poster";
frame();
assert.equal(stale.src, "");
assert.equal(stale.dataset.src, "replacement-poster");
scheduleVidaaPosterImage(owner, stale);
frame();
let obsoleteDecode;
stale.decoded = new Promise((resolve) => {
  obsoleteDecode = resolve;
});
stale.load();
cancelVidaaPosterImage(stale);
assert.equal(stale.src, "");
assert.equal(stale.dataset.src, "replacement-poster");
obsoleteDecode();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 0);

// Missing native events and stalled decode share a bounded lifetime. The
// timeout releases the actual Image source as well as the scheduler slot.
const stalled = new Poster("stalled-poster");
scheduleVidaaPosterImage(owner, stalled);
frame();
time += 5000;
for (const [key, timer] of [...timers]) {
  if (timer.at <= time) {
    timers.delete(key);
    timer.callback();
  }
}
assert.equal(stalled.src, "");
assert.equal(stalled.dataset.src, "stalled-poster");
stalled.load();
await flush();
assert.equal(getVidaaPosterSchedulerStats().active, 0);
assert.equal(getVidaaPosterSchedulerStats().queued, 0);
assert.equal(timers.size, 0);
assert.ok(getVidaaPosterSchedulerStats().peakActive <= 4);
assert.ok(
  Object.values(getVidaaPosterSchedulerStats()).every(Number.isFinite),
  "Diagnostics contain aggregate numbers only"
);
console.log(
  "VIDAA shared poster budget passed: 4 request/decode slots, 2 starts/frame, focus priority, fallback, invalidation, cleanup and native-event deadline."
);
