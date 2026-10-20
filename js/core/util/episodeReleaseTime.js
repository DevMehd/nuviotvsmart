/**
 * Episode release instants, shared by the calendar, Continue Watching, the player and the detail
 * screen. Port of the mobile rule (Docs: parite-plateformes.fr.md#nuv-087,
 * EpisodeReleaseDateParser.kt and EpisodeReleaseTimes.kt).
 *
 * A release without a time — a plain "YYYY-MM-DD" or the same date at midnight UTC — is a US air
 * date. Streaming releases of that date reach Europe during the following night, so it counts as
 * released DATE_ONLY_RELEASE_DELAY_MS after midnight UTC (02:00 UTC the next day). A real time
 * (zoned or not) keeps its exact instant. TVmaze `airstamp` replaces bare dates of recent and
 * upcoming episodes when it carries a real air time (no Trakt here: no key on a public site).
 */

import { LocalStore } from "../storage/localStore.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const DATE_ONLY_RELEASE_DELAY_MS = 26 * HOUR_MS;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ZONED =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const EMBEDDED_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function dateOnlyInstant(match) {
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!validDate(year, month, day)) return null;
  return { ms: Date.UTC(year, month - 1, day) + DATE_ONLY_RELEASE_DELAY_MS, exact: false };
}

function timeParts(match) {
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const millis = Number(
    String(match[7] || "0")
      .padEnd(3, "0")
      .slice(0, 3)
  );
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second, millis };
}

/**
 * The release instant of an episode and whether its time is real.
 * @returns {{ ms: number, exact: boolean } | null}
 */
export function parseEpisodeReleaseInstant(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? { ms: raw, exact: true } : null;
  const value = String(raw ?? "").trim();
  if (!value) return null;
  let match = value.match(DATE_ONLY);
  if (match) return dateOnlyInstant(match);
  match = value.match(ZONED);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const time = timeParts(match);
    if (!time || !validDate(year, month, day)) return null;
    const zone = match[8].toUpperCase();
    let offsetMs = 0;
    if (zone !== "Z") {
      const digits = zone.slice(1).replace(":", "");
      offsetMs =
        (zone[0] === "-" ? -1 : 1) *
        (Number(digits.slice(0, 2)) * HOUR_MS + Number(digits.slice(2)) * 60_000);
    }
    const ms =
      Date.UTC(year, month - 1, day, time.hour, time.minute, time.second, time.millis) - offsetMs;
    // Midnight UTC is a bare date in disguise.
    if (ms % DAY_MS === 0) return { ms: ms + DATE_ONLY_RELEASE_DELAY_MS, exact: false };
    return { ms, exact: true };
  }
  match = value.match(LOCAL);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const time = timeParts(match);
    if (!time || !validDate(year, month, day)) return null;
    const ms = new Date(
      year,
      month - 1,
      day,
      time.hour,
      time.minute,
      time.second,
      time.millis
    ).getTime();
    return {
      ms,
      exact: time.hour !== 0 || time.minute !== 0 || time.second !== 0 || time.millis !== 0
    };
  }
  match = value.match(EMBEDDED_DATE);
  return match ? dateOnlyInstant(match) : null;
}

export function episodeReleaseEpochMs(raw) {
  return parseEpisodeReleaseInstant(raw)?.ms ?? null;
}

