// "Télécommande depuis le téléphone": the phone sends commands on the personal-space remote
// channel (ntfy SSE) and this TV answers with its playback state. Protocol v1, shared with
// the Android app (TvRemote.kt) and Docs/parite-plateformes.fr.md, "Télécommande".
import { PersoSpace } from "./persoSpace.js";
import { Router } from "../../ui/navigation/routerState.js";

const STATE_EVERY_MS = 15000;
const WATCH_EVERY_MS = 1000;
const MAX_AGE_MS = 60 * 1000;
const VOLUME_STEP = 0.1;

// key command value -> remote key (keyCode as sent by a VIDAA remote, key name for the normalizer)
export const REMOTE_KEYS = {
  0: { key: "ArrowUp", keyCode: 38 },
  1: { key: "ArrowDown", keyCode: 40 },
  2: { key: "ArrowLeft", keyCode: 37 },
  3: { key: "ArrowRight", keyCode: 39 },
  4: { key: "Enter", keyCode: 13 },
  5: { key: "GoBack", keyCode: 8 }
};

export function parseRemoteEvent(rawData, selfId, nowMs = Date.now()) {
  let event;
  try {
    event = JSON.parse(rawData);
  } catch (error) {
    return null;
  }
  if (!event || event.event !== "message" || typeof event.message !== "string") return null;
  let message;
  try {
    message = JSON.parse(event.message);
  } catch (error) {
    return null;
  }
  if (!message || message.v !== 1 || message.type !== "cmd" || typeof message.cmd !== "string") return null;
  if (selfId && message.from === selfId) return null;
  const at = Number(message.at);
  if (Number.isFinite(at) && nowMs - at > MAX_AGE_MS) return null;
  return message;
}

// Pure mapping from a command to what the adapter must do; null when unsupported.
export function planRemoteCommand(cmd, value, playerOpen) {
  const number = Number(value);
  switch (cmd) {
    case "ping":
      return { action: "state" };
    case "key":
      if (number === 6) return { action: "home" };
      return REMOTE_KEYS[number] ? { action: "key", ...REMOTE_KEYS[number] } : null;
    case "toggle":
    case "play":
    case "pause":
      return playerOpen ? { action: cmd } : null;
    case "seek":
      return playerOpen && Number.isFinite(number) ? { action: "seekBy", seconds: number / 1000 } : null;
    case "seekTo":
      return playerOpen && Number.isFinite(number) ? { action: "seekTo", seconds: Math.max(0, number / 1000) } : null;
    case "next":
    case "subs":
    case "audio":
    case "stop":
      return playerOpen ? { action: cmd } : null;
    case "volUp":
      return { action: "volume", delta: VOLUME_STEP };
    case "volDown":
      return { action: "volume", delta: -VOLUME_STEP };
    case "mute":
      return { action: "mute" };
    default:
      return null; // prev and unknown commands are not supported by the VIDAA player
  }
}

export function buildRemoteState(snapshot, config, nowMs = Date.now()) {
  const state = {
    v: 1,
    type: "state",
    from: config.deviceId,
    name: config.deviceName || "TV",
    device: "vidaa",
    at: nowMs,
    playing: Boolean(snapshot.playing)
  };
  if (snapshot.playing) {
    state.paused = Boolean(snapshot.paused);
    state.positionMs = Math.max(0, Math.round(Number(snapshot.positionSeconds || 0) * 1000));
    state.durationMs = Math.max(0, Math.round(Number(snapshot.durationSeconds || 0) * 1000));
    if (snapshot.title) state.title = String(snapshot.title);
    if (snapshot.subtitle) state.subtitle = String(snapshot.subtitle);
    if (snapshot.poster) state.poster = String(snapshot.poster);
  }
  if (Number.isFinite(snapshot.volume)) state.volume = Math.round(snapshot.volume * 100);
  state.muted = Boolean(snapshot.muted);
  return state;
}

// Publishes again when something a phone shows has changed (not on every clock tick).
export function stateSignature(state, expectedPositionMs = null) {
  const jumped = expectedPositionMs != null && Math.abs(Number(state.positionMs || 0) - expectedPositionMs) > 3000;
  return [state.playing, state.paused, state.title, state.subtitle, state.volume, state.muted, jumped ? state.positionMs : ""].join("|");
}

// ---- Adapter to the live app ----

function currentPlayer() {
  if (Router.current !== "player") return null;
  return Router.getCurrentScreen?.() || null;
}

function videoElement(screen) {
  return screen?.container?.querySelector?.("#videoPlayer") || document.querySelector?.("#videoPlayer") || null;
}

function snapshot() {
  const screen = currentPlayer();
  const video = videoElement(screen);
  if (!screen) {
    return { playing: false, volume: video ? video.volume : NaN, muted: Boolean(video?.muted) };
  }
  const params = screen.params || {};
  const season = params.season;
  const episode = params.episode;
  const episodeCode = season != null && episode != null ? `S${season} E${episode}` : "";
  return {
    playing: true,
    paused: Boolean(screen.paused),
    positionSeconds: typeof screen.getPlaybackCurrentSeconds === "function" ? screen.getPlaybackCurrentSeconds() : video?.currentTime,
    durationSeconds: typeof screen.getPlaybackDurationSeconds === "function" ? screen.getPlaybackDurationSeconds() : video?.duration,
    title: params.playerTitle || params.itemTitle || params.title || "",
    subtitle: [episodeCode, params.playerEpisodeTitle || params.episodeTitle || ""].filter(Boolean).join(" · ") || params.playerSubtitle || "",
    poster: params.playerPosterUrl || params.poster || params.playerBackdropUrl || "",
    volume: video ? video.volume : NaN,
    muted: Boolean(video?.muted)
  };
}

