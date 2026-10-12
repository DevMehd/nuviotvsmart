// Cache numeric coordinates only while the row has stable collapsed geometry.
// Keep warmup bounded even for very large collection rows.
const WINDOW_SIZE = 24;

export function invalidateVidaaHomeTrackGeometry(screen, track) {
  if (track) screen.homeVidaaTrackGeometry?.delete(track);
}

// Parking changes the subtree, but normally preserves the card's flex slot.
// Verify only changed slots on the next measurement frame instead of throwing
// away all nearby coordinates. Never add these reads to the key-input fast path.
export function markVidaaHomeTrackSlotChanged(screen, track, card, width) {
  const record = screen.homeVidaaTrackGeometry?.get(track);
  if (!record) return;
  if (!Number.isFinite(width) || width <= 0) {
    invalidateVidaaHomeTrackGeometry(screen, track);
    return;
  }
  const dirty = record.dirtySlots || (record.dirtySlots = new Map());
  dirty.set(card, width);
  if (dirty.size > WINDOW_SIZE) invalidateVidaaHomeTrackGeometry(screen, track);
}

export function getVidaaHomeTrackTarget(
  screen,
  track,
  target,
  leftPadding,
  { onlyCached = false, layoutAdjustment = 0 } = {}
) {
  if (!track || !target || screen.expandedPosterNode?.classList?.contains("is-expanded"))
    return null;
  const rowIndex = Number.parseInt(target.dataset?.navRow, 10);
  const nodes = screen.navModel?.rows?.[rowIndex];
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const version = Number(screen.navigationDomVersion || 0);
  const viewportKey = `${globalThis.innerWidth || 0}:${globalThis.innerHeight || 0}`;
  const cache = screen.homeVidaaTrackGeometry || (screen.homeVidaaTrackGeometry = new WeakMap());
  let record = cache.get(track);
  if (
    record?.version !== version ||
    record?.nodes !== nodes ||
    record?.count !== nodes.length ||
    record?.viewportKey !== viewportKey
  )
    record = null;
  if (record?.dirtySlots?.size) {
    if (onlyCached) return null;
    for (const [card, width] of record.dirtySlots) {
      if (
        card.isConnected === false ||
        Math.abs(card.getBoundingClientRect().width - width) > 0.01
      ) {
        record = null;
        break;
      }
    }
    record?.dirtySlots.clear();
  }
  if (!record?.positions.has(target)) {
    if (onlyCached) return null;
    const index = nodes.indexOf(target);
    if (index < 0) return null;
    const from = Math.max(0, Math.min(index - WINDOW_SIZE / 2, nodes.length - WINDOW_SIZE));
    const near = nodes.slice(from, from + WINDOW_SIZE);
    const trackRect = track.getBoundingClientRect();
    const scrollLeft = Number(track.scrollLeft || 0);
    const maxScrollValue = Math.max(
      0,
      Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
    );
    const positions = new Map();
    for (const node of near) {
      if (node.isConnected === false) continue;
      positions.set(node, node.getBoundingClientRect().left - trackRect.left + scrollLeft);
    }
    record = { version, nodes, count: nodes.length, viewportKey, positions, maxScrollValue };
    cache.set(track, record);
  }
  const left = record.positions.get(target);
  if (!Number.isFinite(left)) return null;
  return {
    container: track,
    value: Math.max(
      0,
      Math.min(
        record.maxScrollValue,
        left - Number(leftPadding || 0) - Number(layoutAdjustment || 0)
      )
    ),
    maxScrollValue: record.maxScrollValue
  };
}
