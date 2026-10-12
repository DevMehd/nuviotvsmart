import { badgeMatchCandidates, rememberStreamBadgeMatches } from "./streamBadgeRules.js";
import { STREAM_BADGE_PRESETS, resolveStreamBadgePresetRules } from "./streamBadgePresets.js";

let worker = null;
let failed = false;
let sequence = 0;
const pending = new Map();

function stopWorker() {
  failed = true;
  worker?.terminate();
  worker = null;
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.resolve(false);
  }
  pending.clear();
}

export function prepareStreamBadgeMatches(streams = [], settings = {}) {
  const preset = STREAM_BADGE_PRESETS.find((entry) =>
    settings.rules?.imports?.some((item) => item.isActive && item.sourceUrl === entry.sourceUrl)
  );
  if (
    globalThis.__NUVIO_PLATFORM__ !== "vidaa" ||
    typeof Worker !== "function" ||
    !preset ||
    failed ||
    pending.size >= 4
  )
    return Promise.resolve(false);
  if (settings.rules !== resolveStreamBadgePresetRules({ personalBadgePreset: preset.id }, true))
    return Promise.resolve(false);
  const candidates = streams.slice(0, 256).map(badgeMatchCandidates);
  if (!candidates.length || JSON.stringify(candidates).length > 260000)
    return Promise.resolve(false);
  try {
    if (!worker) {
      worker = new Worker("assets/runtime/stream-badges-worker.js");
      worker.onerror = stopWorker;
      worker.onmessage = ({ data }) => {
        const task = pending.get(data?.id);
        if (!task) return;
        clearTimeout(task.timer);
        pending.delete(data.id);
        if (!Array.isArray(data.results) || data.results.length !== task.candidates.length) {
          task.resolve(false);
          return;
        }
        data.results.forEach((badges, index) =>
          rememberStreamBadgeMatches(task.candidates[index], task.rules, badges)
        );
        task.resolve(true);
      };
    }
    return new Promise((resolve) => {
      const id = ++sequence;
      const timer = setTimeout(stopWorker, 1800);
      pending.set(id, { resolve, timer, candidates, rules: settings.rules });
      try {
        worker.postMessage({ id, preset: preset.id, candidates });
      } catch {
        stopWorker();
      }
    });
  } catch {
    stopWorker();
    return Promise.resolve(false);
  }
}
