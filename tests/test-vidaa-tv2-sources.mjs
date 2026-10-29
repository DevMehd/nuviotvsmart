import assert from "node:assert/strict";

// New TV Sources screen (beta, T2): fixed geometry, memoised view and remote keys. The DOM pool is
// covered by tests/test-vidaa-tv2-sources.html; here the renderer is a recording stub.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const { StreamScreen, streamRowKeys } = await import("../js/ui/screens/stream/streamScreen.js");
const { NewSourcesScreen } = await import("../js/ui/tv2/sources/newSourcesScreen.js");
const model = await import("../js/ui/tv2/sources/sourcesModel.js");
const { SOURCES_ROW_PITCH, sourcesWindow, rowKeys, rowViewModel, filterNames } = model;

// Row keys: the extracted helper is the StreamScreen key, duplicates included.
const duplicates = [
  { id: "a", addonName: "A", url: "https://a/1" },
  { id: "a2", addonName: "A", url: "https://a/1" },
  { id: "b", addonName: "B", url: "https://b/1" },
  { id: "x" },
  { id: "x" },
  {}
];
const keys = streamRowKeys(duplicates);
assert.deepEqual(
  StreamScreen.getStreamVirtualKeys.call({}, duplicates),
  keys,
  "the old screen keeps the same keys"
);
assert.equal(new Set(keys).size, duplicates.length, "duplicates get distinct keys");
assert.equal(keys[1], keys[0].replace(/::0$/, "::1"), "the same source twice: occurrence 0 then 1");
assert.equal(rowKeys(duplicates), rowKeys(duplicates), "keys are computed once per list");

// Geometry at 500 sources: bounded pool, offset = first visible row × pitch, focus always visible.
const visible = 5;
let first = 0;
for (let focusRow = 0; focusRow < 500; focusRow += 1) {
  const frame = sourcesWindow({ count: 500, focusRow, first });
  first = frame.first;
  assert.ok(frame.end - frame.start <= frame.poolSize && frame.poolSize === 9, "pool of 9 rows");
  assert.equal(frame.offset, 0 - first * SOURCES_ROW_PITCH);
  assert.ok(focusRow >= first && focusRow < first + visible, `row ${focusRow} visible`);
  assert.ok(frame.start <= focusRow && focusRow < frame.end, "the focused row is drawn");
}
assert.equal(first, 495, "the last rows fill the list");
assert.equal(
  sourcesWindow({ count: 500, focusRow: 4, first: 0 }).first,
  0,
  "rows 0-4 are visible without moving"
);
assert.equal(
  sourcesWindow({ count: 500, focusRow: 5, first: 0 }).first,
  1,
  "the camera moves one row at a time"
);
assert.equal(
  sourcesWindow({ count: 500, focusRow: 497, first: 495 }).first,
  495,
  "moving up inside the view keeps it"
);
assert.equal(
  sourcesWindow({ count: 500, focusRow: 300, first: 0 }).offset,
  -296 * SOURCES_ROW_PITCH
);
assert.equal(
  sourcesWindow({ count: 3, focusRow: -1, first: 7 }).first,
  0,
  "a short list starts at the top"
);
assert.deepEqual(
  [sourcesWindow({ count: 0, first: 4 }).start, sourcesWindow({ count: 0, first: 4 }).end],
  [0, 0],
  "no rows without sources"
);

// Card text: computed once per stream object, two description lines at most.
const described = {
  id: "d",
  name: "Addon\n1080p",
  description: "File.1080p.mkv\n💾 2 GB\n🔊 FR\nmore",
  addonName: "Torrentio"
};
const card = rowViewModel(described);
assert.equal(rowViewModel(described), card, "cached per stream object");
assert.equal(card.description.split("\n").length, 2);
assert.equal(card.quality, "1080p");
assert.equal(card.addonLabel, "µ");
const chips = [{ name: "A", status: "success" }];
assert.equal(
  filterNames(duplicates, chips),
  filterNames(duplicates, chips),
  "filter names are memoised"
);

// Screen with a recording renderer.
const streams = Array.from({ length: 12 }, (_, index) => ({
  id: `s${index}`,
  addonName: index < 6 ? "A" : "B",
  addonOrderIndex: index < 6 ? 0 : 1,
  url: `https://example.invalid/${index}`
}));
function createScreen(overrides = {}) {
  const calls = { focus: [], updates: [], played: [], refreshed: 0, back: 0 };
  const screen = {
    ...NewSourcesScreen,
    container: { contains: () => true },
    params: { itemId: "tt1", itemType: "movie" },
    streams,
    sourceChips: [
      { name: "A", status: "success", orderIndex: 0 },
      { name: "B", status: "loading", orderIndex: 1 }
    ],
    addonFilter: "all",
    loading: false,
    error: "",
    focusState: { zone: "card", row: 0, action: "play" },
    streamUserMovedFocus: false,
    _filteredStreamsCache: null,
    sourcesRenderer: {
      update(view, focus) {
        calls.updates.push(view);
        calls.focus.push({ ...focus });
      },
      setFocus(focus) {
        calls.focus.push({ ...focus });
      },
      dispose() {}
    },
    playStream(id) {
      calls.played.push(id);
    },
    refreshStreams() {
      calls.refreshed += 1;
    },
    navigateBackFromStream() {
      calls.back += 1;
      return true;
    },
    calls,
    ...overrides
  };
  screen.render();
  return screen;
}
const key = (name, extra = {}) => ({
  key: name,
  keyCode: { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 }[
    name
  ],
  preventDefault() {},
  ...extra
});
const lastFocus = (screen) => screen.calls.focus.at(-1);

