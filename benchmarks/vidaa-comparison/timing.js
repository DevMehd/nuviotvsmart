// A shared rAF timeline timestamp is not the callback execution time.
export function nextFrameSample({
  raf = requestAnimationFrame,
  now = () => performance.now()
} = {}) {
  return new Promise((resolve) =>
    raf((frameTimestamp) => resolve({ frameTimestamp, callbackTime: now() }))
  );
}
export function clockQuantum(now = () => performance.now()) {
  let previous = now(),
    minimum = Infinity;
  for (let i = 0; i < 4096; i++) {
    const current = now(),
      delta = current - previous;
    if (delta > 0) minimum = Math.min(minimum, delta);
    previous = current;
  }
  return Number.isFinite(minimum) ? minimum : null;
}
