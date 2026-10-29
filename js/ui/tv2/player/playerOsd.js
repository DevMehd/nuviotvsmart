// OSD of the new VIDAA player (lot P, P3): title, progress, seek preview, clock and end time;
// Audio and Subtitles buttons and their track panel (P4).
// Hidden = hidden attribute (display:none). The progress bar moves by transform: scaleX only, and
// the DOM is written only when a displayed string or ratio changes. No timer of its own: the
// screen updates it at 1 Hz while it is visible.
import { I18n } from "../../../i18n/index.js";
import { buildClockFormatOptions, resolveSystemHour12 } from "../../../core/player/clockFormat.js";
import { calculateRemainingPlaybackMilliseconds } from "../../../core/player/playbackEndTime.js";

export const OSD_HIDE_MS = 4000;

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });

export function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

let clockFormatter = null;
export function formatClock(date = new Date()) {
  const locale = I18n.getLocale?.() || undefined;
  if (clockFormatter?.locale !== locale) {
    const options = buildClockFormatOptions(resolveSystemHour12({ intlApi: globalThis.Intl }));
    let format = null;
    try {
      format = new Intl.DateTimeFormat(locale, options);
    } catch (_) {}
    clockFormatter = { locale, format, options };
  }
  try {
    return clockFormatter.format
      ? clockFormatter.format.format(date)
      : date.toLocaleTimeString(undefined, clockFormatter.options);
  } catch (_) {
    return "";
  }
}

/** Media keys, same table as the old player (playerScreenMethods-33); 427/428 come as 417/412. */
export function resolveMediaAction(event) {
  const keyMap = {
    MediaPlayPause: "toggle",
    MediaPlay: "play",
    MediaPause: "pause",
    MediaStop: "stop",
    MediaFastForward: "fastForward",
    MediaRewind: "rewind",
    MediaTrackNext: "next",
    MediaTrackPrevious: "previous",
    Play: "play",
    Pause: "pause"
  };
  for (const name of [event?.key, event?.keyName, event?.code])
    if (keyMap[String(name || "")]) return keyMap[String(name)];
  const codeMap = {
    179: "toggle",
    10252: "toggle",
    415: "play",
    19: "pause",
    413: "stop",
    178: "stop",
    417: "fastForward",
    412: "rewind",
    176: "next",
    177: "previous"
  };
  return codeMap[Number(event?.originalKeyCode || event?.keyCode || 0)] || null;
}

export const OSD_HTML = `
  <div class="p2-osd" hidden>
    <div class="p2-osd-clock"></div>
    <div class="p2-osd-bottom">
      <div class="p2-osd-title"></div>
      <div class="p2-osd-subtitle"></div>
      <div class="p2-osd-bar"><div class="p2-osd-fill"></div><div class="p2-osd-seek"></div></div>
      <div class="p2-osd-times">
        <span class="p2-osd-state"></span>
        <span class="p2-osd-time"></span>
        <span class="p2-osd-ends"></span>
      </div>
      <div class="p2-osd-actions">
        <button type="button" class="p2-osd-action" data-p2-osd="audio"></button>
        <button type="button" class="p2-osd-action" data-p2-osd="subtitles"></button>
      </div>
    </div>
  </div>
  <div class="p2-panel" hidden>
    <div class="p2-panel-title"></div>
    <div class="p2-panel-status" hidden></div>
    <div class="p2-panel-list"></div>
  </div>`;

export const OSD_ACTIONS = ["audio", "subtitles"];

