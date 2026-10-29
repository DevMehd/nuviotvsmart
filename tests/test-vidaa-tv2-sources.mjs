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
const { SOURCES_ROW_PITCH, sourcesWindow, rowKeys, rowViewModel, rowBadges, filterNames } = model;

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

// Badges (T4): computed once per stream and settings, nine images at most, then technical chips
// only without an image, then the size; the same order and limits as the current screen.
{
  const settings = { enabled: true, showFileSizeBadges: true, rules: { imports: [] } };
  const pictures = {
    id: "p",
    badges: Array.from({ length: 12 }, (_, index) => ({
      name: `Badge ${index}`,
      imageURL: `https://badges.invalid/${index}.webp`,
      ...(index === 0 ? { tagStyle: "filled", tagColor: "#112233", borderColor: "#445566" } : {})
    })),
    behaviorHints: { videoSize: 2 * 1024 ** 3 }
  };
  const badges = rowBadges(pictures, settings);
  assert.equal(rowBadges(pictures, settings), badges, "cached per stream and settings");
  assert.deepEqual(
    badges.map((badge) => badge.kind),
    [...Array(9).fill("image"), "size"],
    "nine images, then the size"
  );
  assert.equal(badges[0].filled, true);
  assert.match(badges[0].style, /background:#112233;border-color:#445566;/);
  assert.equal(badges[1].style, "", "an outline badge has no inline colour");
  assert.equal(badges[1].url, "https://badges.invalid/1.webp");
  assert.match(badges[9].text, /2(\.0+)? GB/);
  const others = { enabled: true, showFileSizeBadges: false, rules: { imports: [] } };
  assert.notEqual(rowBadges(pictures, others), badges, "other settings recompute the badges");
  assert.ok(
    rowBadges(pictures, others).every((badge) => badge.kind === "image"),
    "no size chip"
  );
  assert.deepEqual(rowBadges(pictures, { ...settings, enabled: false }), [], "badges disabled");

  const plain = {
    id: "t",
    name: "Addon 2160p",
    title: "Film.2160p.HEVC.HDR.Atmos.mkv",
    behaviorHints: { videoSize: 1024 ** 3 }
  };
  const technical = rowBadges(plain, settings);
  assert.ok(technical.length > 1 && technical.at(-1).kind === "size");
  assert.ok(
    technical.slice(0, -1).every((badge) => badge.kind === "technical" && badge.text),
    "technical chips without an image badge"
  );
}
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
  assert.equal(view.badgesFor(streams[0]), view.badgesFor(streams[0]), "row badges are cached");
  assert.equal(
    view.logoFor({ addonName: "A", addonLogo: "https://logo.invalid/a.png" }),
    "https://logo.invalid/a.png"
  );
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

// T3: progressive arrival, chips alone and preferredStreamId.
const early = (id, addon = "A") => ({
  id,
  addonName: addon,
  addonOrderIndex: addon === "A" ? 0 : 1,
  url: `https://example.invalid/${id}`
});
const focusedId = (screen) => screen.calls.updates.at(-1).items[screen.focusState.row]?.id;

{
  // Better-ranked groups before the focused row: the user moved back to row 0, so it is kept.
  const screen = createScreen();
  screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("ArrowUp"));
  screen.streams = [early("e1"), early("e2"), ...streams];
  screen.render();
  assert.equal(focusedId(screen), "s0", "after a user move row 0 follows its source");
  // Without a user move, row 0 shows the best-ranked source.
  const fresh = createScreen();
  fresh.streams = [early("e1"), ...streams];
  fresh.render();
  fresh.streams = [early("e0"), early("e1"), ...streams];
  fresh.render();
  assert.equal(focusedId(fresh), "e0", "the first result is replaced at each arrival");
}

