// Network warming must not retain decoded offscreen posters or obsolete runs.
const MAX_INFLIGHT = 18;
const WARM_URL_LIMIT = 96;
const observations = new WeakMap();
const recoveryAttempts = new WeakMap();

function recordLatency(screen, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 40 || elapsedMs > 4000) return;
  const sample = Math.max(220, Math.min(1400, elapsedMs));
  const previous = Number(screen.homeVidaaPosterReadyEwmaMs || 0);
  screen.homeVidaaPosterReadyEwmaMs = previous > 0 ? previous * 0.72 + sample * 0.28 : sample;
}

export function cancelVidaaPosterObservation(image) {
  observations.get(image)?.();
}

export function observeVidaaPosterReady(screen, image) {
  if (!image?.addEventListener) return;
  cancelVidaaPosterObservation(image);
  const startedAt = Date.now();
  const source = String(image.dataset?.src || image.getAttribute?.("src") || "").trim();
  const originalFallbacks = image.dataset?.fallbackSrcs || "";
  const fallbackSources = new Set(
    originalFallbacks
      .split("|")
      .filter(Boolean)
      .map((value) => {
        try {
          return decodeURIComponent(value);
        } catch (_) {
          return value;
        }
      })
  );
  let observedSource = source;
  const cleanup = () => {
    image.removeEventListener("load", loaded);
    image.removeEventListener("error", failed);
    observations.delete(image);
  };
  const loaded = () => {
    cleanup();
    recoveryAttempts.delete(image);
    image.classList?.remove("placeholder");
    recordLatency(screen, Date.now() - startedAt);
  };
  const failed = () => {
    // Inline/custom error handlers get their normal fallback turn first.
    Promise.resolve().then(() => {
      if (observations.get(image) !== cleanup) return;
      const currentSource = String(image.getAttribute?.("src") || "").trim();
      if (currentSource && currentSource !== observedSource) {
        if (fallbackSources.has(currentSource)) {
          observedSource = currentSource;
          return;
        }
        cleanup();
        return;
      }
      cleanup();
      if (!source || image.isConnected === false || !image.dataset || image.dataset.src) return;
      const previous = recoveryAttempts.get(image);
      if (previous?.source === source) return;
      recoveryAttempts.set(image, { source });
      // One subsequent hydration can retry a transient failure; no timer or
      // repeated navigation can create an unlimited failing request loop.
      image.dataset.src = source;
      if (originalFallbacks) image.dataset.fallbackSrcs = originalFallbacks;
      image.removeAttribute("src");
      image.classList?.add("placeholder");
    });
  };
  observations.set(image, cleanup);
  image.addEventListener("load", loaded);
  image.addEventListener("error", failed);
}

function releasePreload(record) {
  if (record.timeoutId) clearTimeout(record.timeoutId);
  record.timeoutId = 0;
  record.image.onload = null;
  record.image.onerror = null;
  if (record.image.removeAttribute) record.image.removeAttribute("src");
  else record.image.src = "";
}

function cancelRecord(inflight, source, record) {
  inflight.delete(source);
  releasePreload(record);
}

export function cancelVidaaHomePosterPrefetches(screen) {
  const inflight = screen.homeVidaaPosterPrefetchInflight;
  inflight?.forEach((record, source) => cancelRecord(inflight, source, record));
  screen.homeVidaaPosterPrefetchDesired = null;
}

export function reconcileVidaaHomePosterPrefetches(screen, sources) {
  const desired = new Set(sources.map((source) => String(source || "").trim()).filter(Boolean));
  const inflight = screen.homeVidaaPosterPrefetchInflight;
  inflight?.forEach((record, source) => {
    // Let nearby requests finish into the HTTP cache. Replacing every request
    // on each reversal throws away progress and delays posters when returning.
    if (!desired.has(source) && Date.now() - record.startedAt > 1250)
      cancelRecord(inflight, source, record);
  });
  screen.homeVidaaPosterPrefetchDesired = desired;
}

export function prefetchVidaaPosterSource(screen, src) {
  const source = String(src || "").trim();
  if (!source || typeof globalThis.Image !== "function") return false;
  const warmed = screen.homeVidaaPosterWarmUrls || (screen.homeVidaaPosterWarmUrls = new Set());
  if (warmed.has(source)) return true;
  const inflight =
    screen.homeVidaaPosterPrefetchInflight || (screen.homeVidaaPosterPrefetchInflight = new Map());
  if (inflight.has(source)) return true;
  if (inflight.size >= MAX_INFLIGHT) {
    // Reclaim only the slot needed now, preferring an obsolete request with the
    // least progress. The selected run still gets immediate capacity.
    const obsolete = [...inflight].filter(
      ([url]) => !screen.homeVidaaPosterPrefetchDesired?.has(url)
    );
    obsolete.sort((a, b) => b[1].startedAt - a[1].startedAt);
    if (!obsolete.length) return false;
    cancelRecord(inflight, obsolete[0][0], obsolete[0][1]);
  }
  let image;
  try {
    image = new globalThis.Image();
  } catch (_) {
    return false;
  }
  const record = { image, timeoutId: 0, startedAt: Date.now() };
  const finish = (success) => {
    if (inflight.get(source) !== record) return;
    cancelRecord(inflight, source, record);
    if (!success) return;
    if (warmed.has(source)) warmed.delete(source);
    warmed.add(source);
    while (warmed.size > WARM_URL_LIMIT) warmed.delete(warmed.values().next().value);
    recordLatency(screen, Date.now() - record.startedAt);
  };
  image.decoding = "async";
  try {
    image.fetchPriority = "low";
  } catch (_) {}
  // load warms the response without forcing decode() for invisible artwork.
  image.onload = () => finish(true);
  image.onerror = () => finish(false);
  inflight.set(source, record);
  record.timeoutId = setTimeout(() => finish(false), 5000);
  image.src = source;
  return true;
}
