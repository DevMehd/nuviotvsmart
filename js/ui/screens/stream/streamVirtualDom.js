// Preserve decoded badge images, event listeners and focus in the overlapping
// portion of a source window. A measurement-only update must not parse cards.
export function reconcileStreamVirtualRows(
  windowNode,
  records,
  streams,
  keys,
  start,
  end,
  renderRow
) {
  const existing = new Map(
    Array.from(windowNode.children, (node) => [node.dataset.streamKey, node])
  );
  const nextRecords = new Map();
  const desired = [];
  let changed = false;
  for (let index = start; index <= end; index++) {
    const key = keys[index];
    const previous = records?.get(key);
    let row = existing.get(key);
    if (!row || previous?.stream !== streams[index] || previous?.index !== index) {
      const template = windowNode.ownerDocument.createElement("template");
      template.innerHTML = renderRow(index);
      row = template.content.firstElementChild;
    }
    desired.push(row);
    nextRecords.set(key, { stream: streams[index], index });
  }
  const retained = new Set(desired);
  // Snapshot first: removing from the live children collection skips siblings.
  for (const row of Array.from(windowNode.children)) {
    if (!retained.has(row)) {
      row.remove();
      changed = true;
    }
  }
  let cursor = windowNode.firstElementChild;
  for (const row of desired) {
    if (row !== cursor) {
      windowNode.insertBefore(row, cursor);
      changed = true;
    } else cursor = cursor.nextElementSibling;
  }
  return { records: nextRecords, changed };
}
