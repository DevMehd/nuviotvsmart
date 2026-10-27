import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C11): modern, classic and grid layouts from fixed tables, never measured.
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { cardGeometry, homeLayout, slotFor, trackCamera, buildLayoutRows } =
  await import("../js/ui/tv2/railEngine.js");
const { createFocus, moveFocus, focusedIndex } = await import("../js/ui/tv2/focusModel.js");
const { legacyRowPlan, gridVisibleCount } =
  await import("../js/ui/screens/home/homeCatalogPage.js");

// Geometry table (components-14/15.css): classic and grid ignore posterCardWidthDp.
assert.deepEqual(cardGeometry({}, "classic").poster, { width: 228, height: 342 });
assert.deepEqual(cardGeometry({ posterCardWidthDp: 90 }, "classic").poster, {
  width: 228,
  height: 342
});
assert.deepEqual(cardGeometry({}, "classic").continueCard, { width: 432, height: 243 });
assert.deepEqual(cardGeometry({}, "grid").continueCard, { width: 330, height: 186 });
assert.equal(cardGeometry({}, "grid").gridColumns, 7, "floor((1728 + 12) / 244)");
assert.equal(cardGeometry({}, "grid").poster.width, 236);
assert.equal(cardGeometry({}, "modern").poster.width, 229, "modern keeps the dp formulas");
assert.equal(cardGeometry({ homeLayout: "grid" }).layoutMode, "grid", "mode from the prefs");
assert.equal(cardGeometry({}, "classic").labelHeight, 49, "fixed label block under the cards");
assert.equal(cardGeometry({ posterLabelsEnabled: false }, "classic").labelHeight, 0);
assert.equal(cardGeometry({}, "modern").labelHeight, 0, "modern cards show no title (D2)");

// Old Home row rules, shared with renderLegacyCatalogRowsMarkup.
const rowData = (count, hasMore = false, extra = {}) => ({
  addonName: "Addon",
  result: {
    status: "success",
    data: { items: Array.from({ length: count }, (_, i) => ({ id: `m${i}` })), hasMore }
  },
  ...extra
});
const options = { rowItemLimit: 10, gridMaxDisplayItems: 10, showCatalogAddonName: true };
assert.deepEqual(legacyRowPlan(rowData(14), { ...options, layoutMode: "classic" }), {
  subtitle: "from Addon",
  maxItems: 10,
  hasSeeAll: false,
  gridLimit: 10,
  visibleCount: 10
});
assert.equal(legacyRowPlan(rowData(15), { ...options, layoutMode: "classic" }).hasSeeAll, true);
assert.equal(
  legacyRowPlan(rowData(3, true), { ...options, layoutMode: "classic" }).hasSeeAll,
  true
);
assert.equal(legacyRowPlan(rowData(10), { ...options, layoutMode: "grid" }).hasSeeAll, false);
assert.deepEqual(legacyRowPlan(rowData(11), { ...options, layoutMode: "grid" }), {
  subtitle: "",
  maxItems: 10,
  hasSeeAll: true,
  gridLimit: 9,
  visibleCount: 9
});
assert.equal(
  legacyRowPlan(rowData(30, true, { rowKind: "collection" }), { ...options, layoutMode: "grid" })
    .visibleCount,
  Infinity,
  "folders are never cut"
);
assert.equal(
  legacyRowPlan(rowData(3), { ...options, layoutMode: "classic", showCatalogAddonName: false })
    .subtitle,
  ""
);

// Grid trimming (normalizeHomeGridCatalogSections): See All never alone on the last line.
for (const [input, expected] of [
  [{ contentCount: 9, hasSeeAll: true, columnCount: 7, rowCount: 3, maxDisplayItems: 10 }, 9],
  [{ contentCount: 23, hasSeeAll: true, columnCount: 7, rowCount: 3, maxDisplayItems: 24 }, 20],
  [{ contentCount: 7, hasSeeAll: true, columnCount: 7, rowCount: 3, maxDisplayItems: 24 }, 6],
  [{ contentCount: 30, hasSeeAll: false, columnCount: 7, rowCount: 2, maxDisplayItems: 24 }, 14],
  [{ contentCount: 3, hasSeeAll: false, columnCount: 7, rowCount: 3, maxDisplayItems: 24 }, 3]
])
  assert.equal(gridVisibleCount(input), expected, JSON.stringify(input));

// Rows per layout.
const items = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, type: "movie" }));
const catalog = (key, count, hasMore = false) => {
  const rowItems = items(key, count);
  return {
    key,
    kind: "poster",
    title: key.toUpperCase(),
    items: rowItems,
    status: "success",
    hasMore,
    entry: {
      addonName: "Addon",
      catalogId: key,
      type: "movie",
      result: { status: "success", data: { items: rowItems, hasMore } }
    }
  };
};
const model = [
  { key: "continue_watching", kind: "continue", title: "CW", items: items("cw", 12) },
  catalog("top", 30, true),
  catalog("short", 4),
  {
    key: "collection_c",
    kind: "collection",
    title: "C",
    items: items("f", 20),
    entry: { rowKind: "collection" }
  },
  { key: "perso", kind: "poster", title: "Pour toi", items: items("p", 20) }
];
const vidaaCaps = { itemLimit: 10, gridMaxItems: 10, gridRowCount: 3 };
const classicGeometry = cardGeometry({}, "classic");
assert.equal(
  buildLayoutRows(model, { geometry: cardGeometry({}, "modern"), heroEnabled: true, ...vidaaCaps }),
  model,
  "modern keeps the model rows (pagination patches them in place)"
);
const classic = buildLayoutRows(model, {
  geometry: classicGeometry,
  heroEnabled: true,
  showAddonName: true,
  ...vidaaCaps
});
assert.deepEqual(
  classic.map((row) => `${row.key}:${row.items.length}`),
  ["__hero__:1", "continue_watching:12", "top:11", "short:4", "collection_c:20", "perso:20"]
);
assert.equal(classic[0].kind, "hero");
assert.equal(classic[2].items.at(-1).seeAll, true, "See All after the 10 capped items (D4)");
assert.equal(classic[2].subtitle, "from Addon");
assert.ok(!classic[3].items.some((item) => item.seeAll), "4 items, no more pages: no See All");
assert.equal(
  buildLayoutRows(model, { geometry: classicGeometry, heroEnabled: false, ...vidaaCaps })[0].key,
  "continue_watching",
  "heroSectionEnabled off: no hero row"
);
const grid = buildLayoutRows(model, {
  geometry: cardGeometry({}, "grid"),
  heroEnabled: true,
  ...vidaaCaps
});
assert.deepEqual(
  grid.map((row) => `${row.key}:${row.items.length}:${row.title}`),
  [
    "__hero__:1:",
    "continue_watching:12:CW",
    "top#0:7:TOP",
    "top#1:3:",
    "short#0:4:SHORT",
    "collection_c:20:C",
    "perso#0:7:Pour toi",
    "perso#1:7:",
    "perso#2:6:"
  ]
);
assert.equal(grid[3].items.at(-1).seeAll, true, "See All closes the section");

