// A finite row clamps the camera before its last cards can reach the usual
// left-hand focus position. Appending a page must not suddenly unlock a large
// realignment on the very next arrow. Keep that row's visible focus inset.
const appendInsets = new WeakMap();

export function captureVidaaHomeTrackAppendInset(screen, track) {
  const focused = screen.getCurrentFocusedNode?.();
  if (!focused?.isConnected || focused.closest?.(".home-track") !== track) return;
  const maxScroll = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
  let leftPad = Number.parseFloat(track.dataset?.trackPadAlignLeft || "");
  let rightPad = Number.parseFloat(track.dataset?.trackPadRight || "");
  if (!Number.isFinite(leftPad) || !Number.isFinite(rightPad)) {
    const styles = globalThis.getComputedStyle?.(track);
    if (!Number.isFinite(leftPad))
      leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
    if (!Number.isFinite(rightPad))
      rightPad = Math.max(0, Number.parseFloat(styles?.paddingRight || "0") || 0);
  }
  // A painted preview/border can leave a little scrollable tail inside the
  // row's trailing padding even though the last card is already at the edge.
  // Permit that padding, while leaving ordinary navigation away from the end
  // and already left-aligned focus on its original camera path.
  if (maxScroll - Number(track.scrollLeft || 0) > rightPad + 1) return;
  const inset = focused.getBoundingClientRect().left - track.getBoundingClientRect().left - leftPad;
  if (inset > Math.max(1, Number(track.clientLeft || 0))) appendInsets.set(track, inset);
}

export function getVidaaHomeTrackCameraTarget(track, targetLeft, leftPad, maxScroll) {
  const base = Math.max(0, targetLeft - leftPad);
  let inset = appendInsets.get(track) || 0;
  if (base < inset) {
    // Returning to the start naturally restores the ordinary focus position.
    inset = base;
    if (inset > 1) appendInsets.set(track, inset);
    else appendInsets.delete(track);
  }
  return Math.max(0, Math.min(maxScroll, base - inset));
}
