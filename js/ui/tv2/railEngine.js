// Geometry of the new TV Home (nuv-091): computed from preferences, never measured.

/** Card sizes in px, same formulas as buildModernHomeSizingStyle (homeScreenHelpers-01). */
export function cardGeometry(layoutPrefs = {}) {
  const baseWidthDp = Math.max(72, Number(layoutPrefs?.posterCardWidthDp ?? 126) || 126);
  const radiusDp = Math.max(0, Number(layoutPrefs?.posterCardCornerRadiusDp ?? 12) || 12);
  const landscapeWidth = Math.round(baseWidthDp * 1.24 * 1.34 * 2);
  return {
    poster: {
      width: Math.round(baseWidthDp * 0.84 * 1.08 * 2),
      height: Math.round(baseWidthDp * 1.5 * 0.84 * 1.08 * 2)
    },
    landscape: { width: landscapeWidth, height: Math.round(landscapeWidth / 1.77) },
    // Modern Continue Watching cards are fixed (components-16.css), whatever posterCardWidthDp.
    continueCard: { width: 419, height: 236 },
    // "wide" renders at the card size on TV (min/max-width win, components-29.css).
    continuePosterStyle: layoutPrefs?.continueWatchingCardStyle === "poster",
    gap: 24,
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
 * Items drawn in a rail and the track offset that keeps the focus visible.
 * `first` is the leftmost fully visible item; `margin` items are pre-drawn on each side.
 */
export function railWindow({ count, focusIndex, pitch, viewport, margin = 2 }) {
  const visible = Math.max(1, Math.floor(viewport / pitch));
  const focus = Math.max(0, Math.min(focusIndex, count - 1));
  const first = Math.max(0, Math.min(focus - 1, count - visible));
  return {
    start: Math.max(0, first - margin),
    end: Math.min(count, first + visible + margin),
    offset: -first * pitch,
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

export const ROW_TITLE_HEIGHT = 56;
export const RAIL_VIEWPORT = 1920 - 220;

/** Window and position of every rail, shared by the DOM and WebGL layers so they move together. */
export function homeLayout(rows, focus, geometry) {
  const heights = [];
  let top = 0;
  const placed = rows.map((row) => {
    const size = rowCardSize(row, geometry);
    const pitch = size.width + geometry.gap;
    const win = railWindow({
      count: row.items.length,
      focusIndex: Number(focus.columns[row.key] || 0),
      pitch,
      viewport: RAIL_VIEWPORT
    });
    const height = size.height + ROW_TITLE_HEIGHT + geometry.gap;
    heights.push(height);
    const entry = { row, size, pitch, win, top, height };
    top += height;
    return entry;
  });
  return { rows: placed, offsetY: rowsOffset(heights, focus.row) };
}
