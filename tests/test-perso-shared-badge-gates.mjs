// De-gated stream presentation features on a non-VIDAA TV (webOS): the
// technical text chips fallback. The Xperience badge pack stays VIDAA-only.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "webos";
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("Badge checks must stay offline");
};

const { Platform } = await import("../js/platform/index.js");
const { StreamBadgeSettingsStore } = await import("../js/data/local/streamBadgeSettingsStore.js");
const { renderStreamBadges, hasStreamBadges } =
  await import("../js/ui/screens/stream/streamScreenHelpers-03-render-image-badge-chip.js");
const { renderPlayerSourceBadges } =
  await import("../js/ui/screens/player/playerScreenHelpers-09-format-bytes.js");
const { getVisibleSections } =
  await import("../js/ui/screens/settings/settingsScreenHelpers-08-update-settings-scroll-indicators.js");

assert.equal(Platform.isVidaa(), false);

// Technical text chips: rendered on webOS when no image badge matches.
const source = {
  name: "4K",
  title: "BluRay REMUX HEVC HDR10 French",
  behaviorHints: { filename: "Film.2160p.HEVC.mkv" }
};
const noRules = { rules: { imports: [] }, showFileSizeBadges: false };
assert.ok(renderStreamBadges(source, true, noRules).includes("stream-route-stream-badge technical"));
assert.ok(renderPlayerSourceBadges(source, noRules).includes("stream-route-stream-badge technical"));
assert.equal(hasStreamBadges(source, true, noRules), true);

// The Xperience pack stays VIDAA-only (audit final verdict keep-platform):
// on webOS an explicit pack keeps the imported rules, and Essential mode
// still hides the Streams section as upstream does.
StreamBadgeSettingsStore.setPersonalBadgePreset("ELITE");
assert.deepEqual(StreamBadgeSettingsStore.snapshot().rules.imports, []);
StreamBadgeSettingsStore.setPersonalBadgePreset("AUTO");
assert.ok(!getVisibleSections({ experience: { mode: "ESSENTIAL" } }).some((section) => section.id === "streams"));

console.log("PASS: shared technical chips on webOS; Xperience pack still VIDAA-only.");
