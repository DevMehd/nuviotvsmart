import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const { getVidaaHomeTrackTarget, invalidateVidaaHomeTrackGeometry } =
  await import("../js/ui/screens/home/vidaaHomeNavigationGeometry.js");
const { createHomeScreenMethods15 } =
  await import("../js/ui/screens/home/homeScreenMethods-15-schedule-focused-poster-flow.js");
const { createHomeScreenMethods17 } =
  await import("../js/ui/screens/home/homeScreenMethods-17-end-modern-vertical-fast-scroll.js");
const { createHomeScreenMethods02 } =
  await import("../js/ui/screens/home/homeScreenMethods-02-restore-modern-focus-state.js");
const { animateVidaaFocusScroll } = await import("../js/ui/navigation/vidaaFocusScroll.js");
let reads = 0;
let shift = 0;
const track = {
  dataset: { trackPadAlignLeft: "40" },
  scrollLeft: 0,
  isConnected: true,
  getBoundingClientRect() {
    reads++;
    return { left: 90 };
  }
};
Object.defineProperties(track, {
  scrollWidth: {
    get() {
      reads++;
      return 6000;
    }
  },
  clientWidth: {
    get() {
      reads++;
      return 800;
    }
  }
});
const cards = Array.from({ length: 20 }, (_, i) => ({
  dataset: { navRow: "0", navCol: String(i) },
  isConnected: true,
  closest: () => track,
  getBoundingClientRect() {
    reads++;
    return { left: 90 + 40 + i * 250 + shift - track.scrollLeft };
  }
}));
const screen = {
  layoutMode: "modern",
  ...createHomeScreenMethods15(),
  ...createHomeScreenMethods17(),
  navModel: { rows: [cards] },
  navigationDomVersion: 3
};
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[4], 40, { onlyCached: true }), null);
assert.equal(reads, 0, "Checking a cold cache cannot flush layout on key input");
assert.equal(screen.getModernTrackAlignedScrollTarget(cards[4]).value, 1000);
const coldReads = reads;
for (let step = 0; step < 200; step++) {
  const i = step % 20;
  track.scrollLeft = step % 500;
  const result = screen.getModernTrackAlignedScrollTarget(cards[i]);
  assert.equal(result.value, i * 250);
  assert.equal(result.maxScrollValue, 5200);
}
assert.equal(
  reads,
  coldReads,
  "Repeated navigation in an unchanged row does not reread coordinates or bounds"
);

// The warm path starts motion during the input turn, avoiding a second RAF.
const frames = [];
globalThis.requestAnimationFrame = (cb) => {
  frames.push(cb);
  return frames.length;
};
globalThis.cancelAnimationFrame = () => {};
let started;
screen.animateScroll = (...args) => {
  started = args;
};
screen.ensureTrackHorizontalVisibility(cards[6], "right");
assert.equal(frames.length, 0);
assert.equal(started[2], 1500);
assert.equal(started[4].maxScrollValue, 5200);

// Changed layouts, pagination, viewport dimensions and expanded previews must
// never use coordinates from an earlier row state.
shift = 100;
screen.navigationDomVersion++;
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[6], 40, { onlyCached: true }), null);
assert.equal(screen.getModernTrackAlignedScrollTarget(cards[6]).value, 1600);
invalidateVidaaHomeTrackGeometry(screen, track);
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[6], 40, { onlyCached: true }), null);
screen.getModernTrackAlignedScrollTarget(cards[6]);
cards.push({ ...cards[0], dataset: { navRow: "0", navCol: "20" } });
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[6], 40, { onlyCached: true }), null);
screen.getModernTrackAlignedScrollTarget(cards[6]);
globalThis.innerWidth = 999;
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[6], 40, { onlyCached: true }), null);
screen.getModernTrackAlignedScrollTarget(cards[6]);
screen.expandedPosterNode = { classList: { contains: () => true } };
assert.equal(getVidaaHomeTrackTarget(screen, track, cards[6], 40), null);
const beforeExpanded = reads;
screen.getModernTrackAlignedScrollTarget(cards[6]);
assert.ok(reads > beforeExpanded, "Expanded previews retain live measurement");
screen.expandedPosterNode = null;

const huge = Array.from({ length: 1000 }, (_, i) => ({
  ...cards[0],
  dataset: { navRow: "0", navCol: String(i) },
  getBoundingClientRect() {
    reads++;
    return { left: i * 250 };
  }
}));
screen.navModel.rows = [huge];
const beforeHuge = reads;
getVidaaHomeTrackTarget(screen, track, huge[900], 40);
assert.ok(reads - beforeHuge <= 27, "A large collection cannot trigger unbounded warmup");
assert.ok(screen.homeVidaaTrackGeometry.get(track).positions.size <= 24);

// Already checked bounds eliminate duplicate layout reads in the animator.
reads = 0;
const owner = {};
globalThis.performance = { now: () => 0 };
globalThis.matchMedia = () => ({ matches: false });
animateVidaaFocusScroll(owner, track, "x", 2000, { duration: 100, maxScrollValue: 5200 });
assert.equal(reads, 0);
assert.equal(owner.vidaaFocusScrollAnimations.get(track).x.duration, 100);

// The Home compromise keeps animation while finishing before a 120 ms repeat.
const home = { ...createHomeScreenMethods02(), isPerformanceConstrained: () => true };
home.animateScroll(track, "x", 3000, 140, { maxScrollValue: 5200 });
assert.equal(home.vidaaFocusScrollAnimations.get(track).x.duration, 100);
const full = { ...createHomeScreenMethods02(), isPerformanceConstrained: () => false };
full.animateScroll(track, "x", 3000, 140, { maxScrollValue: 5200 });
assert.equal(full.vidaaFocusScrollAnimations.get(track).x.duration, 140);
console.log(
  JSON.stringify({
    result: "PASS",
    moves: 200,
    previousGeometryReads: 800,
    cachedGeometryReads: coldReads,
    warmPathQueuedStarterFrames: 0,
    warmupLimit: 24
  })
);
