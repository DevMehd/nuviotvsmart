import { ProfileManager } from "../profile/profileManager.js";

const HOSTS = new Set(["xperience-app.com", "aiostreams.fortheweak.cloud"]);
let cooldownUntil = 0;

export function shouldUseAddonDataService(url) {
  if (globalThis.__NUVIO_ADDON_DATA_SERVICE__ !== true || Date.now() < cooldownUntil) return false;
  try {
    return HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Race a slow server with the existing direct path. A cache hit avoids the
// duplicate entirely; a cold instance cannot impose its full timeout on TV.
export function requestAddonData(url, kind, options, direct) {
  if (!shouldUseAddonDataService(url) || typeof AbortController !== "function")
    return direct(options);
  const serverController = new AbortController();
  const directController = new AbortController();
  return new Promise((resolve, reject) => {
    let done = false;
    let directStarted = false;
    let serverFinished = false;
    let directError = null;
    let timer;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abort);
      serverController.abort();
      directController.abort();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      finish(error);
    };
    const startDirect = () => {
      if (done || directStarted) return;
      directStarted = true;
      Promise.resolve()
        .then(() => direct({ ...options, signal: directController.signal }))
        .then(
          (data) => finish(null, data),
          (error) => {
            directError = error;
            if (serverFinished) finish(error);
          }
        );
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener?.("abort", abort, { once: true });
    timer = setTimeout(startDirect, 700);
    fetchPreparedAddonData(url, kind, { signal: serverController.signal }).then(
      (data) => {
        serverFinished = true;
        if (data) finish(null, data);
        else if (directError) finish(directError);
        else startDirect();
      },
      (error) => {
        serverFinished = true;
        if (done) return;
        if (options.signal?.aborted) finish(error);
        else if (directError) finish(directError);
        else startDirect();
      }
    );
  });
}

export async function fetchPreparedAddonData(url, kind, { signal = null } = {}) {
  if (!shouldUseAddonDataService(url) || signal?.aborted) return null;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (!controller) return null;
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimeout(abort, 5500);
  try {
    const response = await fetch("/api/addon-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ url, kind, profile: ProfileManager.getActiveProfileId() }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("addon_service_unavailable");
    const data = await response.json();
    if (kind === "catalog" ? !Array.isArray(data?.metas) : !data?.meta)
      throw new Error("invalid_payload");
    return data;
  } catch {
    if (signal?.aborted) {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      throw error;
    }
    // A failed/cold/unavailable service must not penalize each subsequent row.
    cooldownUntil = Date.now() + 60000;
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}
