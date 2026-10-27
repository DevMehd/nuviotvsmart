// Focus of the new TV Home (nuv-091): which row, and the column remembered per row.

export function createFocus() {
  return { row: 0, columns: {} };
}

export function focusedIndex(focus, rows) {
  const row = rows[focus.row];
  if (!row) return 0;
  return Math.max(0, Math.min(Number(focus.columns[row.key] || 0), row.items.length - 1));
}

/** Next focus for an arrow; null when the move leaves the rails (left edge → sidebar). */
export function moveFocus(focus, rows, direction) {
  const row = rows[focus.row];
  if (!row) return null;
  const index = focusedIndex(focus, rows);
  if (direction === "left") {
    if (index === 0) return null;
    return { ...focus, columns: { ...focus.columns, [row.key]: index - 1 } };
  }
  if (direction === "right") {
    if (index >= row.items.length - 1) return focus;
    return { ...focus, columns: { ...focus.columns, [row.key]: index + 1 } };
  }
  const step = direction === "down" ? 1 : -1;
  let next = focus.row + step;
  while (rows[next] && !rows[next].items.length) next += step;
  if (!rows[next]) return focus;
  // Grid lines of one layout share their columns: Up/Down keeps the column (current Home grid
  // D-pad picks the card above or below).
  if (row.gridLine !== undefined && rows[next].gridLine !== undefined) {
    const column = Math.min(index, rows[next].items.length - 1);
    return { ...focus, row: next, columns: { ...focus.columns, [rows[next].key]: column } };
  }
  return { ...focus, row: next };
}

/**
 * Title identity of a card; Continue Watching entries of one title also differ by episode
 * (current Home getHomeFocusIdentity). A plain title keeps its bare id.
 */
export function itemIdentity(item) {
  if (!item?.id) return "";
  return [item.id, item.videoId, item.season, item.episode]
    .map((value) => String(value ?? ""))
    .join("|")
    .replace(/\|+$/, "");
}

export function focusSnapshot(focus, rows) {
  const row = rows[focus.row];
  if (!row) return null;
  const index = focusedIndex(focus, rows);
  return { rowKey: row.key, index, identity: itemIdentity(row.items[index]) };
}

/** Focus back on the same title after a return, else the same row and column. */
export function restoreFocus(snapshot, rows) {
  const focus = createFocus();
  if (!snapshot) return focus;
  const rowIndex = rows.findIndex((row) => row.key === snapshot.rowKey);
  if (rowIndex < 0) return focus;
  const items = rows[rowIndex].items;
  const byIdentity = snapshot.identity
    ? items.findIndex((item) => itemIdentity(item) === snapshot.identity)
    : -1;
  focus.row = rowIndex;
  focus.columns[snapshot.rowKey] = byIdentity >= 0 ? byIdentity : Number(snapshot.index || 0);
  return focus;
}
