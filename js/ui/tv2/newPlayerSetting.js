import { LocalStore } from "../../core/storage/localStore.js";
import { Platform } from "../../platform/index.js";

// Device-local switch for the new VIDAA player (lot P), like tvNewHome. On by default on VIDAA
// (decision D1); "off" brings back the old player. Tizen, webOS and browser always keep it.
const NEW_PLAYER_KEY = "tvNewPlayer";
export const NEW_PLAYER_MODES = Object.freeze(["off", "on"]);

export function newPlayerAvailable() {
  return Platform.isVidaa();
}

export function getNewPlayerMode() {
  try {
    if (!newPlayerAvailable()) return "off";
    return String(LocalStore.get(NEW_PLAYER_KEY, "") || "").toLowerCase() === "off" ? "off" : "on";
  } catch (_) {
    return "off";
  }
}

export function setNewPlayerMode(mode) {
  try {
    if (mode === "off") LocalStore.set(NEW_PLAYER_KEY, "off");
    else LocalStore.remove(NEW_PLAYER_KEY);
  } catch (_) {}
  return getNewPlayerMode();
}

let sessionMode = null;
/** Mode of this app run (decision D2): the player route never swaps implementation mid-run. */
export function sessionNewPlayerMode() {
  if (sessionMode === null) sessionMode = getNewPlayerMode();
  return sessionMode;
}

export function resetSessionNewPlayerMode() {
  sessionMode = null;
}
