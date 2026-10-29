import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.Image = class {
  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onerror?.());
  }
};
globalThis.fetch = async () => {
  throw new Error("Preset selection must not fetch JSON or sync account settings");
};

const { StreamBadgeSettingsStore } = await import("../js/data/local/streamBadgeSettingsStore.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const {
  STREAM_BADGE_PRESETS,
  resolveStreamBadgePresetRules,
  getSelectedStreamBadgePreset,
  getStreamImageBadges
} = await import("../js/core/streams/streamBadgePresets.js");
const { getVidaaBadgeImageUrl, getVidaaBadgeImageOriginal, buildVidaaBadgeFallbackAttributes } =
  await import("../js/core/media/vidaaBadgeOptimization.js");
const { renderStreamBadges } =
  await import("../js/ui/screens/stream/streamScreenHelpers-03-render-image-badge-chip.js");
const { renderPlayerSourceBadges } =
  await import("../js/ui/screens/player/playerScreenHelpers-09-format-bytes.js");
const { getVisibleSections } =
  await import("../js/ui/screens/settings/settingsScreenHelpers-08-update-settings-scroll-indicators.js");

await ProfileManager.setActiveProfile("1");
await ProfileManager.setActiveProfile("2");
assert.equal(StreamBadgeSettingsStore.snapshot().rules.imports[0].filters.length, 106);
StreamBadgeSettingsStore.setPersonalBadgePreset("ELITE");
assert.equal(StreamBadgeSettingsStore.snapshot().rules.imports[0].filters.length, 31);
await ProfileManager.setActiveProfile("1");
StreamBadgeSettingsStore.setPersonalBadgePreset("NARD");
await ProfileManager.setActiveProfile("2");
assert.equal(StreamBadgeSettingsStore.get().personalBadgePreset, "ELITE");
// The cloud pull merges normal Android settings without deleting the TV choice.
StreamBadgeSettingsStore.setForProfile(
  "2",
  { rules: { imports: [] }, showFileSizeBadges: false },
  { silentSync: true }
);
assert.equal(StreamBadgeSettingsStore.get().personalBadgePreset, "ELITE");
assert.equal(storage.get("profileSettingsSyncPendingProfiles"), undefined);

const source = {
  name: "𝟰𝗞",
  title: "BluRay REMUX HEVC HDR10+ Dolby Vision Atmos 5.1 French",
  behaviorHints: { filename: "Film.2160p.HEVC.mkv" },
  badges: [{ name: "Old badge", imageURL: "https://example.test/old.webp" }]
};
for (const preset of STREAM_BADGE_PRESETS) {
  const rules = resolveStreamBadgePresetRules({ personalBadgePreset: preset.id }, true);
  const settings = { rules, showFileSizeBadges: false };
  const badges = getStreamImageBadges(source, settings);
  assert.ok(badges.some((b) => /4K/.test(b.name)));
  assert.ok(badges.some((b) => /HEVC/.test(b.name)));
  assert.ok(
    !badges.some((b) => b.name === "Old badge"),
    "Old resolver badges must not mix pack styles"
  );
  const card = renderStreamBadges(source, true, settings);
  const player = renderPlayerSourceBadges(source, settings);
  assert.ok(card.includes("cdn.xperience-app.com"));
  assert.ok(player.includes("cdn.xperience-app.com"));
  assert.ok(!card.includes("badge technical"));
  assert.equal(
    resolveStreamBadgePresetRules({ personalBadgePreset: preset.id }, true),
    rules,
    "Reuse compiled immutable preset rules"
  );
  for (const filter of rules.imports[0].filters)
    assert.ok(filter.imageURL.startsWith("https://cdn.xperience-app.com/badges/"));
}
// Off VIDAA (autoUsesPack false) AUTO keeps the imported rules; an explicit
// pack still applies. On VIDAA AUTO without imports still resolves to Nard.
assert.deepEqual(
  resolveStreamBadgePresetRules({ personalBadgePreset: "AUTO", rules: { imports: [] } }, false),
  { imports: [] }
);
assert.equal(
  resolveStreamBadgePresetRules({ personalBadgePreset: "NARD", rules: { imports: [] } }, false),
  resolveStreamBadgePresetRules({ personalBadgePreset: "NARD" }, true)
);
assert.equal(
  resolveStreamBadgePresetRules({ personalBadgePreset: "AUTO", rules: { imports: [] } }, true)
    .imports[0].filters.length,
  106
);
assert.equal(getSelectedStreamBadgePreset({ personalBadgePreset: "AUTO" }, true), "NARD");
assert.equal(getSelectedStreamBadgePreset({ personalBadgePreset: "AUTO" }, false), "IMPORTED");
assert.equal(getSelectedStreamBadgePreset({ personalBadgePreset: "ELITE" }, false), "ELITE");
assert.ok(
  getVisibleSections({ experience: { mode: "ESSENTIAL" } }).some(
    (section) => section.id === "streams"
  )
);

globalThis.__NUVIO_IMAGE_OPTIMIZATION__ = true;
const original = "https://cdn.xperience-app.com/badges/elite/7.webp";
const optimized = getVidaaBadgeImageUrl(original);
assert.ok(optimized.includes("&w=128&q=80"));
assert.equal(getVidaaBadgeImageUrl(optimized), optimized);
assert.equal(getVidaaBadgeImageOriginal(optimized), original);
assert.ok(buildVidaaBadgeFallbackAttributes(optimized).includes("delete this.dataset.originalSrc"));
assert.equal(getVidaaBadgeImageUrl(original + "?token=private"), original + "?token=private");
assert.equal(
  getVidaaBadgeImageUrl("https://private.example/badge.webp"),
  "https://private.example/badge.webp"
);
globalThis.__NUVIO_IMAGE_OPTIMIZATION__ = false;
assert.equal(getVidaaBadgeImageUrl(original), original, "Offline/local builds remain direct");
console.log(
  "Xperience checks passed: both real packs, per-profile persistence, cloud refresh preservation, rendering and restricted small-image optimization."
);
