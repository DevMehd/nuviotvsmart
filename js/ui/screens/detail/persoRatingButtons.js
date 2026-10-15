// Five focusable rating buttons in the detail actions row (nuv-035). OK rates;
// OK on the current rating removes it. Updates in place, no screen re-render.
import { I18n } from "../../../i18n/index.js";
import { RATING_SCALE, TitleRatings } from "../../../core/perso/titleRatings.js";

function attr(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export function renderPersoRatingButtons(type, id) {
  if (!type || !id) return "";
  const current = TitleRatings.valueOf(type, id);
  return RATING_SCALE.map((entry) => {
    const label = I18n.t(entry.key, {}, { fallback: entry.fallback });
    return `<button class="series-circle-btn focusable perso-rating-btn${entry.value === current ? " is-selected" : ""}" data-action="persoRate" data-rating="${entry.value}" aria-label="${attr(label)}" title="${attr(label)}" style="font-size:22px;line-height:1">${entry.emoji}</button>`;
  }).join("");
}

export function handlePersoRate(container, node, { type, id, name, poster }) {
  const value = Number(node?.dataset?.rating);
  if (!Number.isInteger(value) || !type || !id) return;
  const next = TitleRatings.valueOf(type, id) === value ? null : value;
  TitleRatings.rate(type, id, name, poster, next);
  container?.querySelectorAll?.("[data-action='persoRate']").forEach((button) => {
    button.classList.toggle("is-selected", next != null && Number(button.dataset.rating) === next);
  });
}
