import assert from "node:assert/strict";
import {
  scheduleVidaaGridPosterWindow,
  disposeVidaaGridPosterWindow,
  captureVidaaGridPosters,
  restoreVidaaGridPosters
} from "../js/ui/components/vidaaGridPosterWindow.js";
import { Platform } from "../js/platform/index.js";
import {
  noteVidaaNavigationKeyDown,
  noteVidaaNavigationKeyUp,
  resetVidaaNavigationActivity
} from "../js/ui/navigation/vidaaNavigationActivity.js";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.HTMLElement = class {};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
Platform.current = null;
let now = 1000;
let nextId = 0;
const frames = new Map();
const timers = new Map();
Date.now = () => now;
globalThis.requestAnimationFrame = (callback) => {
  const id = ++nextId;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextId;
  timers.set(id, { callback, at: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);

function frame() {
  now += 16;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(now));
}

function settleFrames() {
  let count = 0;
  while (frames.size) {
    assert.ok(++count < 30, "Hydration must finish without an unbounded frame loop");
    frame();
  }
}

function advance(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {
      timers.delete(id);
      timer.callback();
    }
  }
}

function surface(rowCount = 1000, columns = 6) {
  const counts = { rects: 0, imageQueries: 0, sources: 0 };
  const scroller = {
    scrollTop: 0,
    isConnected: true,
    getBoundingClientRect() {
      counts.rects++;
      return { top: 80, bottom: 680, height: 600 };
    }
  };
  const images = [];
  let top = 210;
  const rows = Array.from({ length: rowCount }, (_, row) => {
    const contentTop = top;
    const height = row % 3 === 0 ? 410 : 430;
    // Different row heights and real CSS gaps prevent an index*height estimate
    // from accidentally passing the long-grid test.
    top += height + (row % 2 ? 20 : 16);
    return Array.from({ length: columns }, (_, col) => {
      const attrs = new Map();
      const image = {
        isConnected: true,
        complete: true,
        naturalWidth: 248,
        dataset: { src: `poster-${row}-${col}.jpg` },
        getAttribute: (name) => attrs.get(name) || null,
        removeAttribute(name) {
          if (name === "data-src") delete this.dataset.src;
          else attrs.delete(name);
        },
        set src(value) {
          assert.ok(value, "Never assign an empty image URL");
          attrs.set("src", value);
          counts.sources++;
        },
        get src() {
          return attrs.get("src");
        }
      };
      const card = {
        dataset: { navRow: String(row), navCol: String(col), focusKey: `item:${row}-${col}` },
        getBoundingClientRect() {
          counts.rects++;
          return {
            top: 80 + contentTop - scroller.scrollTop,
            bottom: 80 + contentTop + height - scroller.scrollTop,
            height
          };
        },
        querySelector() {
          counts.imageQueries++;
          return image;
        },
        contentTop
      };
      image.closest = () => card;
      images.push(image);
      return card;
    });
  });
  const owner = {
    navModel: { rows },
    container: {
      isConnected: true,
      style: {},
      querySelector: () => scroller,
      querySelectorAll: () => images
    }
  };
  return { owner, rows, images, scroller, counts };
}

// Repeatedly traverse 6,000 posters, forwards and backwards. Loaded image
// residency stays bounded by viewport geometry, not by catalog length. Each
// pass uses binary row lookup and inspects only nearby/resident rows.
{
  const { owner, rows, images, scroller, counts } = surface();
  let peakResident = 0;
  let peakRectReads = 0;
  let peakImageQueries = 0;
  const visit = (row) => {
    scroller.scrollTop = rows[row][0].contentTop;
    const before = { ...counts };
    scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
    frame();
    assert.ok(
      counts.sources - before.sources <= 4,
      "The first frame also respects the source budget"
    );
    while (frames.size) {
      const sources = counts.sources;
      frame();
      assert.ok(counts.sources - sources <= 4, "Assign at most four posters in each frame");
    }
    const resident = images.filter((image) => image.src).length;
    peakResident = Math.max(peakResident, resident);
    peakRectReads = Math.max(peakRectReads, counts.rects - before.rects);
    peakImageQueries = Math.max(peakImageQueries, counts.imageQueries - before.imageQueries);
    assert.equal(owner.vidaaGridPosterWindow.resident.size, resident);
    assert.ok(
      rows[row].every((card) => card.querySelector().src),
      `Visible row ${row} loads`
    );
  };
  for (let row = 0; row < rows.length; row += 5) visit(row);
  for (let row = rows.length - 1; row >= 0; row -= 11) visit(row);
  assert.ok(peakResident <= 60, `Decoded-source residency grew to ${peakResident}`);
  assert.ok(peakRectReads <= 35, `A window read ${peakRectReads} row rectangles`);
  assert.ok(peakImageQueries <= 36, `A window scanned ${peakImageQueries} images`);
  disposeVidaaGridPosterWindow(owner);
  assert.equal(
    images.some((image) => image.src),
    false
  );
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  console.log(
    `Grid long-scroll window: peak ${peakResident}/6000 posters, ${peakRectReads} row reads, ${peakImageQueries} image queries per pass.`
  );
}

