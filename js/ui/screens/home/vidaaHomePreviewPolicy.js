import { isVidaaNavigationBusy } from "../../navigation/vidaaNavigationActivity.js";

// Preview work has its own small budget. Background catalog loading retains
// the longer navigation guard; a single hero must not wait for that guard.
export function isVidaaHomePreviewBusy(screen, now = Date.now()) {
  const elapsed = now - Number(screen.lastHomeInputAt || 0);
  return Boolean(
    isVidaaNavigationBusy({ quietMs: 60 }) ||
    screen.isModernVerticalScrollActive?.() ||
    screen._mainClassicVertRaf ||
    (screen.homeDirectionalInputBurst && elapsed >= 0 && elapsed < 250)
  );
}

export function getVidaaHeroFocusDelay({ rapid = false } = {}) {
  return rapid ? 140 : 80;
}
