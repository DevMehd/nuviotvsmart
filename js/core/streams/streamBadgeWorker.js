import { resolveStreamBadgePresetRules } from "./streamBadgePresets.js";
import { matchStreamBadgeCandidates } from "./streamBadgeRules.js";

self.onmessage = ({ data }) => {
  if (
    !data ||
    !["NARD", "ELITE"].includes(data.preset) ||
    !Array.isArray(data.candidates) ||
    data.candidates.length > 256
  )
    return;
  const rules = resolveStreamBadgePresetRules({ personalBadgePreset: data.preset }, true);
  const results = data.candidates.map((candidates) =>
    matchStreamBadgeCandidates(candidates, rules)
  );
  self.postMessage({ id: data.id, results });
};
