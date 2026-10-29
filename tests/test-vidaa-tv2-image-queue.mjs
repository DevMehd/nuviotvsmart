import assert from "node:assert/strict";

// New Home image queue (nuv-107): a recycled card that changes image while loading must not
// leak a loading slot (the browser cancels the old load without load/error events).
const { createImageQueue } = await import("../js/ui/tv2/imagePipeline.js");

function node() {
  const attrs = {};
  return {
    getAttribute: (k) => attrs[k],
    removeAttribute: (k) => delete attrs[k],
    set src(v) {
      attrs.src = v;
    },
    get src() {
      return attrs.src;
    }
  };
}
const finish = (n) => n.onload && n.onload();

const queue = createImageQueue({ concurrency: 3 });
const cards = [node(), node(), node()];
cards.forEach((n, i) => queue.request(n, `a${i}.jpg`));
// Fast navigation: every card is recycled to a new image before its first load completes.
cards.forEach((n, i) => queue.request(n, `b${i}.jpg`));
cards.forEach((n) => {
  if (n.src.startsWith("a")) queue.request(n, n.src.replace("a", "b"));
});
cards.forEach(finish);
// The cancelled loads never fire events; the queue must still have free slots.
const late = node();
queue.request(late, "late.jpg");
assert.equal(
  late.src,
  "late.jpg",
  "queue keeps loading after recycled cards changed image mid-load"
);

// Clearing a card's image mid-load also frees its slot.
const q2 = createImageQueue({ concurrency: 1 });
const x = node();
const y = node();
q2.request(x, "x.jpg");
q2.request(x, "");
q2.request(y, "y.jpg");
assert.equal(y.src, "y.jpg", "an image removed while loading frees its slot");

// Home hidden with its view kept (lot D): clear() frees the slots; on return a loaded image stays,
// an interrupted one loads again with its handlers (fallbacks).
const q3 = createImageQueue({ concurrency: 2 });
const done = node();
const cut = node();
q3.request(done, "done.jpg");
q3.request(cut, "cut.jpg", { fallbacks: ["cut-fallback.jpg"] });
finish(done);
q3.clear();
assert.equal(cut.onerror, null, "the interrupted load lost its handlers");
assert.equal(cut.getAttribute("src"), undefined, "the interrupted load is cancelled while hidden");
assert.equal(done.getAttribute("src"), "done.jpg", "a loaded image stays");
done.src = "";
done.src = "done.jpg";
q3.request(done, "done.jpg");
q3.request(cut, "cut.jpg", { fallbacks: ["cut-fallback.jpg"] });
assert.equal(done.onload, null, "a loaded image is not requested again");
cut.onerror();
assert.equal(cut.src, "cut-fallback.jpg", "the reloaded image tries its fallback");

// Decoded-pixel budget: over it, a better-ranked request evicts the worst-ranked loaded image;
// a worse one waits instead of evicting (no load/evict loop between two cards).
const sized = (width, height) =>
  Object.assign(node(), { naturalWidth: width, naturalHeight: height });
const q4 = createImageQueue({ concurrency: 4, budgetPx: 1e6 });
const near = sized(500, 750); // 0.375 Mpx
const mid = sized(500, 750);
const far = sized(500, 750);
q4.request(near, "near.jpg", { rank: 0 });
q4.request(mid, "mid.jpg", { rank: 1 });
q4.request(far, "far.jpg", { rank: 3000 });
[near, mid, far].forEach(finish);
assert.equal(q4.decodedPx, 1125000, "three images decoded, now over budget");
const focusNext = sized(500, 750);
q4.request(focusNext, "next.jpg", { rank: 2 });
assert.equal(far.getAttribute("src"), undefined, "the worst-ranked image is evicted");
assert.equal(focusNext.src, "next.jpg", "the better-ranked image loads");
finish(focusNext);
assert.equal(q4.decodedPx, 1125000);
q4.request(far, "far.jpg", { rank: 3000 });
assert.equal(far.getAttribute("src"), undefined, "a worse-ranked image waits over budget");
assert.equal(near.src, "near.jpg", "better-ranked images stay");
assert.equal(q4.pendingCount, 1);
// Focus moved: the waiting card is now the best; it evicts the now worst-ranked one.
q4.request(near, "near.jpg", { rank: 4000 });
q4.request(far, "far.jpg", { rank: 0 });
assert.equal(near.getAttribute("src"), undefined, "the image now ranked last is evicted");
assert.equal(far.src, "far.jpg");
q4.request(mid, "");
assert.equal(q4.decodedPx, 375000, "a released image leaves the budget");
// Unranked callers (the WebGL renderer) are never held back by the budget.
const q5 = createImageQueue({ concurrency: 2, budgetPx: 1 });
const one = sized(500, 750);
const two = sized(500, 750);
q5.request(one, "one.jpg");
finish(one);
q5.request(two, "two.jpg");
assert.equal(two.src, "two.jpg", "rank 0 loads over budget");

console.log("PASS: VIDAA new Home image queue never leaks loading slots and keeps its Mpx budget.");
