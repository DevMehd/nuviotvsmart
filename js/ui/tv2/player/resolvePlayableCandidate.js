import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import {
  MediaServerRepository,
  canResolveMediaServerStream
} from "../../../data/mediaserver/mediaServerRepository.js";
import { getStandaloneWebPlaybackCompatibility } from "../../../core/player/webPlaybackHeaders.js";
import { isExpiredStreamUrl } from "../../../core/player/hlsNetworkErrorPolicy.js";
import { newerServerResume } from "../../../data/mediaserver/mediaServerUserState.js";
import { WatchProgressStore } from "../../../data/local/watchProgressStore.js";

// shortcut: duplicates playerScreenMethods-35:22-120 (media server with its resume, debrid)
// without P2P (not on VIDAA); merge if the old player is retired.

export function directPlaybackUrl(value = "") {
  const url = String(value || "").trim();
  return url && !url.toLowerCase().startsWith("magnet:") ? url : "";
}

export function streamDirectPlaybackUrl(stream = {}) {
  return directPlaybackUrl(stream?.url) || directPlaybackUrl(stream?.externalUrl);
}

/** Initial source: preferredStreamId, else the route's link, else the first, else a synthetic one. */
export function pickInitialCandidate(params = {}) {
  const candidates = Array.isArray(params.streamCandidates)
    ? params.streamCandidates.filter(Boolean)
    : [];
  const preferredId = String(params.preferredStreamId || "").trim();
  const routeUrl = String(params.streamUrl || "").trim();
  // shortcut: no copy of the old selectBestStreamCandidate scoring; every caller passes
  // preferredStreamId or streamUrl (rg navigate("player")). Copy it if a caller stops doing so.
  return (
    (preferredId && candidates.find((stream) => String(stream?.id || "") === preferredId)) ||
    (routeUrl &&
      candidates.find((stream) => stream.url === routeUrl || stream.externalUrl === routeUrl)) ||
    (routeUrl ? null : candidates[0]) ||
    (routeUrl
      ? { url: routeUrl, title: "Current source", addonName: "Current", isSynthetic: true }
      : null)
  );
}

function requestHeaders(stream) {
  const hints = stream?.raw?.behaviorHints || stream?.behaviorHints || {};
  return {
    headers: hints.proxyHeaders?.request || null,
    notWebReady: hints.notWebReady ?? stream?.behaviorHints?.notWebReady
  };
}

function isHls(url, stream) {
  const type = String(stream?.mimeType || stream?.sourceType || "").toLowerCase();
  return /\.m3u8(?:$|[?#])/i.test(url) || type.includes("mpegurl");
}

/**
 * Playable link of a source: { url, serverResumeMs? } or { errorKey, fallback } (message key for
 * the error screen). serverResumeMs: the media server's position when newer than the local one.
 * isCurrent() guards every await: a stale answer is dropped by the caller.
 */
export async function resolvePlayableCandidate(
  stream,
  { params = {}, isCurrent = () => true } = {}
) {
  if (!stream)
    return { errorKey: "player_error_no_stream_url", fallback: "No stream URL provided" };
  let url = streamDirectPlaybackUrl(stream);
  let serverResumeMs = 0;
  if (canResolveMediaServerStream(stream)) {
    const result = await MediaServerRepository.resolve(stream).catch(() => null);
    if (!isCurrent()) return null;
    if (result?.status !== "success" || !result.stream?.url)
      return {
        errorKey: "servers_playback_failed",
        fallback: "Could not start playback from the server."
      };
    Object.assign(stream, result.stream);
    url = result.stream.url;
    const saved = WatchProgressStore.listForProfile(result.stream.serverPlayback?.profileId).find(
      (entry) =>
        entry.contentId === params.itemId &&
        (entry.season ?? null) === (params.season ?? null) &&
        (entry.episode ?? null) === (params.episode ?? null)
    );
    serverResumeMs =
      newerServerResume(result.stream.serverUserState, saved, params.startFromBeginning)
        ?.positionMs || 0;
  }
  if (!url) {
    const context = {
      season: params.season == null ? null : Number(params.season),
      episode: params.episode == null ? null : Number(params.episode)
    };
    if (!DirectDebridResolver.canResolveStream(stream, context))
      return { errorKey: "player_error_playback_fallback", fallback: "Playback error" };
    const result = await DirectDebridResolver.resolve(stream, context).catch(() => null);
    if (!isCurrent()) return null;
    if (result?.status !== "success" || !result.stream?.url) {
      const status = result?.status;
      return status === "service_degraded"
        ? {
            errorKey: "stream.debrid.serviceDegraded",
            fallback:
              "The Debrid service is currently degraded. Try again later or choose another source."
          }
        : status === "not_cached"
          ? { errorKey: "stream.debrid.notCached", fallback: "Not cached on this service." }
          : status === "stale"
            ? {
                errorKey: "stream.debrid.stale",
                fallback: "This Debrid result expired. Refreshing streams."
              }
            : {
                errorKey: "stream.debrid.failed",
                fallback: "Could not resolve this Debrid stream."
              };
    }
    url = result.stream.url;
    Object.assign(stream, {
      url,
      externalUrl: null,
      mimeType: result.stream.mimeType || stream.mimeType,
      sourceType: result.stream.sourceType || stream.sourceType,
      behaviorHints: result.stream.behaviorHints || stream.behaviorHints
    });
  }
  if (isExpiredStreamUrl(url))
    return {
      errorKey: "player_error_stream_expired",
      fallback: "The stream link has expired. Try a different source."
    };
  const { headers, notWebReady } = requestHeaders(stream);
  const compatibility = getStandaloneWebPlaybackCompatibility(headers || {}, notWebReady, {
    playbackUrl: url
  });
  // A <video> sends no custom header; HLS with headers waits for hls.js (P5).
  if (!compatibility.compatible || (isHls(url, stream) && compatibility.declaredHeaderNames.length))
    return {
      errorKey: "player_error_vidaa_standalone_unsupported",
      fallback:
        "This source requires network features that are not available on this device. Try a different source."
    };
  return serverResumeMs > 0 ? { url, serverResumeMs } : { url };
}
