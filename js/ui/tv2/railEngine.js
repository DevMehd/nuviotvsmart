// Geometry of the new TV Home (nuv-091): computed from preferences, never measured.

import { HOME_LAYOUT_SEQUENCE } from "../screens/home/homeConstants.js";
import { gridVisibleCount, legacyRowPlan } from "../screens/home/homeCatalogPage.js";

export const ROW_TITLE_HEIGHT = 56;
export const RAIL_VIEWPORT = 1920 - 220;
// Classic/grid focusable hero row: the current Home's 400 px hero card plus its margin.
const HERO_CARD_HEIGHT = 400;
export const HERO_ROW_HEIGHT = HERO_CARD_HEIGHT + 32;
// Classic title block under a card: 10 padding + 20 title + 4 + 15 subtitle (components-15.css).
const CLASSIC_LABEL_HEIGHT = 49;
// Classic "from {addon}" line under the row title (components-15.css .home-row-subtitle).
const ROW_SUBTITLE_HEIGHT = 20;
const SCREEN_HEIGHT = 1080;
// Modern rows viewport under the hero (.tv2-main top in tv2-home.css).
const MODERN_ROWS_TOP = 560;

/** Classic and grid: fixed CSS sizes, focusable hero row, See All, minimal scrolling. */
export const isLegacyLayout = (mode) => mode === "classic" || mode === "grid";

/** Home layout of the preferences: modern, grid or classic (current Home, "classic" if unknown). */
export function homeLayoutMode(layoutPrefs = {}) {
  const mode = String(layoutPrefs?.homeLayout || "classic").toLowerCase();
  return HOME_LAYOUT_SEQUENCE.includes(mode) ? mode : "classic";
}

/**
 * Card sizes and spacing in px per layout, never measured. Modern: same formulas as
 * buildModernHomeSizingStyle (homeScreenHelpers-01). Classic and grid: the current Home's fixed
 * CSS sizes (components-14/15.css), with a fixed label block under catalog cards. The modern
 * sidebar pill floats over the content: like the current Home (components-08.css drops
 * .home-main's 144 px rail margin), the content then starts at the layout's own inset.
 */
export function cardGeometry(layoutPrefs = {}, layoutMode = layoutPrefs?.homeLayout || "modern") {
  const baseWidthDp = Math.max(72, Number(layoutPrefs?.posterCardWidthDp ?? 126) || 126);
  const radiusDp = Math.max(0, Number(layoutPrefs?.posterCardCornerRadiusDp ?? 12) || 12);
  const landscapeWidth = Math.round(baseWidthDp * 1.24 * 1.34 * 2);
  const mode = String(layoutMode).toLowerCase();
  const rail = layoutPrefs?.modernSidebar ? 0 : 144;
  // Modern: 104 px inset of the current Home with the pill (components-16.css); 220 with the rail.
  const modernStart = rail ? 220 : 104;
  const shared = {
    layoutMode: "modern",
    landscape: { width: landscapeWidth, height: Math.round(landscapeWidth / 1.77) },
    // "wide" renders at the card size on TV (min/max-width win, components-29.css).
    continuePosterStyle: layoutPrefs?.continueWatchingCardStyle === "poster",
    contentStart: modernStart,
    viewport: 1920 - modernStart,
    labelHeight: 0,
    gridColumns: 0
  };
  // Titles under classic/grid catalog cards (posterLabelsEnabled).
  const labels = layoutPrefs?.posterLabelsEnabled !== false;
  if (mode === "classic")
    return {
      ...shared,
      layoutMode: "classic",
      poster: { width: 228, height: 342 },
      continueCard: { width: 432, height: 243 },
      gap: 16,
      rowGap: 64,
      radius: 24,
      landscapePosters: false,
      contentStart: rail + 48,
      viewport: 1920 - rail - 48,
      labelHeight: labels ? CLASSIC_LABEL_HEIGHT : 0
    };
  if (mode === "grid") {
    // repeat(auto-fill, minmax(232px, 1fr)) with a 12 px column gap over 1920 - rail - 2 * 24.
    const width = 1920 - rail - 48;
    const columns = Math.max(1, Math.floor((width + 12) / (232 + 12)));
    const cardWidth = Math.floor((width - 12 * (columns - 1)) / columns);
    return {
      ...shared,
      layoutMode: "grid",
      poster: { width: cardWidth, height: Math.round(cardWidth * 1.5) },
      continueCard: { width: 330, height: 186 },
      gap: 12,
      rowGap: 16,
      radius: 24,
      landscapePosters: false,
      contentStart: rail + 24,
      viewport: 1920 - rail - 24,
      // Grid shows the title only (buildPosterSubtitle returns "").
      labelHeight: labels ? 30 : 0,
      gridColumns: columns
    };
  }
  return {
    ...shared,
    poster: {
      width: Math.round(baseWidthDp * 0.84 * 1.08 * 2),
      height: Math.round(baseWidthDp * 1.5 * 0.84 * 1.08 * 2)
    },
    // Modern Continue Watching cards are fixed (components-16.css), whatever posterCardWidthDp.
    continueCard: { width: 419, height: 236 },
    gap: 24,
    rowGap: 24,
    radius: Math.round(radiusDp * 2),
    // Current Home render (methods-23): landscape catalog posters are a modern-only preference.
    landscapePosters:
      String(layoutPrefs?.homeLayout || "classic").toLowerCase() === "modern" &&
      Boolean(layoutPrefs?.modernLandscapePostersEnabled)
  };
}

