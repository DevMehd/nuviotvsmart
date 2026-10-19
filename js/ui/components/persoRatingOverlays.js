import { personalContext, isCurrentContext } from "../../core/perso/personalContext.js";
// Remote-friendly rating dialog and the "Découverte" card deck (nuv-035 / nuv-036).
// Both are self-contained overlays that capture keys first, like the hand-off prompt.
import { I18n } from "../../i18n/index.js";
import { RATING_SCALE, TitleRatings } from "../../core/perso/titleRatings.js";

const BACK_KEYS = new Set([8, 27, 461, 10009]);
let active = null;

function t(key, params, fallback) {
  return I18n.t(key, params || {}, { fallback });
}

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/** 1–5 (top row or numpad) → rating value −2..2, null otherwise. */
export function digitToRating(code) {
  if (code >= 49 && code <= 53) return code - 51;
  if (code >= 97 && code <= 101) return code - 99;
  return null;
}

/** Découverte gestures on the remote. */
export function discoveryAction(code) {
  if (code === 39) return { type: "rate", value: 1 };
  if (code === 37) return { type: "rate", value: -1 };
  if (code === 38) return { type: "rate", value: 2 };
  if (code === 40) return { type: "skip" };
  if (code === 13) return { type: "open" };
  if (BACK_KEYS.has(code)) return { type: "close" };
  const digit = digitToRating(code);
  return digit == null ? null : { type: "rate", value: digit };
}

export function closeRatingOverlay() {
  if (!active) return;
  window.removeEventListener("keydown", active.onKey, true);
  active.root.remove();
  active = null;
}

function mount(root, onKey) {
  closeRatingOverlay();
  document.body.appendChild(root);
  window.addEventListener("keydown", onKey, true);
  active = { root, onKey };
}

function overlayRoot() {
  const root = document.createElement("div");
  root.className = "perso-rating-overlay";
  root.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);color:var(--text-color);font-family:inherit"
  );
  return root;
}

function choicesMarkup() {
  return RATING_SCALE.map(
    (entry, index) => `
      <div class="perso-rating-choice" data-index="${index}" style="flex:1;min-width:0;padding:18px 8px;border-radius:20px;text-align:center;border:3px solid transparent;background:rgba(255,255,255,.08)">
        <div style="font-size:44px;line-height:1.2">${entry.emoji}</div>
        <div style="font-size:20px;margin-top:6px;opacity:.85">${escapeHtml(t(entry.key, {}, entry.fallback))}</div>
      </div>`
  ).join("");
}

