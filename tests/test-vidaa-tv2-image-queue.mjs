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
done.src = "";
done.src = "done.jpg";
q3.request(done, "done.jpg");
q3.request(cut, "cut.jpg", { fallbacks: ["cut-fallback.jpg"] });
assert.equal(done.onload, null, "a loaded image is not requested again");
cut.onerror();
assert.equal(cut.src, "cut-fallback.jpg", "the reloaded image tries its fallback");

console.log("PASS: VIDAA new Home image queue never leaks loading slots.");
