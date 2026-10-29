import { LocalStore } from "../../core/storage/localStore.js";
import { Platform } from "../../platform/index.js";

// Device-local beta switch for the new TV Sources screen, like tvNewHome.
const NEW_SOURCES_KEY = "tvNewSources";
export const NEW_SOURCES_MODES = Object.freeze(["off", "on"]);

/** Not offered on webOS: Magic Remote pointer/wheel and the native action are not covered. */
export function newSourcesAvailable() {
  return !Platform.isWebOS();
}

export function getNewSourcesMode() {
  try {
    if (!newSourcesAvailable()) return "off";
    return String(LocalStore.get(NEW_SOURCES_KEY, "") || "").toLowerCase() === "on" ? "on" : "off";
  } catch (_) {
    return "off";
  }
}

export function setNewSourcesMode(mode) {
  try {
    if (mode === "on") LocalStore.set(NEW_SOURCES_KEY, mode);
    else LocalStore.remove(NEW_SOURCES_KEY);
  } catch (_) {}
  return getNewSourcesMode();
}

let sessionMode = null;
/** Mode of this app run: read once so the stream route never swaps implementation mid-session. */
export function sessionNewSourcesMode() {
  if (sessionMode === null) sessionMode = getNewSourcesMode();
  return sessionMode;
}

export function resetSessionNewSourcesMode() {
  sessionMode = null;
}
