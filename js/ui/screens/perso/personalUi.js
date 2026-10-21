import { Router } from "../../navigation/routerState.js";
import { Recommendations } from "../../../core/perso/personalRecommendations.js";
import { personalContext, isCurrentContext } from "../../../core/perso/personalContext.js";
import { TitleRatings, ratingFor } from "../../../core/perso/titleRatings.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
export function renderPersonalPrediction(meta = {}) {
  const own = ratingFor(TitleRatings.valueOf(meta.type, meta.id));
  if (own) return `<p class="perso-prediction">Ta note : ${own.emoji} ${esc(own.fallback)}</p>`;
  const prediction = Recommendations.predict(meta);
  if (!prediction) return "";
  const model = Recommendations.snapshot().model;
  const reasons = prediction.reasons.map((key) => model?.labels?.[key] || key.slice(2));
  return `<p class="perso-prediction">Tu devrais aimer : ${prediction.percent} %${reasons.length ? ` · ${esc(reasons.join(", "))}` : ""}${prediction.warning ? " · Proche d’un titre que tu n’as pas aimé" : ""}</p>`;
}

export function personalHomeRows(rows = []) {
  const base = rows.filter((row) => !String(row.catalogId || "").startsWith("perso:"));
  const snapshot = Recommendations.snapshot();
  const extra = [];
  const add = (id, title, items) => {
    if (items?.length)
      extra.push({
        id,
        addonId: "nuvio.personal",
        addonName: "Mon espace",
        catalogId: id,
        catalogName: title,
        title,
        type: "movie",
        apiType: "movie",
        items,
        // Home rows read their titles from result.data.items (catalog format, nuv-090).
        homeCatalogKey: id,
        result: { status: "success", data: { items, hasMore: false } },
        isLoading: false,
        hasMore: false,
        supportsSkip: false
      });
  };
  add("perso:for-you", "Pour toi", snapshot.forYou);
  add(
    "perso:because",
    `Parce que tu as aimé ${snapshot.becauseTitle || "ces titres"}`,
    snapshot.because
  );
  return [...base, ...extra];
}

// Append new rows only while Home is idle. A running gesture retains its data
// and focus until the next route return; Home owns the incremental DOM update.
export function refreshPersonalHome(screen) {
  const ctx = personalContext();
  const loadToken = screen.homeLoadToken;
  void Recommendations.refresh({ ctx })
    .then(() => {
      if (!isCurrentContext(ctx)) return;
      if (
        Router.getCurrentScreen?.() !== screen ||
        screen.homeLoadToken !== loadToken ||
        screen.hasUserInteractedSinceHomePaint
      )
        return;
      const next = personalHomeRows(screen.rows || []);
      const oldPersonal = (screen.rows || []).filter((row) => row.addonId === "nuvio.personal");
      const newPersonal = next.filter((row) => row.addonId === "nuvio.personal");
      if (
        JSON.stringify(oldPersonal.map((r) => r.items)) !==
        JSON.stringify(newPersonal.map((r) => r.items))
      ) {
        screen.rows = next;
        screen.render();
      }
    })
    .catch(() => {});
}