export function createPlayerOsd(root, { title = "", subtitle = "" } = {}) {
  const q = (selector) => root.querySelector(selector);
  const el = q(".p2-osd");
  const refs = {
    clock: q(".p2-osd-clock"),
    fill: q(".p2-osd-fill"),
    seek: q(".p2-osd-seek"),
    state: q(".p2-osd-state"),
    time: q(".p2-osd-time"),
    ends: q(".p2-osd-ends"),
    actions: [...root.querySelectorAll("[data-p2-osd]")],
    panel: q(".p2-panel"),
    panelTitle: q(".p2-panel-title"),
    panelStatus: q(".p2-panel-status"),
    panelList: q(".p2-panel-list")
  };
  const actionLabels = {
    audio: t("audio_dialog_title", [], "Audio"),
    subtitles: t("subtitle_dialog_title", [], "Subtitles")
  };
  for (const button of refs.actions) button.textContent = actionLabels[button.dataset.p2Osd];
  q(".p2-osd-title").textContent = title;
  const subtitleNode = q(".p2-osd-subtitle");
  subtitleNode.textContent = subtitle;
  subtitleNode.hidden = !subtitle;
  const last = {};
  const write = (key, value, apply) => {
    if (last[key] === value) return;
    last[key] = value;
    apply(value);
  };
  const ratio = (seconds, duration) =>
    duration > 0 ? Math.round(Math.min(1, Math.max(0, seconds / duration)) * 1000) / 1000 : 0;

  return {
    el,
    /**
     * view: { visible, paused, current, duration, preview, action } (seconds; preview null when
     * none; action: index of the focused button, -1 when the focus is on the bar).
     */
    update({ visible, paused, current, duration, preview = null, action = -1 }) {
      write("visible", Boolean(visible), (value) => (el.hidden = !value));
      if (!visible) return;
      write("action", action, (value) =>
        refs.actions.forEach((button, index) => button.classList.toggle("focused", index === value))
      );
      const previewing = preview != null;
      const shown = previewing ? preview : current;
      write("fill", ratio(current, duration), (value) => {
        refs.fill.style.transform = `scaleX(${value})`;
      });
      write("seek", previewing ? ratio(preview, duration) : -1, (value) => {
        refs.seek.hidden = value < 0;
        if (value >= 0) refs.seek.style.transform = `scaleX(${value})`;
      });
      write("paused", Boolean(paused), (value) => el.classList.toggle("is-paused", value));
      write("state", previewing ? (preview < current ? "«" : "»") : "", (value) => {
        refs.state.textContent = value;
      });
      write(
        "time",
        `${formatTime(shown)} / ${duration > 0 ? formatTime(duration) : "--:--"}`,
        (value) => {
          refs.time.textContent = value;
        }
      );
      const nowMs = Date.now();
      write("clock", Math.floor(nowMs / 60000), () => {
        refs.clock.textContent = formatClock(new Date(nowMs));
      });
      // End time: rewritten only when its minute changes.
      const remainingMs = calculateRemainingPlaybackMilliseconds(shown, duration, 1);
      const endsAt = remainingMs == null ? null : nowMs + remainingMs;
      write("ends", endsAt == null ? -1 : Math.floor(endsAt / 60000), (minute) => {
        refs.ends.textContent =
          minute < 0 ? "" : t("player_ends_at", [formatClock(new Date(endsAt))], "Ends at %1$s");
      });
    },
    /**
     * Track panel, rebuilt on each call (short list, only while open). panel: null to hide, or
     * { title, status, items: [{ label, secondary, selected }], focus }.
     */
    renderPanel(panel) {
      refs.panel.hidden = !panel;
      if (!panel) return;
      refs.panelTitle.textContent = panel.title || "";
      refs.panelStatus.textContent = panel.status || "";
      refs.panelStatus.hidden = !panel.status;
      const rows = (panel.items || []).map((item, index) => {
        const row = document.createElement("div");
        row.className = "p2-panel-item";
        row.dataset.p2Item = String(index);
        row.classList.toggle("focused", index === panel.focus);
        row.classList.toggle("selected", Boolean(item.selected));
        const label = document.createElement("span");
        label.className = "p2-panel-label";
        label.textContent = item.label || "";
        row.appendChild(label);
        if (item.secondary) {
          const secondary = document.createElement("span");
          secondary.className = "p2-panel-secondary";
          secondary.textContent = item.secondary;
          row.appendChild(secondary);
        }
        return row;
      });
      refs.panelList.replaceChildren(...rows);
      rows[panel.focus]?.scrollIntoView?.({ block: "nearest" });
    }
  };
}
