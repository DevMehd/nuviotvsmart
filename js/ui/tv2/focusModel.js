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
  return rows[next] ? { ...focus, row: next } : focus;
}

export function focusSnapshot(focus, rows) {
  const row = rows[focus.row];
  if (!row) return null;
  const index = focusedIndex(focus, rows);
  return { rowKey: row.key, index, identity: String(row.items[index]?.id || "") };
}

/** Focus back on the same title after a return, else the same row and column. */
export function restoreFocus(snapshot, rows) {
  const focus = createFocus();
  if (!snapshot) return focus;
  const rowIndex = rows.findIndex((row) => row.key === snapshot.rowKey);
  if (rowIndex < 0) return focus;
  const items = rows[rowIndex].items;
  const byIdentity = snapshot.identity
    ? items.findIndex((item) => String(item?.id || "") === snapshot.identity)
    : -1;
  focus.row = rowIndex;
  focus.columns[snapshot.rowKey] = byIdentity >= 0 ? byIdentity : Number(snapshot.index || 0);
  return focus;
}