/**
 * Card size of a row: continue cards follow their card style, landscape posters are landscape; collection rows follow
 * their tile shape (normalizeCollectionPosterShape: POSTER, LANDSCAPE, else SQUARE).
 */
export function rowCardSize(row, geometry) {
  if (row.kind === "continue")
    return geometry.continuePosterStyle ? geometry.poster : geometry.continueCard;
  if (row.kind === "collection") {
    const shape = String(row.tileShape || "").toUpperCase();
    if (shape === "POSTER") return geometry.poster;
    if (shape === "LANDSCAPE" || shape === "WIDE") return geometry.landscape;
    return { width: geometry.poster.height, height: geometry.poster.height };
  }
  return geometry.landscapePosters ? geometry.landscape : geometry.poster;
}

/**
 * Items drawn in a rail and the track offset that keeps the focus visible. `first` is the leftmost
 * fully visible item: by default the focused one (modern camera: focused card left-aligned, the end
 * clamped so the last cards fill the rail); classic/grid pass their own (trackCamera). `margin`
 * items are pre-drawn on each side.
 */
export function railWindow({ count, focusIndex, pitch, viewport, margin = 2, first }) {
  const visible = Math.max(1, Math.floor(viewport / pitch));
  const focus = Math.max(0, Math.min(focusIndex, count - 1));
  const left = first ?? Math.max(0, Math.min(focus, count - visible));
  return {
    start: Math.max(0, left - margin),
    end: Math.min(count, left + visible + margin),
    offset: 0 - left * pitch,
    poolSize: visible + 2 * margin
  };
}

/** Pooled node for an item: index modulo pool size, so sliding reuses nodes without creating any. */
export function slotFor(index, poolSize) {
  return ((index % poolSize) + poolSize) % poolSize;
}

/** Vertical offset that keeps the focused row near the top, from fixed row heights. */
export function rowsOffset(rowHeights = [], focusRow = 0) {
  let top = 0;
  for (let i = 0; i < Math.min(focusRow, rowHeights.length); i += 1) top += rowHeights[i];
  return -top;
}

/** Fixed height of a row: header (title, classic subtitle), cards with their labels, row gap. */
export function rowHeight(row, geometry) {
  if (row.kind === "hero") return HERO_ROW_HEIGHT;
  const header = (row.title ? ROW_TITLE_HEIGHT : 0) + (row.subtitle ? ROW_SUBTITLE_HEIGHT : 0);
  return (
    header + rowCardSize(row, geometry).height + rowLabelHeight(row, geometry) + geometry.rowGap
  );
}

/**
 * Classic/grid catalog cards carry their title under the artwork. Classic folder cards too, whatever
 * posterLabelsEnabled, unless every folder hides it; grid overlays folder titles on the cover
 * (createPosterCardMarkup collection branch).
 */
export function rowLabelHeight(row, geometry) {
  if (row.kind === "poster") return geometry.labelHeight;
  return row.kind === "collection" &&
    geometry.layoutMode === "classic" &&
    row.items.some((item) => !item.hideTitle)
    ? CLASSIC_LABEL_HEIGHT
    : 0;
}

const visibleCards = (row, geometry) =>
  Math.max(1, Math.floor(geometry.viewport / (rowCardSize(row, geometry).width + geometry.gap)));

/** Classic/grid minimal scrolling: the rail only moves when the focus leaves it; a restore centres it. */
function minimalFirst(previous, focus, visible, count) {
  let first = previous ?? focus - Math.floor(visible / 2);
  if (focus < first) first = focus;
  else if (focus > first + visible - 1) first = focus - visible + 1;
  return Math.max(0, Math.min(first, count - visible));
}

/**
 * Classic/grid camera state kept in the focus (no DOM): the first visible card of the focused
 * row and the vertical scroll, moved only when the focused row leaves
 * [top + 32 (classic) / 24 (grid), bottom - 24]. Modern needs none: its camera follows the focus.
 */
export function trackCamera(focus, rows, geometry) {
  const row = rows[focus.row];
  if (!isLegacyLayout(geometry.layoutMode) || !row) return focus;
  const firsts = { ...focus.firsts };
  if (row.items.length) {
    const visible = visibleCards(row, geometry);
    const column = Math.max(0, Math.min(Number(focus.columns[row.key] || 0), row.items.length - 1));
    firsts[row.key] = minimalFirst(firsts[row.key], column, visible, row.items.length);
  }
  let top = 0;
  let total = 0;
  rows.forEach((candidate, index) => {
    if (index === focus.row) top = total;
    total += rowHeight(candidate, geometry);
  });
  const bottom = top + rowHeight(row, geometry) - geometry.rowGap;
  const inset = geometry.layoutMode === "grid" ? 24 : 32;
  let scrollY = focus.scrollY ?? 0;
  if (top - scrollY < inset) scrollY = top - inset;
  else if (bottom - scrollY > SCREEN_HEIGHT - 24) scrollY = bottom - SCREEN_HEIGHT + 24;
  scrollY = Math.max(0, Math.min(scrollY, total - SCREEN_HEIGHT));
  return { ...focus, firsts, scrollY };
}

