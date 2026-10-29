import assert from "node:assert/strict";

// WebGL Home images (lot W1a) on a fake Lightning node: the queue slot is held until Lightning's
// loaded/failed, a failure tries the next fallback then shows the text tile, a node is never
// visible without a URL, and the hero node is cropped as cover in the DOM hero's rectangle.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
const rootClasses = new Set();
globalThis.document = {
  documentElement: { classList: { contains: (name) => rootClasses.has(name) } }
};
let reducedMotion = false;
globalThis.matchMedia = () => ({ matches: reducedMotion });

const { imageSlot, heroNodeProps, glInfo, homeMotion, tween, settle } =
  await import("../js/ui/tv2/render/lightning/lightningHomeRenderer.js");
const { createImageQueue } = await import("../js/ui/tv2/imagePipeline.js");
const setting = await import("../js/ui/tv2/newHomeSetting.js");
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

// Like a Lightning CoreNode: each src gets its own texture, whose events stop at the next src;
// the same src again is ignored; renderState 2 is OutOfBounds.
function fakeNode() {
  const listeners = {};
  const node = {
    alpha: 1,
    renderState: 4,
    texture: null,
    textures: 0,
    props: { src: null },
    on: (event, fn) => (listeners[event] = listeners[event] || []).push(fn),
    emit: (event) => (listeners[event] || []).forEach((fn) => fn(node, {})),
    get src() {
      return node.props.src;
    },
    set src(url) {
      if (node.props.src === url) return;
      node.props.src = url;
      node.texture = url ? { url } : null;
      if (url) node.textures += 1;
    },
    // The texture of `url` reports `event` only while it is still the node's texture.
    finish(url, event) {
      if (node.texture?.url === url) node.emit(event);
    }
  };
  return node;
}

const visibleWithoutUrl = (node) => node.alpha > 0 && !node.src;

// Fallbacks then the tile.
{
  const node = fakeNode();
  const states = [];
  const slot = imageSlot(node, 1, (state) => states.push(state));
  assert.equal(node.alpha, 0, "no texture, no paint (Lightning paints it white)");
  const queue = createImageQueue();
  queue.request(slot, "/a.jpg", { fallbacks: ["/b.jpg"] });
  assert.equal(node.src, "/a.jpg");
  assert.equal(node.alpha, 1, "visible with a URL: Lightning only loads visible nodes");
  node.finish("/a.jpg", "failed");
  assert.equal(node.src, "/b.jpg", "next fallback in the same slot");
  node.finish("/a.jpg", "loaded");
  assert.deepEqual(states, ["loading", "loading"], "a late event of the old texture is ignored");
  node.finish("/b.jpg", "failed");
  assert.deepEqual(states, ["loading", "loading", "failed"], "text tile after the last one");
  queue.request(slot, "/a.jpg", { fallbacks: ["/b.jpg"] });
  assert.equal(node.src, "/b.jpg", "a failed card is not reloaded on every move");
  queue.request(slot, "");
  assert.equal(node.alpha, 0);
  assert.equal(states.at(-1), "empty");
  assert.equal(glInfo(), null, "no engine in node");
}

// At most 3 loads at once, the focused card first, a slot freed by loaded or by leaving bounds.
{
  const queue = createImageQueue();
  const nodes = Array.from({ length: 5 }, fakeNode);
  const slots = nodes.map((node) => imageSlot(node));
  slots.forEach((slot, index) => queue.request(slot, `/${index}.jpg`));
  const focused = fakeNode();
  queue.request(imageSlot(focused), "/focused.jpg", { priority: true });
  assert.deepEqual(
    nodes.map((node) => node.src),
    ["/0.jpg", "/1.jpg", "/2.jpg", null, null],
    "three in flight until Lightning answers"
  );
  assert.equal(queue.pendingCount, 3);
  nodes[0].finish("/0.jpg", "loaded");
  assert.equal(focused.src, "/focused.jpg", "the focused card goes first");
  nodes[1].renderState = 2;
  nodes[1].emit("outOfBounds");
  assert.equal(nodes[1].src, null, "out of bounds before loading: slot given back");
  assert.equal(nodes[1].alpha, 0);
  assert.equal(nodes[3].src, "/3.jpg");
  // Already outside the bounds when its turn comes: given back without waiting for an event.
  nodes[4].renderState = 2;
  nodes[2].finish("/2.jpg", "loaded");
  assert.equal(nodes[4].src, "/4.jpg");
  await flush();
  assert.equal(nodes[4].src, null);
  nodes[4].renderState = 4;
  queue.request(slots[4], "/4.jpg");
  assert.equal(nodes[4].src, "/4.jpg", "requested again by the next update");
  assert.equal(nodes.some(visibleWithoutUrl), false);
  // The same URL again re-attaches the texture, so Lightning reports for it (no stuck slot).
  const node = nodes[0];
  const before = node.textures;
  slots[0].src = "/0.jpg";
  assert.equal(node.textures, before + 1);
}

