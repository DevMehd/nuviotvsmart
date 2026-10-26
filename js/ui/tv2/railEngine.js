// Geometry of the new TV Home (nuv-091): computed from preferences, never measured.

/** Card sizes in px, same formulas as buildModernHomeSizingStyle (homeScreenHelpers-01). */
export function cardGeometry(layoutPrefs = {}) {
  const baseWidthDp = Math.max(72, Number(layoutPrefs?.posterCardWidthDp ?? 126) || 126);
  const posterWidth = Math.round(baseWidthDp * 0.84 * 1.08 * 2);
  const landscapeWidth = Math.round(baseWidthDp * 1.24 * 1.34 * 2);
  return {
    poster: { width: posterWidth, height: Math.round(posterWidth * 1.5) },
    landscape: { width: landscapeWidth, height: Math.round(landscapeWidth / 1.77) },
    gap: 24
  };
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