/**
 * Window and position of every rail, shared by the DOM and WebGL layers so they move together.
 * Modern: the focused row 40 px under the rows viewport top, clamped at the end (current Home
 * rowFocusInset). Classic/grid: the trackCamera state.
 */
export function homeLayout(rows, focus, geometry) {
  const modern = !isLegacyLayout(geometry.layoutMode);
  let top = 0;
  let focusTop = 0;
  const placed = rows.map((row, rowIndex) => {
    const size = rowCardSize(row, geometry);
    const pitch = size.width + geometry.gap;
    const column = Number(focus.columns[row.key] || 0);
    const first = modern
      ? undefined
      : (focus.firsts?.[row.key] ??
        minimalFirst(undefined, column, visibleCards(row, geometry), row.items.length));
    const win =
      row.kind === "hero"
        ? { start: 0, end: 0, offset: 0, poolSize: 0 }
        : railWindow({
            count: row.items.length,
            focusIndex: column,
            pitch,
            viewport: geometry.viewport,
            first
          });
    const height = rowHeight(row, geometry);
    if (rowIndex === focus.row) focusTop = top;
    const entry = { row, size, pitch, win, top, height };
    top += height;
    return entry;
  });
  const offsetY = modern
    ? 0 - Math.max(0, Math.min(focusTop - 40, top - (SCREEN_HEIGHT - MODERN_ROWS_TOP)))
    : 0 - (focus.scrollY ?? 0);
  return { rows: placed, offsetY };
}

/**
 * Grid sticky section header (current Home setupGridStickyHeader) from the fixed row tops of
 * homeLayout instead of offsetTop: the title of the last catalog or folder section starting at
 * most 72 px under the scroll, once the hero card is scrolled past by 48 px. "" hides it.
 */
export function gridStickyTitle({ rows, offsetY }) {
  const scrollY = -offsetY;
  let title = "";
  rows.forEach(({ row, top }) => {
    const section = (row.kind === "poster" || row.kind === "collection") && !row.gridLine;
    if (section && top <= scrollY + 72) title = row.title || "";
  });
  const heroShown = rows[0]?.row.kind === "hero" && scrollY <= HERO_CARD_HEIGHT - 48;
  return heroShown ? "" : title;
}

/** Current Home See All card (createSeeAllCardMarkup): the last card of a classic/grid catalog. */
const seeAllItem = (row) => ({ seeAll: true, id: "", type: row.entry?.type || "movie" });

/**
 * Rows as a layout draws and navigates them. Modern: the model rows themselves (pagination
 * patches them in place). Classic/grid: a focusable hero row first (heroSectionEnabled), catalog
 * rows capped (D4) with their See All card (current Home renderLegacyCatalogRowsMarkup); in grid,
 * each catalog becomes up to `gridRowCount` line rows `${key}#${n}` of `gridColumns` cards
 * (normalizeHomeGridCatalogSections), the title on line 0 only. Continue Watching and folders stay rails.
 */
export function buildLayoutRows(
  rows,
  { geometry, heroEnabled, itemLimit, gridMaxItems, gridRowCount, showAddonName = true }
) {
  const mode = geometry.layoutMode;
  if (!isLegacyLayout(mode)) return rows;
  const columns = geometry.gridColumns;
  const laid = heroEnabled
    ? [{ key: "__hero__", kind: "hero", title: "", items: [{ id: "__hero__" }], status: "success" }]
    : [];
  rows.forEach((row) => {
    if (row.kind !== "poster" || !row.items.length) {
      laid.push(row);
      return;
    }
    let items = row.items;
    let subtitle = "";
    if (row.entry) {
      const plan = legacyRowPlan(row.entry, {
        layoutMode: mode,
        rowItemLimit: itemLimit,
        gridMaxDisplayItems: gridMaxItems,
        showCatalogAddonName: showAddonName
      });
      subtitle = plan.subtitle;
      const visible =
        mode === "grid"
          ? gridVisibleCount({
              contentCount: Math.min(items.length, plan.visibleCount),
              hasSeeAll: plan.hasSeeAll,
              columnCount: columns,
              rowCount: gridRowCount,
              maxDisplayItems: gridMaxItems
            })
          : plan.visibleCount;
      items = items.slice(0, visible);
      if (plan.hasSeeAll) items = [...items, seeAllItem(row)];
    }
    if (mode === "classic") {
      laid.push({ ...row, subtitle, items });
      return;
    }
    for (let line = 0; line * columns < items.length; line += 1)
      laid.push({
        ...row,
        key: `${row.key}#${line}`,
        title: line ? "" : row.title,
        items: items.slice(line * columns, (line + 1) * columns),
        gridLine: line
      });
  });
  return laid;
}
