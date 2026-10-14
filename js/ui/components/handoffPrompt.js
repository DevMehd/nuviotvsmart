// Full-screen prompt shown when the phone sends playback to the TV. OK resumes, Back dismisses.
import { I18n } from "../../i18n/index.js";

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

function formatPosition(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function showHandoffPrompt(message, onAccept) {
  dismiss();
  const media = message.media || {};
  const episode =
    media.seasonNumber != null && media.episodeNumber != null
      ? ` · S${media.seasonNumber}E${media.episodeNumber}`
      : "";
  const root = document.createElement("div");
  root.className = "perso-handoff-prompt";
  root.setAttribute(
    "style",
    [
      "position:fixed",
      "inset:0",
      "z-index:99999",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(0,0,0,0.72)",
      "font-family:inherit"
    ].join(";")
  );
  const art = message.background || media.poster;
  root.innerHTML = `
    <div style="width:60vw;max-width:980px;border-radius:28px;overflow:hidden;background:#141414;box-shadow:0 30px 80px rgba(0,0,0,.6);color:#fff">
      ${art ? `<div style="height:30vh;background:center/cover no-repeat url('${escapeHtml(art)}')"></div>` : ""}
      <div style="padding:36px 44px">
        <div style="font-size:22px;opacity:.75;letter-spacing:.04em">${escapeHtml(t("handoff_from", { name: message.name || "" }, `Envoyé depuis ${message.name || "le téléphone"}`))}</div>
        <div style="font-size:44px;font-weight:800;margin:10px 0 6px">${escapeHtml(media.title || "")}${escapeHtml(episode)}</div>
        <div style="font-size:24px;opacity:.8">${escapeHtml(t("handoff_resume_at", { position: formatPosition(message.positionMs) }, `Reprendre à ${formatPosition(message.positionMs)}`))}</div>
        <div style="display:flex;gap:20px;margin-top:30px">
          <div data-choice="accept" style="padding:16px 34px;border-radius:999px;background:#fff;color:#000;font-size:26px;font-weight:700">${escapeHtml(t("handoff_play", {}, "Reprendre ici"))}</div>
          <div data-choice="dismiss" style="padding:16px 34px;border-radius:999px;background:rgba(255,255,255,.14);font-size:26px">${escapeHtml(t("handoff_dismiss", {}, "Ignorer"))}</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  let choice = "accept";
  const render = () => {
    root.querySelectorAll("[data-choice]").forEach((node) => {
      const selected = node.getAttribute("data-choice") === choice;
      node.style.background = selected ? "#fff" : "rgba(255,255,255,.14)";
      node.style.color = selected ? "#000" : "#fff";
    });
  };
  const onKey = (event) => {
    const code = event.keyCode || event.which;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (code === 37 || code === 39) {
      choice = choice === "accept" ? "dismiss" : "accept";
      render();
    } else if (code === 13) {
      const accepted = choice === "accept";
      dismiss();
      if (accepted) onAccept();
    } else if (BACK_KEYS.has(code)) {
      dismiss();
    }
  };
  window.addEventListener("keydown", onKey, true);
  const timer = setTimeout(dismiss, 90 * 1000);
  active = { root, onKey, timer };
  render();
}

export function dismiss() {
  if (!active) return;
  window.removeEventListener("keydown", active.onKey, true);
  clearTimeout(active.timer);
  active.root.remove();
  active = null;
}
