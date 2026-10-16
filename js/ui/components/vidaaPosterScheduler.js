// Home and catalog posters share the same native request/decode budget. A
// per-frame assignment limit alone does not limit work still running on a TV.
export const VIDAA_POSTER_REQUEST_LIMIT = 4;
const STARTS_PER_FRAME = 2;
const FRAME_BUDGET_MS = 4;
const REQUEST_TIMEOUT_MS = 5000;
const jobs = new Set();
const imageJobs = new WeakMap();
let frame = null;
let order = 0;
const counters = {
  started: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  decoded: 0,
  peakActive: 0,
  peakQueued: 0
};

function clock() {
  try {
    const value = globalThis.performance?.now?.();
    if (Number.isFinite(value)) return value;
  } catch (_) {}
  return Date.now();
}

function counts() {
  let active = 0;
  let queued = 0;
  for (const job of jobs) {
    if (job.active) active++;
    else queued++;
  }
  return { active, queued };
}

// Only aggregate numbers are exposed: diagnostics must never retain artwork URLs.
export function getVidaaPosterSchedulerStats() {
  return { limit: VIDAA_POSTER_REQUEST_LIMIT, ...counts(), ...counters };
}

function schedule() {
  if (frame != null || ![...jobs].some((job) => !job.active)) return;
  if (counts().active >= VIDAA_POSTER_REQUEST_LIMIT) return;
  frame = requestAnimationFrame(pump);
}

