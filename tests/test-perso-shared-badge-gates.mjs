// De-gated stream presentation features on a non-VIDAA TV (webOS): the
// technical text chips fallback and the per-profile Xperience badge pack.
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
const { resolveStreamBadgePresetRules } = await import("../js/core/streams/streamBadgePresets.js");
const { renderStreamBadges, hasStreamBadges } =
  await import("../js/ui/screens/stream/streamScreenHelpers-03-render-image-badge-chip.js");
const { renderPlayerSourceBadges } =
  await import("../js/ui/screens/player/playerScreenHelpers-09-format-bytes.js");
const { getVisibleSections } =
  await import("../js/ui/screens/settings/settingsScreenHelpers-08-update-settings-scroll-indicators.js");
const { createSettingsScreenMethods09 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-09-render-integration-section.js");

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
// A matched image badge whose logo is still loading on webOS (no fallback
// URL there) must not be replaced by text chips that would then stay.
const withImageBadge = { ...source, badges: [{ name: "4K", imageURL: "http://127.0.0.1:2710/image-proxy?url=https%3A%2F%2Fi.imgur.com%2F4k.png" }] };
assert.ok(!renderStreamBadges(withImageBadge, true, noRules).includes("technical"));
assert.ok(!renderPlayerSourceBadges(withImageBadge, noRules).includes("technical"));
// The cached label follows the interface language (fallback stays French).
assert.ok(renderStreamBadges({ ...source, streamPresentation: { cached: true } }, true, noRules).includes(">En cache<"));
const { getStreamPresentationBadges } = await import("../js/core/streams/streamPresentationBadges.js");
assert.ok(getStreamPresentationBadges({ streamPresentation: { cached: true } }, "Cached").includes("Cached"));

// Badge pack: AUTO keeps the imported rules off VIDAA (no pack imposed);
// an explicit NARD/ELITE choice applies the pack on webOS as on VIDAA.
assert.deepEqual(StreamBadgeSettingsStore.snapshot().rules.imports, []);
assert.deepEqual(resolveStreamBadgePresetRules({ personalBadgePreset: "AUTO", rules: { imports: [] } }, false), {
  imports: []
});
StreamBadgeSettingsStore.setPersonalBadgePreset("ELITE");
const elite = StreamBadgeSettingsStore.snapshot();
assert.equal(elite.rules.imports[0].filters.length, 31);
assert.ok(renderStreamBadges(source, true, elite).includes("cdn.xperience-app.com"));
// Off VIDAA the pack images never go through the VIDAA-only Vercel proxy.
assert.ok(!renderStreamBadges(source, true, elite).includes("/_vercel/image"));
assert.ok(!renderPlayerSourceBadges(source, elite).includes("/_vercel/image"));
StreamBadgeSettingsStore.setPersonalBadgePreset("AUTO");
assert.deepEqual(StreamBadgeSettingsStore.snapshot().rules.imports, []);

// Settings: the Streams section and its pack row exist on webOS; Essential
// mode keeps only the pack row, Advanced mode keeps the full section.
assert.ok(getVisibleSections({ experience: { mode: "ESSENTIAL" } }).some((section) => section.id === "streams"));
const screen = {
  actionMap: new Map(),
  renderSectionHeader: () => "<header></header>",
  renderActionRow: ({ focusKey }) => `<row data-key="${focusKey}"></row>`,
  renderToggleRow: ({ focusKey }) => `<row data-key="${focusKey}"></row>`,
  ...createSettingsScreenMethods09()
};
const streamBadgeSettings = { rules: { imports: [] } };
const essential = screen.renderStreamsSection({ streamBadgeSettings, experience: { mode: "ESSENTIAL" } });
assert.ok(essential.includes('data-key="streams:personalPreset"'));
assert.ok(!essential.includes('data-key="streams:add"'));
assert.equal(typeof screen.actionMap.get("streams:personalPreset"), "function");
// AUTO off VIDAA applies no pack, so the dialog must not claim Nard is active.
screen.openOptionDialog = (dialog) => (screen.lastDialog = dialog);
screen.actionMap.get("streams:personalPreset")();
assert.equal(screen.lastDialog.selectedId, "IMPORTED");
assert.deepEqual(screen.lastDialog.options.map((option) => option.id), ["NARD", "ELITE", "IMPORTED"]);
const advanced = screen.renderStreamsSection({ streamBadgeSettings, experience: { mode: "ADVANCED" } });
assert.ok(advanced.includes('data-key="streams:personalPreset"'));
assert.ok(advanced.includes('data-key="streams:add"'));

console.log("PASS: shared badge gates (technical chips, per-profile pack, Streams settings) on webOS.");
