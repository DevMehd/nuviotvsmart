import { LocalStore } from "../../core/storage/localStore.js";

// Device-local beta switch for the new TV Home (nuv-091), like tvPerfMode.
const NEW_HOME_KEY = "tvNewHome";
export const NEW_HOME_MODES = Object.freeze(["off", "dom", "webgl"]);

export function getNewHomeMode() {
  try {
    const raw = String(LocalStore.get(NEW_HOME_KEY, "") || "").toLowerCase();
    return NEW_HOME_MODES.includes(raw) ? raw : "off";
  } catch (_) {
    return "off";
  }
}

export function setNewHomeMode(mode) {
  try {
    if (mode !== "off" && NEW_HOME_MODES.includes(mode)) LocalStore.set(NEW_HOME_KEY, mode);
    else LocalStore.remove(NEW_HOME_KEY);
  } catch (_) {}
  return getNewHomeMode();
}

let sessionMode = null;
/** Mode of this app run: read once so Home never swaps implementation under a mounted screen. */
export function sessionNewHomeMode() {
  if (sessionMode === null) sessionMode = getNewHomeMode();
  return sessionMode;
}

export function resetSessionNewHomeMode() {
  sessionMode = null;
  webglFailure = null;
  mountedEngine = "";
}

let mountedEngine = "";
/** Engine of the last new Home mount, with the fallback reason: "dom", "webgl", "dom:lost"… */
export function noteHomeEngine(engine) {
  mountedEngine = engine;
}

export function activeHomeEngine() {
  return mountedEngine;
}

let webglFailure = null;
/** After a WebGL failure (no WebGL, context lost on screen, texture budget) the run stays on DOM. */
export function markWebglFailed(reason) {
  webglFailure = webglFailure || String(reason || "unknown");
}

/** Renderer actually drawing the new Home: "webgl", "dom", or "off" for the current Home. */
export function homeEngine() {
  const mode = sessionNewHomeMode();
  if (mode === "off") return "off";
  if (mode === "webgl") return webglFailure ? "dom" : "webgl";
  return mountedEngine.split(":")[0] || mode;
}

/** Why the chosen WebGL engine fell back to DOM ("no-webgl", "lost", "context-lost"…), or null. */
export function homeEngineFallback() {
  return webglFailure || mountedEngine.split(":")[1] || null;
}

// Diagnostic A/B variant of the WebGL engine (lot W1a: hero stripes on the TV), one at a time,
// read when the engine is created: it applies from the next app launch.
const WEBGL_VARIANT_KEY = "tvWebglVariant";
export const WEBGL_VARIANTS = Object.freeze([
  "standard",
  "bitmap-basic",
  "platform-legacy",
  "hero-780"
]);

export function getWebglVariant() {
  try {
    const raw = String(LocalStore.get(WEBGL_VARIANT_KEY, "") || "");
    return WEBGL_VARIANTS.includes(raw) ? raw : "standard";
  } catch (_) {
    return "standard";
  }
}

export function cycleWebglVariant() {
  const next =
    WEBGL_VARIANTS[(WEBGL_VARIANTS.indexOf(getWebglVariant()) + 1) % WEBGL_VARIANTS.length];
  try {
    if (next === "standard") LocalStore.remove(WEBGL_VARIANT_KEY);
    else LocalStore.set(WEBGL_VARIANT_KEY, next);
  } catch (_) {}
  return getWebglVariant();
}

let glInfoSource = null;
/** The WebGL engine registers its glInfo here, so the Diagnostic never imports the engine. */
export function setWebglInfoSource(source) {
  glInfoSource = source;
}

export function webglInfo() {
  try {
    return glInfoSource?.() ?? null;
  } catch (_) {
    return null;
  }
}
