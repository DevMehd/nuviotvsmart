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

// The hero commit (backdrop, logo, metadata markup, enrichment) costs a few hundred
// milliseconds of main thread on a VIDAA TV. It waits for a calm period so moving
// card to card only moves the focus; the hero follows once the user settles.
export const VIDAA_HERO_SETTLE_MS = 450;
export const VIDAA_HERO_RAPID_SETTLE_MS = 600;

export function getVidaaHeroFocusDelay({ rapid = false } = {}) {
  return rapid ? VIDAA_HERO_RAPID_SETTLE_MS : VIDAA_HERO_SETTLE_MS;
}

/**
 * A single tap warms the hero artwork almost at once (cheap, off the main thread); during
 * rapid input the artwork waits until shortly before the commit, so cards passed over are
 * not downloaded and decoded.
 */
export function getVidaaHeroPreloadDelay(commitDelayMs, { rapid = false } = {}) {
  return rapid ? Math.max(0, Number(commitDelayMs || 0) - 80) : 20;
}