// Every layout: bounded pool, no slot collision, focused card inside the rail viewport.
for (const mode of ["modern", "classic", "grid"]) {
  const geometry = cardGeometry({}, mode);
  const rows = buildLayoutRows(model, { geometry, heroEnabled: true, ...vidaaCaps });
  rows.forEach((row, rowIndex) => {
    if (row.kind === "hero") return;
    for (let column = 0; column < row.items.length; column += 1) {
      let focus = { ...createFocus(), row: rowIndex, columns: { [row.key]: column } };
      focus = trackCamera(focus, rows, geometry);
      const placed = homeLayout(rows, focus, geometry).rows[rowIndex];
      const { win, pitch, size } = placed;
      assert.ok(win.end - win.start <= win.poolSize, `${mode} ${row.key} pool`);
      const slots = new Set();
      for (let i = win.start; i < win.end; i += 1) slots.add(slotFor(i, win.poolSize));
      assert.equal(slots.size, win.end - win.start, `${mode} ${row.key} slots`);
      const left = win.offset + column * pitch;
      assert.ok(left >= 0, `${mode} ${row.key}#${column} left edge`);
      assert.ok(left + size.width <= geometry.viewport, `${mode} ${row.key}#${column} right edge`);
    }
  });
}

// Modern camera: focused card left-aligned, the end clamped; focused row 40 px under the top.
{
  const geometry = cardGeometry({}, "modern");
  const rows = [catalog("a", 30), catalog("b", 30), catalog("c", 30)];
  const at = (row, column) =>
    homeLayout(rows, { row, columns: { [rows[row].key]: column } }, geometry);
  assert.equal(at(0, 5).rows[0].win.offset, -5 * at(0, 5).rows[0].pitch);
  const end = at(0, 29).rows[0];
  assert.equal(end.win.offset, -(30 - Math.floor(geometry.viewport / end.pitch)) * end.pitch);
  assert.equal(at(0, 0).offsetY, 0);
  assert.equal(at(1, 0).offsetY, -(at(1, 0).rows[1].top - 40));
}

// Classic camera: minimal scrolling; the row stays put while the focus is visible.
{
  const geometry = classicGeometry;
  const rows = buildLayoutRows([catalog("a", 24), catalog("b", 24), catalog("c", 24)], {
    geometry,
    heroEnabled: true,
    itemLimit: 24,
    gridMaxItems: 24,
    gridRowCount: 3
  });
  let focus = trackCamera({ ...createFocus(), row: 1 }, rows, geometry);
  const offsets = [];
  for (let step = 0; step < 10; step += 1) {
    focus = trackCamera(moveFocus(focus, rows, "right"), rows, geometry);
    offsets.push(homeLayout(rows, focus, geometry).rows[1].win.offset);
  }
  assert.equal(offsets[0], 0, "a visible card does not move the rail");
  assert.ok(offsets.at(-1) < 0, "the rail follows once the focus leaves it");
  assert.equal(homeLayout(rows, focus, geometry).offsetY, 0, "hero and first row stay on screen");
  focus = trackCamera(moveFocus(moveFocus(focus, rows, "down"), rows, "down"), rows, geometry);
  assert.ok(homeLayout(rows, focus, geometry).offsetY < 0, "lower rows scroll into view");
}

// Grid lines: Up/Down keeps the column, the last line clamps it.
{
  const geometry = cardGeometry({}, "grid");
  const rows = buildLayoutRows([catalog("a", 30, true)], {
    geometry,
    heroEnabled: false,
    itemLimit: 10,
    gridMaxItems: 24,
    gridRowCount: 3
  });
  assert.deepEqual(
    rows.map((row) => row.items.length),
    [7, 7, 7]
  );
  let focus = { ...createFocus(), columns: { "a#0": 5 } };
  focus = moveFocus(focus, rows, "down");
  assert.equal(focus.row, 1);
  assert.equal(focusedIndex(focus, rows), 5, "same column on the next line");
  const short = buildLayoutRows([catalog("b", 9)], {
    geometry,
    heroEnabled: false,
    itemLimit: 10,
    gridMaxItems: 24,
    gridRowCount: 3
  });
  focus = moveFocus({ ...createFocus(), columns: { "b#0": 6 } }, short, "down");
  assert.equal(focusedIndex(focus, short), 1, "clamped to the shorter last line");
}

console.log("PASS: new TV Home layouts (modern, classic, grid)");
