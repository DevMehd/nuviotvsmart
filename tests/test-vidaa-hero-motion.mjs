import assert from "node:assert/strict";
import {
  swapVidaaHeroImage,
  finishVidaaHeroTransition,
  useVidaaHeroTransition
} from "../js/ui/screens/home/vidaaHeroTransition.js";
let balanced = true,
  reduced = false;
globalThis.document = { documentElement: { classList: { contains: () => balanced } } };
globalThis.matchMedia = () => ({ matches: reduced });
const layers = new Set();
let animations = [];
function image(source = "old.webp") {
  const attributes = new Map([["src", source]]);
  const node = {
    naturalWidth: 1280,
    naturalHeight: 720,
    isConnected: true,
    style: {},
    classList: { add() {}, remove() {} },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    get offsetWidth() {
      assert.fail("Artwork transitions must not force layout");
    },
    parentElement: {
      insertBefore(ghost) {
        layers.add(ghost);
      }
    },
    cloneNode() {
      return image(attributes.get("src"));
    },
    remove() {
      layers.delete(node);
    },
    animate(keyframes, options) {
      const animation = {
        keyframes,
        options,
        cancelled: false,
        cancel() {
          this.cancelled = true;
        }
      };
      animations.push(animation);
      return animation;
    }
  };
  return node;
}
const backdrop = image();
assert.ok(useVidaaHeroTransition(backdrop));
swapVidaaHeroImage(backdrop, "next.webp", "Next", "backdrop");
assert.equal(layers.size, 1);
assert.equal(
  [...layers][0].getAttribute("src"),
  "old.webp",
  "Previous artwork stays visible below the incoming picture"
);
assert.equal([...layers][0].getAttribute("aria-hidden"), "true");
assert.equal(backdrop.getAttribute("src"), "next.webp");
const previousAnimation = animations[0];
swapVidaaHeroImage(backdrop, "last.webp", "Last", "backdrop");
assert.ok(previousAnimation.cancelled);
assert.equal(layers.size, 1, "Interrupted transitions cannot accumulate image layers");
assert.equal([...layers][0].getAttribute("src"), "next.webp");
finishVidaaHeroTransition(backdrop);
assert.equal(layers.size, 0);
assert.ok(animations.every((a) => a.cancelled));
animations = [];
const logo = image();
swapVidaaHeroImage(logo, "logo.webp", "Logo", "logo");
assert.equal(animations.length, 2, "Transparent logos also fade out the old shape");
finishVidaaHeroTransition(logo);
const oversized = image();
oversized.naturalWidth = 4000;
swapVidaaHeroImage(oversized, "small.webp", "Small", "backdrop");
assert.equal(layers.size, 0, "Do not duplicate oversized decoded artwork");
finishVidaaHeroTransition(oversized);
const broken = image();
broken.animate = () => {
  throw Error("Unsupported");
};
swapVidaaHeroImage(broken, "working.webp", "Working", "backdrop");
assert.equal(layers.size, 0);
assert.equal(broken.getAttribute("src"), "working.webp");
const detached = image();
detached.isConnected = false;
swapVidaaHeroImage(detached, "ignored.webp", "Ignored", "backdrop");
assert.equal(detached.getAttribute("src"), "old.webp");
reduced = true;
assert.equal(useVidaaHeroTransition(image()), false);
reduced = false;
balanced = false;
assert.equal(useVidaaHeroTransition(image()), false);
assert.equal(useVidaaHeroTransition({}), false);
console.log(
  "VIDAA hero motion: continuous artwork, bounded layers, no forced layout, interruption and fallback passed."
);
