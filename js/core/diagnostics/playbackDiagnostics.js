/* global __NUVIO_APP_VERSION__ */
// Playback failure diagnostics on the TV: every failed source (startup error, stall, refused
// play, restricted headers) is recorded with what the TV knows about it, kept on the TV and
// sent to the personal space reports so failures can be analysed without the TV at hand.
// Links are never stored whole: debrid and addon URLs carry account keys.
import { PersoSpace } from "../perso/persoSpace.js";
import { PersoCloud } from "../perso/persoCloud.js";

const STORAGE_KEY = "nuvio.perso.playbackFailures";
const MAX_ENTRIES = 40;
const DUPLICATE_WINDOW_MS = 3000;
const APP_VERSION = typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0";

/** Scheme, host and extension of a link; path, query and keys are dropped. */
export function describeUrl(url) {
  const text = String(url || "").trim();
  if (!text) return { scheme: "", host: "", ext: "" };
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i.exec(text);
  if (!match) return { scheme: text.split(":")[0].slice(0, 12), host: "", ext: "" };
  const path = match[3] || "";
  const last = path.split("/").pop() || "";
  const ext = /\.([a-z0-9]{2,5})$/i.exec(last)?.[1]?.toLowerCase() || "";
  // Credentials in the authority (user:pass@host) are removed too.
  return {
    scheme: match[1].toLowerCase(),
    host: match[2].replace(/^[^@]*@/, "").slice(0, 80),
    ext
  };
}

const PROBED_TYPES = {
  hevc: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
  av1: 'video/mp4; codecs="av01.0.12M.10"',
  dolbyVision: 'video/mp4; codecs="dvh1.08.06"',
  h264: 'video/mp4; codecs="avc1.640033"',
  mkv: "video/x-matroska",
  webm: 'video/webm; codecs="vp9"',
  eac3: 'audio/mp4; codecs="ec-3"',
  ac3: 'audio/mp4; codecs="ac-3"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  dts: 'audio/mp4; codecs="dtsc"',
  truehd: 'audio/mp4; codecs="mlpa"',
  opus: 'audio/mp4; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"'
};
let capabilitiesCache = null;

/** canPlayType / MediaSource answers of this TV, measured once. */
export function playbackCapabilities(
  doc = globalThis.document,
  mediaSource = globalThis.MediaSource
) {
  if (capabilitiesCache) return capabilitiesCache;
  const result = {};
  let video = null;
  try {
    video = doc?.createElement?.("video") || null;
  } catch (_error) {
    video = null;
  }
  for (const [name, type] of Object.entries(PROBED_TYPES)) {
    let play = "";
    let mse = null;
    try {
      play = video?.canPlayType?.(type) || "";
    } catch (_error) {
      play = "";
    }
    try {
      mse =
        typeof mediaSource?.isTypeSupported === "function"
          ? Boolean(mediaSource.isTypeSupported(type))
          : null;
    } catch (_error) {
      mse = null;
    }
    result[name] = mse == null ? play || "no" : `${play || "no"}/${mse ? "mse" : "no-mse"}`;
  }
  capabilitiesCache = result;
  return result;
}