// Moving while a batch is pending discards the previous viewport's remaining
// queue. Visible rows take priority over the prefetch rows above them.
{
  const { owner, rows, scroller } = surface(100);
  scheduleVidaaGridPosterWindow(owner, ".discover-main");
  frame();
  scroller.scrollTop = rows[90][0].contentTop;
  scheduleVidaaGridPosterWindow(owner, ".discover-main");
  frame();
  frame();
  assert.equal(
    rows[0][0].querySelector().src,
    undefined,
    "An old viewport must not start requests"
  );
  assert.ok(rows[90][0].querySelector().src, "Visible row is loaded before earlier prefetch rows");
  disposeVidaaGridPosterWindow(owner);
}

// Repeated inputs coalesce into one frame and one quiet-prefetch timer.
// Visible posters keep loading during the hold; the larger runway waits.
{
  const { owner, counts } = surface(100);
  noteVidaaNavigationKeyDown(40);
  for (let index = 0; index < 100; index++) scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
  assert.equal(timers.size, 1);
  assert.equal(frames.size, 1);
  assert.equal(counts.rects, 0);
  settleFrames();
  assert.ok(counts.sources > 0, "Held navigation must not leave the visible grid empty");
  noteVidaaNavigationKeyUp(40);
  advance(300);
  settleFrames();
  assert.ok(counts.sources > 0);
  noteVidaaNavigationKeyDown(40);
  scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
  disposeVidaaGridPosterWindow(owner);
  advance(300);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  resetVidaaNavigationActivity();
}

// Source setters can be costly on a TV. Four cheap images may commit in one
// frame, but one expensive image must yield before the next assignment.
{
  const clockDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let time = 0;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => time }
  });
  const { owner, images, counts } = surface(4);
  try {
    for (const image of images) {
      const source = Object.getOwnPropertyDescriptor(image, "src");
      Object.defineProperty(image, "src", {
        ...source,
        set(value) {
          source.set.call(this, value);
          time += 6;
        }
      });
    }
    scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
    frame();
    assert.equal(
      counts.sources,
      1,
      "A costly source assignment shares the four-millisecond budget"
    );
    settleFrames();
    assert.ok(counts.sources > 1, "The pending visible images still make progress");
  } finally {
    disposeVidaaGridPosterWindow(owner);
    Object.defineProperty(globalThis, "performance", clockDescriptor);
  }
}

// A resize regroups navigation once and refreshes the image window. It must
// not leave a callback retaining a screen after route cleanup.
{
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const { owner } = surface(4);
  let rebuilds = 0;
  owner.buildNavigationModel = () => rebuilds++;
  scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
  assert.equal(listeners.size, 1);
  listeners.get("resize")();
  assert.equal(rebuilds, 1);
  assert.equal(frames.size, 1, "Resize and initial hydration coalesce into one frame");
  settleFrames();
  disposeVidaaGridPosterWindow(owner);
  assert.equal(listeners.size, 0);
  delete globalThis.window;
}

// Grid rebuilds keep the already decoded visible node. Cleanup releases it
// even if it has been transferred into a replacement card.
{
  const { owner, rows, images } = surface(4);
  scheduleVidaaGridPosterWindow(owner, ".seeall-shell");
  settleFrames();
  const snapshots = captureVidaaGridPosters(owner);
  const loaded = images[0];
  const replacement = {
    alt: "New title",
    dataset: { src: loaded.src },
    closest: () => rows[0][0],
    parentNode: {
      replaceChild(image) {
        assert.equal(image, loaded);
      }
    }
  };
  owner.container.querySelectorAll = () => [replacement];
  restoreVidaaGridPosters(owner, snapshots);
  assert.equal(loaded.alt, "New title");
  disposeVidaaGridPosterWindow(owner);
  assert.equal(loaded.src, undefined);
}

const { createDiscoverScreenMethods04 } =
  await import("../js/ui/screens/search/discoverScreenMethods-04-restore-focused-card.js");
const { createDiscoverScreenMethods05 } =
  await import("../js/ui/screens/search/discoverScreenMethods-05-restore-content-focus.js");

// The real Discover adapter selects the indexed path, and an arrow held at a
// row boundary does not repeat focus scans, scrolling or pagination work.
{
  const { owner, rows } = surface(3, 3);
  Object.assign(owner, createDiscoverScreenMethods04(), createDiscoverScreenMethods05());
  owner.scheduleDiscoverPosterHydration();
  settleFrames();
  assert.ok(owner.vidaaGridPosterWindow.resident.size > 0);
  let focusCalls = 0;
  let current = rows[1][2];
  owner.container.querySelector = () => current;
  owner.focusNode = (target) => {
    current = target;
    focusCalls++;
    return true;
  };
  for (let index = 0; index < 1000; index++)
    owner.handleGridDpad({ keyCode: 39, preventDefault() {} });
  assert.equal(focusCalls, 0, "Holding at a right edge is a no-op");
  owner.handleGridDpad({ keyCode: 37, preventDefault() {} });
  assert.equal(current, rows[1][1]);
  assert.equal(focusCalls, 1, "Reversing from the edge still moves immediately");
  current = rows[1][0];
  for (let index = 0; index < 1000; index++)
    owner.handleGridDpad({ keyCode: 37, preventDefault() {} });
  assert.equal(focusCalls, 1, "Holding at a left edge is a no-op");
  disposeVidaaGridPosterWindow(owner);
}

console.log(
  "VIDAA grid poster lifecycle passed: bounded long-scroll residency, current viewport priority, batching, quiet input, cancellation, reuse and Discover edge no-ops."
);
