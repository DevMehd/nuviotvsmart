import { RecommendationEngine, TasteModels } from "./recommendationEngine.js";

/** The worker and bounded main-thread fallback execute exactly the same pure code. */
export function computeRecommendationTask(task, payload) {
  if (task === "rank") {
    return RecommendationEngine.rank(
      payload.weights,
      payload.seen,
      payload.candidates.slice(0, 200),
      new Set(payload.exclude),
      payload.currentYear,
      payload.limit,
      payload.libraryGenres
    );
  }
  if (task === "models") {
    const recentKeys = new Set(payload.recentKeys);
    return {
      model: TasteModels.build(payload.weights, payload.seen, payload.now),
      recentModel: TasteModels.build(
        Object.fromEntries(Object.entries(payload.weights).filter(([key]) => recentKeys.has(key))),
        payload.seen.filter((title) => recentKeys.has(`${title.type}:${title.id}`)),
        payload.now
      ),
      affinities: Object.fromEntries(
        Object.entries(RecommendationEngine.affinities(payload.weights, payload.seen))
          .filter(([, value]) => Math.abs(value) > 0.01)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 400)
      )
    };
  }
  throw new Error("Unknown recommendation task");
}

if (
  typeof globalThis.WorkerGlobalScope !== "undefined" &&
  globalThis instanceof globalThis.WorkerGlobalScope
) {
  globalThis.onmessage = ({ data }) => {
    try {
      globalThis.postMessage({
        id: data.id,
        result: computeRecommendationTask(data.task, data.payload)
      });
    } catch (_) {
      globalThis.postMessage({ id: data.id, error: "Recommendation computation failed" });
    }
  };
}