/** true/false once the release instant is known, null when the value has no date. */
export function hasEpisodeReleaseAired(raw, nowMs = Date.now()) {
  const ms = episodeReleaseEpochMs(raw);
  return ms == null ? null : ms <= Number(nowMs);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function localIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The viewer's local calendar date of the release, "YYYY-MM-DD". */
export function episodeReleaseLocalDate(raw) {
  const ms = episodeReleaseEpochMs(raw);
  return ms == null ? null : localIsoDate(new Date(ms));
}

/** A Date at local midnight of the release day, for date labels. */
export function episodeReleaseLocalDay(raw) {
  const ms = episodeReleaseEpochMs(raw);
  if (ms == null) return null;
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local "HH:mm" when the release time is real, null for a bare date. */
export function episodeReleaseLocalTime(raw) {
  const instant = parseEpisodeReleaseInstant(raw);
  if (!instant?.exact) return null;
  const date = new Date(instant.ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Calendar days between today and the local release day (0 = today), null without a date. */
export function daysUntilEpisodeRelease(raw, nowMs = Date.now()) {
  const day = episodeReleaseLocalDay(raw);
  if (!day) return null;
  const now = new Date(nowMs);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - today) / DAY_MS);
}

/** "Demain · 03:00" style label when the time is known. */
export function withEpisodeReleaseTime(label, raw) {
  const time = episodeReleaseLocalTime(raw);
  return label && time ? `${label} · ${time}` : label;
}

// --- TVmaze enrichment ------------------------------------------------------------------

const STORAGE_KEY = "nuvio_episode_release_times_v1";
const TTL_MS = 6 * HOUR_MS;
const MAX_SHOWS = 100;
export const RELEASE_TIMES_LIMITS = Object.freeze({
  lookBackMs: 10 * DAY_MS,
  lookAheadMs: 60 * DAY_MS,
  timeoutMs: 4000
});

/** True when some episode was released recently or is due soon, worth an exact time. */
export function needsReleaseTimes(videos, nowMs = Date.now()) {
  return (Array.isArray(videos) ? videos : []).some((video) => {
    if (!(Number(video?.season) > 0)) return false;
    const ms = episodeReleaseEpochMs(video?.released);
    return (
      ms != null &&
      ms >= nowMs - RELEASE_TIMES_LIMITS.lookBackMs &&
      ms <= nowMs + RELEASE_TIMES_LIMITS.lookAheadMs
    );
  });
}

/** TVmaze episodes → { "season:episode": epochMs }, only with a real `airtime`. */
export function parseTvMazeEpisodes(episodes) {
  const times = {};
  (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
    const season = Number(episode?.season);
    const number = Number(episode?.number);
    if (!Number.isInteger(season) || !Number.isInteger(number)) return;
    if (!String(episode?.airtime || "").trim()) return;
    const instant = parseEpisodeReleaseInstant(episode?.airstamp);
    if (instant?.exact) times[`${season}:${number}`] = instant.ms;
  });
  return times;
}

/** Copy of meta whose matching episodes carry the exact instant as an ISO UTC string. */
export function applyEpisodeReleaseTimes(meta, times) {
  if (!meta || !Array.isArray(meta.videos) || !times || !Object.keys(times).length) return meta;
  let changed = false;
  const videos = meta.videos.map((video) => {
    const ms = times[`${video?.season}:${video?.episode}`];
    if (!Number.isFinite(ms)) return video;
    const iso = new Date(ms).toISOString();
    if (iso === video.released) return video;
    changed = true;
    return { ...video, released: iso };
  });
  return changed ? { ...meta, videos } : meta;
}

function imdbIdOf(meta, fallbackId) {
  for (const candidate of [meta?.imdb_id, meta?.imdbId, meta?.id, fallbackId]) {
    const id = String(candidate || "").split(":")[0];
    if (/^tt\d+$/.test(id)) return id;
  }
  return "";
}

const memory = new Map();

function readStore(storage) {
  const stored = storage?.get?.(STORAGE_KEY, {});
  return stored && typeof stored === "object" ? stored : {};
}

async function fetchJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  if (!response?.ok) throw new Error(`TVmaze ${response?.status}`);
  return response.json();
}

/**
 * Replaces bare release dates of recent and upcoming episodes with TVmaze's exact air time.
 * Never throws and never waits more than RELEASE_TIMES_LIMITS.timeoutMs: the meta is returned
 * unchanged when TVmaze is unreachable or has no time.
 */
export async function enrichEpisodeReleaseTimes(meta, fallbackId = "", deps = {}) {
  try {
    const now = (deps.now || Date.now)();
    if (!meta || !needsReleaseTimes(meta.videos, now)) return meta;
    const imdbId = imdbIdOf(meta, fallbackId);
    if (!imdbId) return meta;
    const storage = deps.storage === undefined ? LocalStore : deps.storage;
    const cachedEntry = memory.get(imdbId) || readStore(storage)[imdbId];
    if (cachedEntry && now - Number(cachedEntry.at || 0) < TTL_MS) {
      return applyEpisodeReleaseTimes(meta, cachedEntry.times);
    }
    const fetchImpl = deps.fetch || globalThis.fetch;
    if (typeof fetchImpl !== "function") return meta;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error("TVmaze timeout"));
      }, deps.timeoutMs ?? RELEASE_TIMES_LIMITS.timeoutMs);
    });
    let times;
    try {
      times = await Promise.race([
        (async () => {
          const show = await fetchJson(
            fetchImpl,
            `https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`,
            controller?.signal
          );
          if (!Number.isInteger(show?.id)) return {};
          const episodes = await fetchJson(
            fetchImpl,
            `https://api.tvmaze.com/shows/${show.id}/episodes`,
            controller?.signal
          );
          return parseTvMazeEpisodes(episodes);
        })(),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
    const entry = { at: now, times };
    memory.set(imdbId, entry);
    if (storage?.set) {
      const store = { ...readStore(storage), [imdbId]: entry };
      const keys = Object.keys(store).sort((a, b) => Number(store[a].at) - Number(store[b].at));
      while (keys.length > MAX_SHOWS) delete store[keys.shift()];
      storage.set(STORAGE_KEY, store);
    }
    return applyEpisodeReleaseTimes(meta, times);
  } catch (_) {
    return meta;
  }
}

/** Test hook: forget cached TVmaze times. */
export function resetEpisodeReleaseTimesCache() {
  memory.clear();
}
