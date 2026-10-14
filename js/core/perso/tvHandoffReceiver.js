// "Continuer sur la TV" receiver: listens on the personal-space hand-off channel (secure
// backend, ntfy as fallback) and offers to resume what the phone was playing.
// Protocol v1: Docs/parite-plateformes.fr.md.
import { PersoSpace } from "./persoSpace.js";
import { PersoChannels, ntfyMessageText } from "./persoChannels.js";
import { Router } from "../../ui/navigation/routerState.js";
import { showHandoffPrompt } from "../../ui/components/handoffPrompt.js";

const MAX_AGE_MS = 10 * 60 * 1000;
const CHANNEL = "handoff";
let currentCode = "";
const seen = new Set();

/** ntfy SSE event data → hand-off message (kept for the ntfy fallback and its tests). */
export function parseHandoffEvent(rawData, nowMs = Date.now()) {
  const text = ntfyMessageText(rawData);
  return text == null ? null : parseHandoffMessage(text, nowMs);
}

/** Message JSON text (backend payload or ntfy message) → hand-off message, or null. */
export function parseHandoffMessage(text, nowMs = Date.now()) {
  let message;
  try {
    message = typeof text === "string" ? JSON.parse(text) : text;
  } catch (_error) {
    return null;
  }
  if (!message || message.v !== 1 || message.type !== "handoff" || !message.media) return null;
  if (!Number.isFinite(Number(message.at)) || nowMs - Number(message.at) > MAX_AGE_MS) return null;
  return message;
}

export function playerParamsFromHandoff(message) {
  const media = message.media;
  const isSeries = media.type === "series";
  const base = {
    itemId: media.id,
    itemType: media.type || "movie",
    videoId: media.videoId || null,
    season: media.seasonNumber ?? null,
    episode: media.episodeNumber ?? null,
    playerTitle: media.title || "Nuvio",
    playerSubtitle: isSeries && media.seasonNumber != null ? `S${media.seasonNumber}E${media.episodeNumber}` : "",
    playerBackdropUrl: message.background || media.poster || null,
    resumePositionMs: Number(message.positionMs || 0) || 0,
    startFromBeginning: false,
    returnToStreamOnBack: false,
    returnToHomeOnBack: true
  };
  if (!message.sourceUrl) return null;
  const streamId = `handoff:${media.videoId || media.id}`;
  return {
    ...base,
    streamUrl: message.sourceUrl,
    preferredStreamId: streamId,
    streamCandidates: [
      {
        id: streamId,
        url: message.sourceUrl,
        name: message.name || "Nuvio",
        title: media.title,
        behaviorHints: message.sourceHeaders && Object.keys(message.sourceHeaders).length
          ? { proxyHeaders: { request: message.sourceHeaders } }
          : {}
      }
    ]
  };
}

function openFromHandoff(message) {
  const params = playerParamsFromHandoff(message);
  if (params) {
    Router.navigate("player", params);
    return;
  }
  const media = message.media;
  Router.navigate("detail", {
    itemId: media.id,
    itemType: media.type || "movie",
    fallbackTitle: media.title || media.id,
    autoOpenContinueWatching: true,
    resumeProgressMs: Number(message.positionMs || 0) || 0,
    resumeVideoId: media.videoId || null,
    resumeSeason: media.seasonNumber ?? null,
    resumeEpisode: media.episodeNumber ?? null,
    returnHomeOnBack: true
  });
}

export const TvHandoffReceiver = {
  start() {
    const config = PersoSpace.get();
    if (!config.spaceCode || !config.receiveHandoff) {
      this.stop();
      return;
    }
    if (currentCode === config.spaceCode && PersoChannels.mode(CHANNEL)) return;
    currentCode = config.spaceCode;
    void PersoChannels.connect({
      channel: CHANNEL,
      kind: "handoff",
      code: config.spaceCode,
      ntfyTopic: PersoSpace.handoffTopic(config.spaceCode),
      server: config.server,
      member: { name: config.deviceName || "TV", device: "vidaa" },
      onMessage: (text) => {
        const message = parseHandoffMessage(text);
        if (!message) return;
        const key = `${message.from}:${message.at}`;
        if (seen.has(key)) return;
        seen.add(key);
        showHandoffPrompt(message, () => openFromHandoff(message));
      }
    });
  },
  stop() {
    PersoChannels.disconnect(CHANNEL);
    currentCode = "";
  },
  restart() {
    this.stop();
    this.start();
  }
};
