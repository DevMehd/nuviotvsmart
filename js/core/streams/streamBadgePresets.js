import elite from "../../data/badges/xperienceElite.json" with { type: "json" };
import nard from "../../data/badges/xperienceNard.json" with { type: "json" };
import {
  parseStreamBadgeRulesFromPayload,
  prepareStreamBadgeRules,
  matchStreamBadges,
  mergeStreamBadges
} from "./streamBadgeRules.js";
import { getDeclaredStreamBadges } from "./streamPresentationBadges.js";

export const STREAM_BADGE_PRESETS = [
  {
    id: "NARD",
    label: "Xperience Nard",
    count: 106,
    sourceUrl: "https://xperience-app.com/badges/1df4aca5-982a-4e95-b4a0-9373f8a0d724.json"
  },
  {
    id: "ELITE",
    label: "Xperience Elite",
    count: 31,
    sourceUrl: "https://xperience-app.com/badges/5654a95a-eed2-45fd-8cd7-e9b24a8d8ce4.json"
  }
];
const preparedPresets = new Map();

export function normalizeStreamBadgePreset(value) {
  const id = String(value || "AUTO").toUpperCase();
  return ["AUTO", "NARD", "ELITE", "IMPORTED"].includes(id) ? id : "AUTO";
}

// An explicit NARD/ELITE choice applies on every platform; only autoUsesPack
// (VIDAA) lets the AUTO default fall back to the Nard pack, so other TVs keep
// their imported rules until the profile picks a pack.
export function getSelectedStreamBadgePreset(settings = {}, autoUsesPack = false) {
  const id = normalizeStreamBadgePreset(settings.personalBadgePreset);
  if (id !== "AUTO") return id;
  return settings.rules?.imports?.length || !autoUsesPack ? "IMPORTED" : "NARD";
}

export function resolveStreamBadgePresetRules(settings = {}, autoUsesPack = false) {
  const selected = getSelectedStreamBadgePreset(settings, autoUsesPack);
  const preset = STREAM_BADGE_PRESETS.find((entry) => entry.id === selected);
  if (!preset) return settings.rules || { imports: [] };
  if (!preparedPresets.has(preset.id)) {
    const payload = preset.id === "ELITE" ? elite : nard;
    preparedPresets.set(
      preset.id,
      prepareStreamBadgeRules(parseStreamBadgeRulesFromPayload(payload, preset.sourceUrl))
    );
  }
  return preparedPresets.get(preset.id);
}

export function getStreamImageBadges(stream = {}, settings = {}) {
  const matched = matchStreamBadges(stream, settings.rules);
  const presetActive = settings.rules?.imports?.some(
    (entry) =>
      entry.isActive && STREAM_BADGE_PRESETS.some((preset) => preset.sourceUrl === entry.sourceUrl)
  );
  // A selected pack supplies a consistent visual style, including streams that
  // retained old image badges from a previous resolver or saved source.
  return presetActive && matched.length
    ? matched
    : mergeStreamBadges(getDeclaredStreamBadges(stream), matched);
}