/** Rating dialog: ←/→ choose, OK confirms (OK on the current rating removes it), 1–5 direct. */
export function showRatingDialog({ type, id, name, poster, fromPlaybackEnd = false, onDone } = {}) {
  const ctx = personalContext();
  const current = TitleRatings.valueOf(type, id);
  const root = overlayRoot();
  root.innerHTML = `
    <div style="width:62vw;max-width:1100px;border-radius:28px;background:var(--bg-elevated);padding:36px 44px;box-shadow:0 30px 80px rgba(0,0,0,.6)">
      <div style="font-size:36px;font-weight:800">${escapeHtml(fromPlaybackEnd ? t("perso_rating_after", { name }, `Qu'as-tu pensé de ${name} ?`) : name)}</div>
      <div style="font-size:20px;opacity:.65;margin:8px 0 26px">${escapeHtml(t("perso_rating_hint", {}, "Privé : sert à tes recommandations, partagé entre tes appareils. Touches 1 à 5 ou ← → puis OK."))}</div>
      <div style="display:flex;gap:16px">${choicesMarkup()}</div>
      <div data-later style="margin-top:26px;font-size:22px;opacity:.7">${escapeHtml(fromPlaybackEnd ? t("perso_rating_later", {}, "Retour : plus tard") : t("perso_rating_close", {}, "Retour : fermer"))}</div>
    </div>`;
  let index = Math.max(
    0,
    RATING_SCALE.findIndex((e) => e.value === (current ?? 1))
  );
  const render = () => {
    root.querySelectorAll("[data-index]").forEach((node) => {
      const i = Number(node.getAttribute("data-index"));
      const isCurrent = RATING_SCALE[i].value === current;
      node.style.borderColor = i === index ? "var(--focus-color)" : "transparent";
      node.style.background = isCurrent
        ? "var(--focus-bg)"
        : i === index
          ? "rgba(var(--focus-color-rgb-legacy),.18)"
          : "rgba(255,255,255,.08)";
      node.style.transform = i === index ? "scale(1.06)" : "none";
    });
  };
  const choose = (value) => {
    if (!isCurrentContext(ctx)) return closeRatingOverlay();
    const next = value === current ? null : value;
    TitleRatings.rate(type, id, name, poster, next);
    // A personal rating also follows into each joined list containing this title.
    void import("../../core/perso/sharedLists.js").then(({ SharedLists }) => {
      if (!isCurrentContext(ctx)) return;
      const key = `${type}:${id}`;
      for (const list of Object.values(SharedLists.all(ctx))) {
        if (list.items[key] && list.items[key].addedAt > list.items[key].removedAt)
          SharedLists.mutate(list.code, key, "rating", next, ctx);
      }
    });
    closeRatingOverlay();
    onDone?.(next);
  };
  const onKey = (event) => {
    const code = event.keyCode || event.which;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    const digit = digitToRating(code);
    if (digit != null) return choose(digit);
    if (code === 37) index = Math.max(0, index - 1);
    else if (code === 39) index = Math.min(RATING_SCALE.length - 1, index + 1);
    else if (code === 13) return choose(RATING_SCALE[index].value);
    else if (BACK_KEYS.has(code)) return closeRatingOverlay();
    render();
  };
  mount(root, onKey);
  render();
}

/** Découverte: one card at a time; → 👍, ← 👎, ↑ 💜, ↓ skip, OK opens the detail, 1–5 the full scale. */
export async function showDiscovery({ openDetail } = {}) {
  const discoveryContext = personalContext();
  const root = overlayRoot();
  root.style.background = "var(--bg-color)";
  root.innerHTML = `<div style="font-size:30px;opacity:.8">${escapeHtml(t("perso_discovery_loading", {}, "Chargement des découvertes…"))}</div>`;
  let cards = [];
  let index = 0;
  let rated = 0;
  let animating = false;
  const render = () => {
    const card = cards[index];
    if (!card) {
      root.innerHTML = `<div style="text-align:center"><div style="font-size:40px;font-weight:800">${escapeHtml(t("perso_discovery_done", {}, "C'est tout pour l'instant"))}</div>
        <div style="font-size:24px;opacity:.7;margin-top:12px">${escapeHtml(t("perso_discovery_done_hint", {}, "Note d'autres titres sur ton téléphone ou reviens plus tard. Retour pour fermer."))}</div></div>`;
      return;
    }
    const meta = [
      card.releaseInfo,
      card.imdbRating ? `★ ${card.imdbRating}` : "",
      (card.genres || []).slice(0, 3).join(" · ")
    ]
      .filter(Boolean)
      .join("   ·   ");
    root.innerHTML = `
      <div style="display:flex;gap:56px;align-items:center;max-width:1500px;width:84vw">
        <div class="perso-discovery-card" data-card style="flex:none;width:30vw;max-width:460px;aspect-ratio:2/3;border-radius:28px;background:var(--card-bg) center/cover no-repeat ${card.poster ? `url('${escapeHtml(card.poster)}')` : "none"};box-shadow:0 30px 80px rgba(0,0,0,.6)"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:22px;opacity:.6">${escapeHtml(t("perso_discovery_title", {}, "Découverte"))} · ${escapeHtml(t("perso_discovery_count", { count: rated }, `${rated} notés`))}</div>
          <div style="font-size:56px;font-weight:800;margin:12px 0">${escapeHtml(card.name)}</div>
          <div style="font-size:26px;opacity:.8">${escapeHtml(meta)}</div>
          <div style="font-size:24px;opacity:.9;margin-top:40px;line-height:1.7">
            → 👍 ${escapeHtml(t("perso_rating_liked", {}, "J'aime"))}<br>← 👎 ${escapeHtml(t("perso_rating_disliked", {}, "Pas pour moi"))}<br>↑ 💜 ${escapeHtml(t("perso_rating_loved", {}, "J'adore"))}<br>↓ ${escapeHtml(t("perso_discovery_skip", {}, "Pas vu · passer"))}<br>OK ${escapeHtml(t("perso_discovery_open", {}, "Voir la fiche"))} · 1–5 ${escapeHtml(t("perso_discovery_scale", {}, "toutes les notes"))}
          </div>
        </div>
      </div>`;
  };
  const advance = (dx, dy) => {
    const node = root.querySelector("[data-card]");
    animating = true;
    if (node) {
      node.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 40}deg)`;
      node.style.opacity = "0";
    }
    setTimeout(() => {
      index += 1;
      animating = false;
      render();
    }, 220);
  };
  const onKey = (event) => {
    const code = event.keyCode || event.which;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    const action = discoveryAction(code);
    if (!action || animating) return;
    const card = cards[index];
    if (action.type === "close") return closeRatingOverlay();
    if (!card) return;
    if (action.type === "open") {
      closeRatingOverlay();
      openDetail?.(card);
      return;
    }
    if (!isCurrentContext(discoveryContext)) return closeRatingOverlay();
    if (action.type === "rate") {
      TitleRatings.rate(card.type, card.id, card.name, card.poster, action.value);
      rated += 1;
      advance(action.value >= 2 ? 0 : action.value > 0 ? 600 : -600, action.value >= 2 ? -500 : 0);
    } else if (action.type === "skip") {
      advance(0, 500);
    }
  };
  mount(root, onKey);
  try {
    const [{ Recommendations }, { personalContext, isCurrentContext }] = await Promise.all([
      import("../../core/perso/personalRecommendations.js"),
      import("../../core/perso/personalContext.js")
    ]);
    const ctx = personalContext();
    const unrated = () =>
      Recommendations.snapshot(ctx).forYou.filter(
        (title) => TitleRatings.valueOf(title.type, title.id) == null
      );
    cards = unrated();
    if (!cards.length) {
      await Recommendations.refresh({ ctx });
      if (!isCurrentContext(ctx) || active?.root !== root) return;
      cards = unrated();
    }
    if (!cards.length) cards = await TitleRatings.recommendations();
  } catch (_error) {
    cards = [];
  }
  if (active?.root === root) render();
}