function finish(job, success, reason = success ? "loaded" : "error") {
  if (!jobs.delete(job)) return;
  if (job.timeout != null) clearTimeout(job.timeout);
  job.timeout = null;
  if (reason === "cancelled") counters.cancelled++;
  else if (success) counters.completed++;
  else counters.failed++;
  job.cleanup?.(reason);
  job.onFinish?.(Boolean(success), reason);
  if (!jobs.size && frame != null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  schedule();
}

function pump() {
  frame = null;
  const startedAt = clock();
  const startedWallAt = Date.now();
  let starts = 0;
  const pending = [...jobs]
    .filter((job) => !job.active)
    .sort((left, right) => left.priority - right.priority || left.order - right.order);
  let scanned = 0;
  for (const job of pending) {
    // Invalidated metadata/DOM must also yield, even when the platform clock
    // stalls. Never spend an entire frame draining a retired catalog.
    if (
      scanned++ >= 8 ||
      (scanned > 1 && Math.max(clock() - startedAt, Date.now() - startedWallAt) >= FRAME_BUDGET_MS)
    )
      break;
    if (!jobs.has(job)) continue;
    if (job.isValid?.() === false) {
      finish(job, false, "cancelled");
      continue;
    }
    if (counts().active >= VIDAA_POSTER_REQUEST_LIMIT || starts >= STARTS_PER_FRAME) break;
    job.active = true;
    job.startedAt = Date.now();
    starts++;
    counters.started++;
    counters.peakActive = Math.max(counters.peakActive, counts().active);
    job.timeout = setTimeout(() => finish(job, false, "timeout"), REQUEST_TIMEOUT_MS);
    try {
      job.cleanup = job.start((success) => finish(job, success));
      // A cached request is permitted to finish synchronously in start().
      if (!jobs.has(job)) job.cleanup?.("loaded");
    } catch (_) {
      finish(job, false);
    }
  }
  schedule();
}

export function cancelVidaaPosterJobs(owner, { queuedOnly = false, keep = null } = {}) {
  for (const job of [...jobs]) {
    if (job.owner !== owner || (queuedOnly && job.active) || keep?.(job)) continue;
    finish(job, false, "cancelled");
  }
  if (!jobs.size && frame != null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

export function cancelVidaaPosterImage(image) {
  const job = imageJobs.get(image);
  if (job) finish(job, false, "cancelled");
}

export function enqueueVidaaPosterJob(owner, key, options) {
  const existing = [...jobs].find((job) => job.owner === owner && job.key === key);
  if (existing) {
    existing.priority = options.priority ?? existing.priority;
    existing.isRelevant = options.isRelevant || existing.isRelevant;
    schedule();
    return existing;
  }
  // A new visible target can reclaim a slot from speculative artwork which
  // has left the current runway. Nearby downloads keep their progress.
  if (
    counts().active >= VIDAA_POSTER_REQUEST_LIMIT &&
    ((options.priority ?? 2) < 2 || ![...jobs].some((job) => !job.active))
  ) {
    const obsolete = [...jobs]
      .filter((job) => job.active && job.priority >= 2 && job.isRelevant?.() === false)
      .sort((a, b) => b.order - a.order)[0];
    if (obsolete) finish(obsolete, false, "cancelled");
  }
  const job = {
    ...options,
    owner,
    key,
    active: false,
    timeout: null,
    cleanup: null,
    order: ++order
  };
  jobs.add(job);
  counters.peakQueued = Math.max(counters.peakQueued, counts().queued);
  schedule();
  return job;
}

export function scheduleVidaaPosterImage(
  owner,
  image,
  { priority = 1, beforeStart = null, onCancel = null, isRelevant = null } = {}
) {
  const source = String(image?.dataset?.src || "").trim();
  if (!source || image.isConnected === false) return false;
  const previous = imageJobs.get(image);
  if (previous && previous.source !== source) finish(previous, false, "cancelled");
  const job = enqueueVidaaPosterJob(owner, image, {
    source,
    priority,
    isRelevant,
    isValid: () =>
      image.isConnected !== false &&
      owner.container?.isConnected !== false &&
      String(image.dataset?.src || "").trim() === source,
    start(done) {
      let observedSource = source;
      let decoding = false;
      const loaded = () => {
        if (decoding || !jobs.has(job)) return;
        decoding = true;
        if (typeof image.decode !== "function") {
          done(true);
          return;
        }
        try {
          const decoded = image.decode();
          counters.decoded++;
          Promise.resolve(decoded).then(
            () => done(true),
            () => done(Number(image.naturalWidth || 0) > 0)
          );
        } catch (_) {
          // Some TV engines expose decode() but do not implement it.
          done(true);
        }
      };
      const failed = () => {
        // Existing inline fallback handlers change src in the error turn.
        // Keep that replacement in this slot until its own completion.
        Promise.resolve().then(() => {
          if (!jobs.has(job)) return;
          const current = String(image.getAttribute?.("src") || image.src || "").trim();
          if (current && current !== observedSource) observedSource = current;
          else done(false);
        });
      };
      const hasEvents = typeof image.addEventListener === "function";
      const previousLoad = image.onload;
      const previousError = image.onerror;
      if (hasEvents) {
        image.addEventListener("load", loaded);
        image.addEventListener("error", failed);
      } else {
        image.onload = loaded;
        image.onerror = failed;
      }
      image.loading = "eager";
      image.decoding = "async";
      try {
        image.fetchPriority = job.priority === 0 ? "high" : job.priority === 1 ? "auto" : "low";
      } catch (_) {}
      beforeStart?.();
      image.removeAttribute("data-src");
      image.src = source;
      if (image.complete && Number(image.naturalWidth || 0) > 0) loaded();
      return (reason) => {
        if (hasEvents) {
          image.removeEventListener("load", loaded);
          image.removeEventListener("error", failed);
        } else {
          image.onload = previousLoad || null;
          image.onerror = previousError || null;
        }
        if (reason === "cancelled" || reason === "timeout") {
          const current = String(image.getAttribute?.("src") || image.src || "").trim();
          if (!image.dataset.src && current) image.dataset.src = current;
          if (current) image.removeAttribute("src");
          onCancel?.();
        }
      };
    },
    onFinish() {
      if (imageJobs.get(image) === job) imageJobs.delete(image);
    }
  });
  imageJobs.set(image, job);
  return true;
}
