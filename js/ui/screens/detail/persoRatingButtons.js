// One secondary action opens the same five-level picker as mobile.
// Keep the primary playback action readable instead of adding five focus stops.
import { TitleRatings, ratingFor } from "../../../core/perso/titleRatings.js";
import { showRatingDialog } from "../../components/persoRatingOverlays.js";
import { renderPersonalPrediction } from "../perso/personalUi.js";

function attr(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
export function renderPersoRatingButtons(type, id) {
  if (!type || !id) return "";
  const current = ratingFor(TitleRatings.valueOf(type, id));
  const label = current ? `Ta note : ${current.fallback} · modifier` : "Noter ce titre";
  return `<button class="series-circle-btn focusable perso-rating-btn${current ? " is-selected" : ""}" data-action="persoRate" aria-label="${attr(label)}" title="${attr(label)}" style="font-size:22px;line-height:1">${current?.emoji || "☆"}</button>`;
}
export function handlePersoRate(container, node, title) {
  if (!title.type || !title.id) return;
  showRatingDialog({
    ...title,
    onDone: () => {
      if (!container?.contains(node)) return;
      const current = ratingFor(TitleRatings.valueOf(title.type, title.id));
      node.textContent = current?.emoji || "☆";
      node.classList.toggle("is-selected", Boolean(current));
      node.setAttribute(
        "aria-label",
        current ? `Ta note : ${current.fallback} · modifier` : "Noter ce titre"
      );
      node.title = node.getAttribute("aria-label");
      const line = container.querySelector(".perso-prediction");
      if (line) line.outerHTML = renderPersonalPrediction(title);
    }
  });
}