{
  // preferredStreamId is focused as soon as its source arrives, then kept by key.
  const params = { itemId: "tt1", itemType: "movie", preferredStreamId: "late" };
  const screen = createScreen({ params });
  assert.equal(focusedId(screen), "s0", "first result while the preferred source is missing");
  screen.streams = [...streams, early("late", "B")];
  screen.render();
  assert.equal(focusedId(screen), "late", "the preferred source takes the focus when it arrives");
  screen.streams = [early("e1"), ...screen.streams];
  screen.render();
  assert.equal(focusedId(screen), "late", "better-ranked sources do not move it");
  // The preferred source at row 0 is not replaced like a first result.
  const top = createScreen({ params: { ...params, preferredStreamId: "s0" } });
  top.streams = [early("e1"), ...streams];
  top.render();
  assert.equal(focusedId(top), "s0", "a preferred first source is not replaced");
  // Once the user moved, the preferred source no longer takes the focus.
  const moved = createScreen({ params });
  moved.onKeyDown(key("ArrowDown"));
  moved.streams = [...streams, early("late", "B")];
  moved.render();
  assert.equal(focusedId(moved), "s1", "the user's row is kept");
}

{
  // Filter change while sources arrive: the window restarts at the top of the new filter.
  const screen = createScreen();
  for (let i = 0; i < 8; i += 1) screen.onKeyDown(key("ArrowDown"));
  screen.onKeyDown(key("ArrowRight"));
  assert.equal(screen.addonFilter, "A");
  assert.equal(screen.calls.updates.at(-1).resetScroll, true, "the window restarts at 0");
  screen.streams = [early("e1"), ...streams];
  screen.render();
  assert.equal(screen.calls.updates.at(-1).resetScroll, false, "only once");
  assert.equal(focusedId(screen), "s0", "the focused source of the filter is kept");
  // An empty filter while another addon is still loading shows the loading state.
  const empty = createScreen({
    streams: streams.filter((stream) => stream.addonName === "B"),
    sourceChips: [
      { name: "A", status: "success", orderIndex: 0 },
      { name: "B", status: "success", orderIndex: 1 },
      { name: "C", status: "loading", orderIndex: 2 }
    ],
    addonFilter: "A"
  });
  assert.equal(empty.calls.updates.at(-1).items.length, 0);
  assert.equal(empty.calls.updates.at(-1).loading, true, "C may still provide sources");
  empty.sourceChips = empty.sourceChips.map((chip) => ({ ...chip, status: "success" }));
  empty.render();
  assert.equal(empty.calls.updates.at(-1).loading, false, "then the empty message");
}

{
  // The error chip cleanup only updates the chips; the focused chip keeps its addon.
  const screen = createScreen({
    sourceChips: [
      { name: "A", status: "success", orderIndex: 0 },
      { name: "Bad", status: "error", orderIndex: 1 },
      { name: "B", status: "success", orderIndex: 2 },
      { name: "C", status: "loading", orderIndex: 3 }
    ]
  });
  const chipUpdates = [];
  screen.sourcesRenderer.updateChips = (view) => chipUpdates.push(view);
  assert.deepEqual(screen.calls.updates[0].chipKeys, ["all", "A", "B", "Bad", "C"]);
  screen.onKeyDown(key("ArrowUp"));
  for (let i = 0; i < 4; i += 1) screen.onKeyDown(key("ArrowRight"));
  assert.equal(screen.addonFilter, "C");
  assert.deepEqual(lastFocus(screen), { zone: "filter", index: 5 });
  const renders = screen.calls.updates.length;
  screen.sourceChips = screen.sourceChips.filter((chip) => chip.status !== "error");
  assert.equal(screen.refreshSourceChipsOnly(), true);
  assert.equal(screen.calls.updates.length, renders, "no list render");
  assert.deepEqual(chipUpdates.at(-1).chipKeys, ["all", "A", "B", "C"]);
  assert.equal(chipUpdates.at(-1).filter, "C");
  assert.equal(chipUpdates.at(-1).chipStatus("C"), "loading");
  assert.deepEqual(lastFocus(screen), { zone: "filter", index: 4 }, "the focus stays on C");
  // A selected filter whose chip is removed needs the full render (back to All).
  screen.sourceChips = screen.sourceChips.filter((chip) => chip.name !== "C");
  assert.equal(screen.refreshSourceChipsOnly(), false);
  screen.render();
  assert.equal(screen.addonFilter, "all");
}

console.log("PASS: new Sources screen geometry, view memo, keys, arrival focus, chips and states.");
