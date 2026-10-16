import {
  cancelVidaaPosterImage,
  cancelVidaaPosterJobs,
  enqueueVidaaPosterJob,
  scheduleVidaaPosterImage
} from "../../components/vidaaPosterScheduler.js";

// Network warming must not retain decoded offscreen posters or obsolete runs.
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
  cancelVidaaPosterImage(image);
  observations.get(image)?.();
}

export function observeVidaaPosterReady(screen, image) {
  if (!image?.addEventListener) return;
  observations.get(image)?.();
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
  record.image.onload = null;
  record.image.onerror = null;
  if (record.image.removeAttribute) record.image.removeAttribute("src");
  else record.image.src = "";
}

export function cancelVidaaHomePosterPrefetches(screen) {
  cancelVidaaPosterJobs(screen);
  screen.homeVidaaPosterPrefetchDesired = null;
}

export function reconcileVidaaHomePosterPrefetches(screen, sources) {
  const desired = new Set(sources.map((source) => String(source || "").trim()).filter(Boolean));
  screen.homeVidaaPosterPrefetchDesired = desired;
  cancelVidaaPosterJobs(screen, {
    keep: (job) => desired.has(job.source) || (job.active && Date.now() - job.startedAt <= 1250)
  });
}

export function hydrateVidaaPosterImage(screen, image, priority = "auto") {
  const source = String(image?.dataset?.src || "").trim();
  if (!source) return false;
  // Do not create a second detached/native request for the same artwork when
  // its real card has entered the viewport.
  cancelVidaaPosterJobs(screen, { keep: (job) => job.key !== source });
  return scheduleVidaaPosterImage(screen, image, {
    priority: priority === "high" ? 0 : priority === "low" ? 2 : 1,
    beforeStart: () => observeVidaaPosterReady(screen, image),
    onCancel: () => observations.get(image)?.(),
    isRelevant: () =>
      image.isConnected !== false &&
      (!screen.homeVidaaPosterPrefetchDesired || screen.homeVidaaPosterPrefetchDesired.has(source))
  });
}

export function prefetchVidaaPosterSource(screen, src) {
  const source = String(src || "").trim();
  if (!source || typeof globalThis.Image !== "function") return false;
  const warmed = screen.homeVidaaPosterWarmUrls || (screen.homeVidaaPosterWarmUrls = new Set());
  if (warmed.has(source)) return true;
  const inflight =
    screen.homeVidaaPosterPrefetchInflight || (screen.homeVidaaPosterPrefetchInflight = new Map());
  if (inflight.has(source)) return true;
  let image;
  try {
    image = new globalThis.Image();
  } catch (_) {
    return false;
  }
  const record = { image, startedAt: 0 };
  inflight.set(source, record);
  enqueueVidaaPosterJob(screen, source, {
    source,
    priority: 2,
    isRelevant: () =>
      !screen.homeVidaaPosterPrefetchDesired || screen.homeVidaaPosterPrefetchDesired.has(source),
    isValid: () => screen.container?.isConnected !== false,
    start(done) {
      record.startedAt = Date.now();
      image.decoding = "async";
      try {
        image.fetchPriority = "low";
      } catch (_) {}
      // load warms the response without forcing decode() offscreen.
      image.onload = () => done(true);
      image.onerror = () => done(false);
      image.src = source;
      if (image.complete && Number(image.naturalWidth || 0) > 0) done(true);
      return () => releasePreload(record);
    },
    onFinish(success) {
      if (inflight.get(source) !== record) return;
      inflight.delete(source);
      if (!success) return;
      if (warmed.has(source)) warmed.delete(source);
      warmed.add(source);
      while (warmed.size > WARM_URL_LIMIT) warmed.delete(warmed.values().next().value);
      recordLatency(screen, Date.now() - record.startedAt);
    }
  });
  return true;
}