/** Codecs and container announced by the source name or filename (release naming). */
export function announcedFormat(candidate) {
  const text = [
    candidate?.name,
    candidate?.title,
    candidate?.raw?.behaviorHints?.filename,
    candidate?.raw?.title
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tags = [];
  const rules = [
    ["2160p", /2160p|\b4k\b|uhd/],
    ["1080p", /1080p/],
    ["hevc", /hevc|x265|h\.?265/],
    ["av1", /\bav1\b/],
    ["h264", /x264|h\.?264|avc/],
    ["dolby-vision", /\bdv\b|dovi|dolby.?vision/],
    ["hdr", /hdr/],
    ["truehd", /truehd/],
    ["atmos", /atmos/],
    ["dts", /\bdts/],
    ["eac3", /e-?ac-?3|ddp|dd\+/],
    ["ac3", /\bac-?3\b|\bdd5|\bdd 5/],
    ["remux", /remux/],
    ["mkv", /\.mkv|\bmkv\b/]
  ];
  for (const [tag, pattern] of rules) if (pattern.test(text)) tags.push(tag);
  return tags;
}

function readEntries(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

export function createPlaybackDiagnostics(deps = {}) {
  const storage = deps.storage || globalThis.localStorage;
  const cloud = deps.cloud || PersoCloud;
  const space = deps.space || PersoSpace;
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((...args) => globalThis.console?.warn?.(...args));
  let last = null;

  async function upload(entry) {
    const config = space.get?.() || {};
    if (!config.spaceCode || !cloud?.available || typeof cloud.sendReport !== "function")
      return false;
    try {
      const id = await cloud.spaceId(config.spaceCode, "space", {
        name: config.deviceName || "TV",
        device: "vidaa"
      });
      if (!id) return false;
      return await cloud.sendReport(id, {
        app_version: APP_VERSION,
        device: "vidaa",
        os: String(globalThis.navigator?.userAgent || "").slice(0, 80),
        kind: "error",
        message: `playback: ${entry.reason || "error"} · ${entry.title || ""}`.slice(0, 2000),
        context: entry
      });
    } catch (_error) {
      return false;
    }
  }

  return {
    /** Records one failed source. Repeats of the same source within a few seconds are merged. */
    record(entry) {
      const at = now();
      const key = `${entry.source?.host}|${entry.source?.name}|${entry.title}`;
      if (last && last.key === key && at - last.at < DUPLICATE_WINDOW_MS) {
        // Keep the richer of the two (the startup error carries the media error detail).
        if (!entry.details?.length) return null;
      }
      last = { key, at };
      const full = {
        v: 1,
        at,
        app: APP_VERSION,
        page: globalThis.location?.protocol || "",
        ...entry
      };
      const entries = readEntries(storage).slice(-(MAX_ENTRIES - 1));
      entries.push(full);
      try {
        storage?.setItem?.(STORAGE_KEY, JSON.stringify(entries));
      } catch (_error) {
        // Full storage: the report still goes to the console and the personal space.
      }
      log(
        "[Diagnostic lecture]",
        full.reason,
        full.title,
        `${full.source?.scheme}://${full.source?.host} .${full.source?.ext}`,
        full.engine,
        full.mediaError
          ? `MediaError ${full.mediaError.code} ${full.mediaError.message || ""}`
          : "",
        (full.details || []).join(" | ")
      );
      void upload(full);
      return full;
    },
    list() {
      return readEntries(storage);
    },
    clear() {
      try {
        storage?.removeItem?.(STORAGE_KEY);
      } catch (_error) {
        // Nothing to clear.
      }
    }
  };
}

export const PlaybackDiagnostics = createPlaybackDiagnostics();

/** Entry built from the player screen state for the source that just failed. */
export function playbackFailureEntry(
  screen,
  {
    candidate = null,
    playbackUrl = "",
    reason = "",
    details = null,
    mediaErrorCode = 0,
    video = null,
    engine = ""
  } = {}
) {
  const params = screen?.params || {};
  const url = playbackUrl || candidate?.url || screen?.activePlaybackUrl || "";
  const error = video?.error || null;
  return {
    reason: String(reason || "error").slice(0, 60),
    title: String(params.playerTitle || params.itemTitle || "").slice(0, 120),
    episode: String(params.playerSubtitle || "").slice(0, 20),
    itemId: String(params.itemId || "").slice(0, 40),
    source: {
      ...describeUrl(url),
      name: String(candidate?.name || "").slice(0, 80),
      addon: String(candidate?.addonName || "").slice(0, 60),
      handoff: String(candidate?.id || "").startsWith("handoff:"),
      headers: Boolean(
        candidate?.behaviorHints?.proxyHeaders || candidate?.raw?.behaviorHints?.proxyHeaders
      ),
      notWebReady: Boolean(
        candidate?.raw?.behaviorHints?.notWebReady || candidate?.behaviorHints?.notWebReady
      ),
      announced: announcedFormat(candidate)
    },
    engine: String(engine || "").slice(0, 30),
    mediaError:
      error || mediaErrorCode
        ? {
            code: Number(error?.code || mediaErrorCode || 0),
            message: String(error?.message || "").slice(0, 200)
          }
        : null,
    video: video
      ? {
          networkState: video.networkState,
          readyState: video.readyState,
          currentTime: Math.round(Number(video.currentTime || 0))
        }
      : null,
    candidates: Array.isArray(screen?.streamCandidates) ? screen.streamCandidates.length : 0,
    details: Array.isArray(details)
      ? details
          .map((line) =>
            String(line)
              .replace(/https?:\/\/\S+/g, (link) => {
                const d = describeUrl(link);
                return `${d.scheme}://${d.host}/…`;
              })
              .slice(0, 200)
          )
          .slice(0, 20)
      : [],
    capabilities: playbackCapabilities()
  };
}
