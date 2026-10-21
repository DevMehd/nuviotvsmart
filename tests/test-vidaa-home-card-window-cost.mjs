import assert from "node:assert/strict";
import {
  updateVidaaHomeCardWindow,
  restoreVidaaHomeNavigationNeighborhood,
  discardVidaaHomeCards
} from "../js/ui/screens/home/vidaaHomeCardWindow.js";

globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

let measurements = 0;
let scans = 0;
const viewportRect = { left: 0, right: 800, top: 0, bottom: 320 };
const row = {
  getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 240 })
};
const track = {
  isConnected: true,
  scrollLeft: 0,
  reversed: false,
  get childElementCount() {
    return cards.length;
  }
};
const fragment = () => ({
  childNodes: [],
  appendChild(node) {
    if (node.parent) node.parent.childNodes.splice(node.parent.childNodes.indexOf(node), 1);
    this.childNodes.push(node);
    node.parent = this;
  }
});
function cardAt(index) {
  const styles = new Map();
  const classes = new Set(["home-content-card"]);
  const card = {
    index,
    isConnected: true,
    dataset: { navRow: "0", navCol: String(index) },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    style: {
      getPropertyValue: (name) => styles.get(name) || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name)
    },
    childNodes: [],
    get firstChild() {
      return this.childNodes[0];
    },
    ownerDocument: { createDocumentFragment: fragment },
    appendChild(content) {
      while (content.childNodes.length) {
        const node = content.childNodes.shift();
        this.childNodes.push(node);
        node.parent = this;
      }
    },
    closest: (selector) => (selector === ".home-track" ? track : row),
    contains: (node) => node === card,
    querySelector: () => null,
    querySelectorAll: () => [],
    offsetWidth: 180,
    offsetHeight: 240,
    getBoundingClientRect() {
      measurements++;
      const position = track.reversed ? cards.length - 1 - this.index : this.index;
      const left = position * 200 - track.scrollLeft;
      return { left, right: left + 180, top: 0, bottom: 240 };
    }
  };
  card.childNodes.push({ parent: card });
  return card;
}
const cards = Array.from({ length: 1000 }, (_, index) => cardAt(index));
const container = {
  contains: (card) => cards.includes(card),
  querySelectorAll() {
    scans++;
    return cards;
  }
};
const screen = { container, navModel: { rows: [cards] } };

updateVidaaHomeCardWindow(screen, viewportRect, cards[0]);
assert.ok(screen.homeVidaaParkedCards.size > 980, "Initial pass parks the distant catalog");
assert.equal(scans, 1);
measurements = 0;
updateVidaaHomeCardWindow(screen, viewportRect, cards[0]);
assert.equal(scans, 1, "An unchanged navigation model must not rescan the whole DOM");
assert.ok(measurements < 40, `A 1000-card idle pass used ${measurements} geometry reads`);

// Jump and reverse through the catalog. The indexed window must discover every
// nearby parked card while also retiring the previous live neighborhood.
for (const index of [500, 995, 3, 700]) {
  restoreVidaaHomeNavigationNeighborhood(screen, cards[index], "right");
  track.scrollLeft = index * 200;
  measurements = 0;
  updateVidaaHomeCardWindow(screen, viewportRect, cards[index]);
  assert.ok(measurements < 70, `Moving the window used ${measurements} geometry reads`);
  cards.forEach((card) => {
    const left = card.index * 200 - track.scrollLeft;
    const near = left + 180 >= -600 && left <= 1400;
    assert.equal(screen.homeVidaaParkedCards.has(card), !near, "Retain exactly the nearby window");
  });
}
assert.equal(scans, 1, "Scrolling/reversing reuses the bounded inventory");

// RTL rows place their first catalog card at the right. Search by physical
// order while preserving the navigation model's original card order.
track.reversed = true;
track.scrollLeft = 600 * 200;
restoreVidaaHomeNavigationNeighborhood(screen, cards[399], "right");
measurements = 0;
updateVidaaHomeCardWindow(screen, viewportRect, cards[399]);
assert.ok(measurements < 70, "RTL must retain bounded geometry work");
cards.forEach((card) => {
  const left = (cards.length - 1 - card.index) * 200 - track.scrollLeft;
  assert.equal(screen.homeVidaaParkedCards.has(card), !(left + 180 >= -600 && left <= 1400));
});
track.reversed = false;
track.scrollLeft = 700 * 200;

// Pagination can append to the existing navigation array without replacing the
// model. Detect changed track membership and retire even new distant trees.
cards.push(cardAt(1000));
updateVidaaHomeCardWindow(screen, viewportRect, cards[700]);
assert.equal(scans, 2, "Pagination invalidates the cached inventory");
assert.equal(screen.homeVidaaParkedCards.has(cards[1000]), true);
screen.navModel = { rows: [cards] };
updateVidaaHomeCardWindow(screen, viewportRect, cards[700]);
assert.equal(scans, 3, "A render/navigation rebuild invalidates the cached inventory");
discardVidaaHomeCards(screen);
assert.equal(screen.homeVidaaCardWindowSnapshot, null, "Cleanup releases cached DOM references");
assert.equal(screen.homeVidaaActiveCards, null);
console.log(
  "Home card-window checks passed: bounded layout reads across 1000 posters, jumps/reversals, pagination invalidation and cleanup."
);