// Hero: the modern hero media rectangle, cover from the top right; full screen when enabled.
assert.deepEqual(heroNodeProps(), {
  x: 594,
  y: 0,
  w: 1382,
  h: 650,
  textureOptions: { resizeMode: { type: "cover", clipX: 1, clipY: 0 } }
});
assert.deepEqual(
  (({ x, y, w, h }) => [x, y, w, h])(heroNodeProps({ modernHeroFullScreenBackdropEnabled: true })),
  [0, 0, 1920, 1080]
);

// Motion (lot W2): the DOM renderer's durations and curves, none under reduced motion.
{
  const domRoot = { animate() {} };
  const rail = { duration: 140, easing: "cubic-bezier(0.33, 0, 0.67, 1)" };
  assert.deepEqual(homeMotion(domRoot), { rail: null, scale: null, hero: null }, "off VIDAA");
  rootClasses.add("vidaa-tv").add("vidaa-balanced-motion");
  assert.deepEqual(homeMotion(domRoot), {
    rail,
    scale: { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    hero: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }
  });
  rootClasses.add("performance-constrained");
  assert.equal(homeMotion(domRoot).rail.duration, 100);
  reducedMotion = true;
  assert.deepEqual(homeMotion(domRoot), { rail: null, scale: null, hero: null }, "reduced motion");
  reducedMotion = false;

  // Like Lightning: animate() hands out a pooled controller, stop(reset) emits "stopped".
  const calls = [];
  const node = {
    x: 0,
    animate(props, settings) {
      const listeners = [];
      const ctrl = {
        stopped: false,
        start: () => calls.push(["start", props.x, settings]),
        stop(reset) {
          calls.push(["stop", reset]);
          ctrl.stopped = true;
          listeners.splice(0).forEach((fn) => fn());
        },
        once: (event, fn) => event === "stopped" && listeners.push(fn),
        finish() {
          Object.assign(node, props);
          listeners.splice(0).forEach((fn) => fn());
        }
      };
      node.ctrl = ctrl;
      return ctrl;
    }
  };
  tween(node, "x", -100, rail);
  assert.deepEqual(calls, [["start", -100, rail]]);
  tween(node, "x", -100, rail);
  assert.equal(calls.length, 1, "the same target never restarts the slide");
  const first = node.ctrl;
  tween(node, "x", -200, rail);
  assert.deepEqual(
    calls.slice(1),
    [
      ["stop", false],
      ["start", -200, rail]
    ],
    "stopped in place"
  );
  assert.equal(first.stopped, true);
  node.ctrl.finish();
  tween(node, "x", -300, rail);
  assert.deepEqual(
    calls.slice(3),
    [["start", -300, rail]],
    "a finished (pooled) one is not stopped"
  );
  let done = 0;
  tween(node, "x", 40, null, () => (done += 1));
  assert.deepEqual(calls.slice(4), [["stop", false]], "no settings: set at once");
  assert.equal(node.x, 40);
  assert.equal(done, 1);
  tween(node, "x", 40, rail, () => (done += 1));
  assert.equal(calls.length, 5, "already there: no animation");
  assert.equal(done, 2);
  // An interrupted hero fade ends at its target, never stuck half-faded over the background.
  tween(node, "x", 90, rail, () => (done += 1));
  node.x = 60;
  settle(node);
  assert.equal(node.x, 90, "settled at the target");
  assert.equal(done, 3);
  settle(node);
  assert.equal(done, 3, "nothing left to settle");
  rootClasses.clear();
}

// Diagnostic variants: one at a time, cycled from the Diagnostic, back to standard.
assert.equal(setting.getWebglVariant(), "standard");
const seen = setting.WEBGL_VARIANTS.map(() => setting.cycleWebglVariant());
assert.deepEqual(seen, ["bitmap-basic", "platform-legacy", "hero-780", "standard"]);
assert.equal(store.has("tvWebglVariant"), false);

console.log("PASS: WebGL Home image slots, fallbacks, text tile, hero cover, motion and variants");