{
  const screen = createScreen();
  const view = screen.calls.updates[0];
  assert.deepEqual(view.chipKeys, ["all", "A", "B"]);
  assert.equal(view.items.length, 12);
  assert.equal(view.more, true, "B is still loading: one loading row under the sources");
  screen.render();
  assert.equal(
    screen.calls.updates[1].items,
    view.items,
    "an unchanged render reuses the sorted list"
  );
  assert.equal(screen.calls.updates[1].keys, view.keys, "and its keys");

  screen.onKeyDown(key("ArrowDown"));
  assert.deepEqual(lastFocus(screen), { zone: "card", row: 1, index: 1, action: "play" });
  assert.equal(screen.calls.updates.length, 2, "a focus move is not a render");
  screen.onKeyDown(key("ArrowUp"));
  screen.onKeyDown(key("ArrowUp"));
  assert.deepEqual(
    lastFocus(screen),
    { zone: "filter", index: 1 },
    "Up from the first source goes to the selected chip"
  );
  screen.onKeyDown(key("ArrowLeft"));
  assert.deepEqual(
    lastFocus(screen),
    { zone: "filter", index: 0 },
    "index 0 is Refresh, not a filter"
  );
  assert.equal(screen.addonFilter, "all");
  screen.onKeyDown(key("Enter"));
  assert.equal(screen.calls.refreshed, 1, "OK on Refresh reloads");
  screen.onKeyDown(key("ArrowRight"));
  screen.onKeyDown(key("ArrowRight"));
  assert.equal(screen.addonFilter, "A", "Right on the chips selects the next filter");
  assert.deepEqual(lastFocus(screen), { zone: "filter", index: 2 });
  assert.equal(screen.calls.updates.at(-1).items.length, 6);
  screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("ArrowRight"));
  assert.equal(screen.addonFilter, "B", "Right on a card changes the filter");
  assert.deepEqual(
    lastFocus(screen),
    { zone: "card", row: 0, index: 0, action: "play" },
    "a new filter starts at its top"
  );
  assert.equal(screen.calls.updates.at(-1).resetScroll, true);
  screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("Enter"));
  assert.deepEqual(screen.calls.played, ["s7"], "OK plays the focused source of the filter");
  screen.onKeyDown(key("Enter", { repeat: true }));
  assert.equal(screen.calls.played.length, 1, "a held OK does not start it again");
  screen.onKeyDown(key("Escape"));
  assert.equal(screen.calls.back, 1, "Back keeps the StreamScreen navigation");
}

{
  // Held Down: repeats closer than 112 ms are dropped.
  const screen = createScreen();
  const now = Date.now;
  let time = 1000;
  Date.now = () => time;
  try {
    screen.onKeyDown(key("ArrowDown", { repeat: true }));
    time += 50;
    screen.onKeyDown(key("ArrowDown", { repeat: true }));
    assert.equal(screen.focusState.row, 1, "the second repeat is throttled");
    time += 120;
    screen.onKeyDown(key("ArrowDown", { repeat: true }));
    assert.equal(screen.focusState.row, 2);
  } finally {
    Date.now = now;
  }
}

{
  // Arriving sources: the focused source keeps its focus once the user moved...
  const screen = createScreen();
  screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("ArrowDown"));
  const early = [
    { id: "early", addonName: "A", addonOrderIndex: 0, url: "https://example.invalid/early" }
  ];
  screen.streams = [...early, ...streams];
  screen.render();
  assert.equal(
    screen.calls.updates.at(-1).items[screen.focusState.row].id,
    "s2",
    "the focus follows the source key"
  );
  // ...while the initial first result is replaced by a better-ranked one.
  const fresh = createScreen();
  fresh.streams = [...early, ...streams];
  fresh.render();
  assert.equal(fresh.focusState.row, 0, "the first result is held while the user has not moved");
  assert.equal(fresh.calls.updates.at(-1).items[0].id, "early");
  // A row set by the inherited search code (end of search, preferredStreamId) is kept, as in
  // StreamScreen: the row indexes the rendered list, not the last row the view focused.
  const preferred = createScreen();
  preferred.focusState = { zone: "card", index: 7, row: 7, action: "play" };
  preferred.render();
  assert.equal(preferred.focusState.row, 7, "the row chosen by the search code is not replaced");
  preferred.streams = [...early, ...streams];
  preferred.streamUserMovedFocus = true;
  preferred.render();
  assert.equal(
    preferred.calls.updates.at(-1).items[preferred.focusState.row].id,
    "s7",
    "and then follows its source key"
  );
}

{
  // A selected filter whose chip disappeared falls back to All.
  const screen = createScreen({ addonFilter: "Gone" });
  assert.equal(screen.addonFilter, "all");
  assert.deepEqual(lastFocus(screen), { zone: "card", row: 0, index: 0, action: "play" });
  // No sources: loading while an addon loads, then the message; the focus stays on the chips.
  const empty = createScreen({ streams: [], focusState: { zone: "card", row: 3 } });
  assert.equal(empty.calls.updates[0].loading, true);
  assert.deepEqual(lastFocus(empty), { zone: "filter", index: 1 });
  empty.sourceChips = [{ name: "A", status: "error" }];
  empty.error = "Boom";
  empty.render();
  assert.equal(empty.calls.updates.at(-1).loading, false);
  assert.equal(empty.calls.updates.at(-1).message, "Boom");
}

console.log("PASS: new Sources screen geometry, view memo, keys, arrival focus and states.");
