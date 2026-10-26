import assert from "node:assert/strict";

// VIDAA player Sources panel (nuv-091): only a window of cards around the focus is rendered,
// so opening the panel during 4K playback no longer parses hundreds of cards at once.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { createPlayerScreenMethods63 } =
  await import("../js/ui/screens/player/playerScreenMethods-63-get-source-request-key.js");

const sources = Array.from({ length: 300 }, (_, i) => ({
  url: `https://example.org/${i}.mkv`,
  label: `Source ${i}`,
  addonName: "Addon"
}));

function render(focusIndex) {
  const panel = {
    childNodes: [],
    classList: { toggle() {} },
    querySelector: () => null,
    innerHTML: ""
  };
  createPlayerScreenMethods63().renderSourcesPanel.call({
    cancelScheduledSourcesPanelRender() {},
    uiRefs: { sourcesPanel: panel },
    sourcesPanelVisible: true,
    sourcesFocus: { zone: "list", index: focusIndex },
    params: {},
    streamCandidates: [],
    getOrderedStreamCandidates: () => sources,
    getSourceFilters: () => ["all"],
    getFilteredSources: () => sources,
    ensureSourcesFocus() {},
    syncSourcesFocusDom() {}
  });
  return [...panel.innerHTML.matchAll(/data-sources-zone="list" data-sources-index="(\d+)"/g)].map(
    (m) => Number(m[1])
  );
}

const middle = render(150);
assert.ok(middle.length <= 24, `rendered ${middle.length} cards`);
assert.ok(middle.includes(150), "focused card rendered with its absolute index");
assert.ok(!middle.includes(0) && !middle.includes(299));

const start = render(0);
assert.equal(start[0], 0);
assert.ok(start.length <= 24);

const end = render(299);
assert.equal(end[end.length - 1], 299, "window clamps at the end of the list");
assert.ok(end.length <= 24);

console.log("PASS: VIDAA player Sources panel renders a window around the focus.");