export function simulateRemoteKey(key, keyCode, target = document) {
  ["keydown", "keyup"].forEach((type) => {
    let event;
    try {
      event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    } catch (error) {
      event = document.createEvent("Event");
      event.initEvent(type, true, true);
      Object.defineProperty(event, "key", { get: () => key });
    }
    // KeyboardEvent ignores keyCode in its init dictionary; the focus engine reads it.
    Object.defineProperty(event, "keyCode", { get: () => keyCode });
    Object.defineProperty(event, "which", { get: () => keyCode });
    target.dispatchEvent(event);
  });
}

function applyPlan(plan) {
  const screen = currentPlayer();
  switch (plan.action) {
    case "key":
      simulateRemoteKey(plan.key, plan.keyCode);
      return;
    case "home":
      Router.navigate("home");
      return;
    case "toggle":
    case "play":
    case "pause":
      screen?.applyMediaAction?.(plan.action);
      screen?.renderControlButtons?.();
      return;
    case "seekBy": {
      const current = Number(screen?.getPlaybackCurrentSeconds?.() || 0);
      const duration = Number(screen?.getPlaybackDurationSeconds?.() || 0);
      const target = Math.max(0, current + plan.seconds);
      screen?.seekPlaybackSeconds?.(duration > 0 ? Math.min(target, duration) : target);
      return;
    }
    case "seekTo":
      screen?.seekPlaybackSeconds?.(plan.seconds);
      return;
    case "next":
      if (screen?.resolveNextEpisodeInfo?.()) void screen.playNextEpisode?.({ userInitiated: true });
      return;
    case "subs":
      if (screen?.subtitleDialogVisible) screen.closeSubtitleDialog?.();
      else screen?.openSubtitleDialog?.();
      return;
    case "audio": {
      const entries = screen?.getAudioEntries?.() || [];
      if (entries.length < 2) {
        screen?.openAudioDialog?.();
        return;
      }
      const current = entries.findIndex((entry) => entry.selected);
      void screen.applyAudioTrack?.((current + 1) % entries.length, { rememberSelection: true });
      return;
    }
    case "stop":
      if (!screen?.navigateBackToStreamScreen?.({ forceDetail: true })) Router.back();
      return;
    case "volume": {
      const video = videoElement(screen);
      if (video) video.volume = Math.min(1, Math.max(0, Number(video.volume || 0) + plan.delta));
      return;
    }
    case "mute": {
      const video = videoElement(screen);
      if (video) video.muted = !video.muted;
      return;
    }
    default:
  }
}

let source = null;
let currentTopic = "";
let watchTimer = null;
let lastSignature = "";
let lastPublishedAt = 0;
let lastState = null;

function publish(state) {
  const config = PersoSpace.get();
  if (!currentTopic || typeof fetch !== "function") return;
  lastSignature = stateSignature(state);
  lastPublishedAt = Date.now();
  lastState = state;
  fetch(`${config.server.replace(/\/+$/, "")}/${currentTopic}`, { method: "POST", body: JSON.stringify(state) }).catch(() => {});
}

function publishNow() {
  publish(buildRemoteState(snapshot(), PersoSpace.get()));
}

function watch() {
  const state = buildRemoteState(snapshot(), PersoSpace.get());
  let expected = null;
  if (lastState?.playing && state.playing && !lastState.paused) expected = Number(lastState.positionMs || 0) + (Date.now() - lastPublishedAt);
  else if (lastState?.playing && state.playing) expected = Number(lastState.positionMs || 0);
  const changed = stateSignature(state, expected) !== lastSignature;
  const due = state.playing && !state.paused && Date.now() - lastPublishedAt >= STATE_EVERY_MS;
  if (changed || due) publish(state);
}

export const TvRemoteReceiver = {
  start() {
    const config = PersoSpace.get();
    if (!config.spaceCode || !config.remoteControl || typeof EventSource === "undefined") {
      this.stop();
      return;
    }
    if (!config.deviceId) PersoSpace.set({});
    const topic = PersoSpace.remoteTopic(config.spaceCode);
    if (source && topic === currentTopic) return;
    this.stop();
    currentTopic = topic;
    source = new EventSource(`${config.server.replace(/\/+$/, "")}/${topic}/sse`);
    source.onopen = () => publishNow();
    source.onmessage = (event) => {
      const message = parseRemoteEvent(event.data, PersoSpace.get().deviceId);
      if (!message) return;
      const plan = planRemoteCommand(message.cmd, message.value, Boolean(currentPlayer()));
      if (!plan) return;
      try {
        if (plan.action !== "state") applyPlan(plan);
      } catch (error) {
        console.warn("Remote command failed", message.cmd, error);
      }
      // Let the player settle before reporting.
      setTimeout(publishNow, plan.action === "state" ? 0 : 400);
    };
    watchTimer = setInterval(watch, WATCH_EVERY_MS);
  },
  stop() {
    if (source) source.close();
    if (watchTimer) clearInterval(watchTimer);
    source = null;
    watchTimer = null;
    currentTopic = "";
    lastSignature = "";
    lastState = null;
  },
  restart() {
    this.stop();
    this.start();
  }
};
