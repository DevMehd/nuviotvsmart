// "Continuer sur la TV" receiver: listens on the personal-space hand-off channel (ntfy SSE)
// and offers to resume what the phone was playing. Protocol v1: Docs/parite-plateformes.fr.md.
import { PersoSpace } from "./persoSpace.js";
import { Router } from "../../ui/navigation/routerState.js";
import { showHandoffPrompt } from "../../ui/components/handoffPrompt.js";

const MAX_AGE_MS = 10 * 60 * 1000;
let source = null;
let currentTopic = "";
const seen = new Set();

export function parseHandoffEvent(rawData, nowMs = Date.now()) {
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
    if (!config.spaceCode || !config.receiveHandoff || typeof EventSource === "undefined") {
      this.stop();
      return;
    }
    const topic = PersoSpace.handoffTopic(config.spaceCode);
    if (source && topic === currentTopic) return;
    this.stop();
    currentTopic = topic;
    source = new EventSource(`${config.server.replace(/\/+$/, "")}/${topic}/sse`);
    source.onmessage = (event) => {
      const message = parseHandoffEvent(event.data);
      if (!message) return;
      const key = `${message.from}:${message.at}`;
      if (seen.has(key)) return;
      seen.add(key);
      showHandoffPrompt(message, () => openFromHandoff(message));
    };
  },
  stop() {
    if (source) source.close();
    source = null;
    currentTopic = "";
  },
  restart() {
    this.stop();
    this.start();
  }
};
