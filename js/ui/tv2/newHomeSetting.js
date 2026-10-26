import { LocalStore } from "../../core/storage/localStore.js";

// Device-local beta switch for the new TV Home (nuv-091), like tvPerfMode.
const NEW_HOME_KEY = "tvNewHome";
export const NEW_HOME_MODES = Object.freeze(["off", "dom"]);
// Reserved for the lot B2 prototypes; not selectable until they exist.
export const FUTURE_NEW_HOME_MODES = Object.freeze(["hybrid", "webgl"]);

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
}
