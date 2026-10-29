import { PlayerController } from "../../../core/player/playerController.js";
import {
  isShortPlaceholderDuration,
  shouldTreatAsNaturalPlaybackCompletion
} from "../../../core/player/naturalPlaybackCompletion.js";
import { TrackingScrobbleService } from "../../../data/repository/trackingScrobbleService.js";
import { MediaServerScrobbleService } from "../../../data/mediaserver/mediaServerScrobbleService.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";
import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";
import { WatchJournal } from "../../../core/perso/watchJournal.js";

// New VIDAA player (lot P, P2): resume, progress, Trakt/Simkl/media server scrobble and the
// personal journal. Persistence is not rewritten: PlayerController.flushProgress takes an
// explicit context, so the records keep the old player's shape, thresholds and moments.
// shortcut: the context and scrobble builders copy playerScreenMethods-06/07 and
// PlayerController.createProgressContext (importing them pulls the old screen); merge if the old
// player is retired. tests/test-vidaa-player2-progress.mjs compares both outputs.

const CHECKPOINT_MS = 90_000; // WATCH_PROGRESS_SAVE_INTERVAL_MS, by position instead of a timer
const WAITING_CHECKPOINT_MS = 5_000; // WATCH_PROGRESS_SAVE_THRESHOLD_MS
const SEEK_SYNC_MS = 700;

const normalizeItemType = (value) =>
  String(value || "movie")
    .trim()
    .toLowerCase() || "movie";
const isSeriesItemType = (value) =>
  ["series", "tv", "show", "tvshow"].includes(normalizeItemType(value));

function normalizePlayableImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}
function normalizePlayableTmdbId(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /^tt\d+$/i.test(raw)) return 0;
  const numeric = raw.replace(/^tmdb:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}
function normalizePlayableTraktId(value = "") {
  const numeric = String(value || "")
    .trim()
    .replace(/^trakt:/i, "")
    .split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

/** Route resume (playerScreenHelpers-01 buildPendingPlaybackRestore). */
export function buildPendingPlaybackRestore(params = {}) {
  if (params?.startFromBeginning) return null;
  const resumePositionMs = Number(params.resumePositionMs || 0);
  if (Number.isFinite(resumePositionMs) && resumePositionMs > 0)
    return { timeSeconds: resumePositionMs / 1000 };
  const resumePercent = Number(params.resumeProgressPercent);
  if (Number.isFinite(resumePercent) && resumePercent > 0)
    return {
      progressPercent: Math.max(0, Math.min(100, resumePercent)),
      durationSeconds:
        Number(params.resumeDurationMs || 0) > 0 ? Number(params.resumeDurationMs) / 1000 : 0
    };
  return null;
}

/** attach() options of a restore: a position, else a percent of the real (or seeded) duration. */
export function restoreStartOptions(restore) {
  const seconds = Number(restore?.timeSeconds || 0);
  if (seconds > 0) return { startAt: seconds };
  const percent = Number(restore?.progressPercent || 0);
  if (!(percent > 0)) return {};
  const seeded = Number(restore.durationSeconds || 0);
  return { startAt: seeded > 0 ? (seeded * percent) / 100 : 0, startPercent: percent };
}

/** Same record as PlayerController.createProgressContext after play(url, buildPlaybackContext). */
export function buildProgressContext(params = {}, candidate = null) {
  const itemType = normalizeItemType(params.itemType || "movie");
  const isCloud = itemType === "cloud";
  const season = params.season == null ? null : Number(params.season);
  const episode = params.episode == null ? null : Number(params.episode);
  return {
    itemId: params.itemId || null,
    itemType,
    imdbId: params.imdbId || params.imdb_id || null,
    tmdbId: params.tmdbId || params.tmdb_id || null,
    traktId: params.traktId || params.trakt_id || null,
    // Movie progress is content-level (a discovery video id varies between addons). Only
    // "series"/"tv" here, like createProgressContext (not isSeriesItemType).
    videoId: itemType === "series" || itemType === "tv" || isCloud ? params.videoId || null : null,
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    title: params.playerTitle || params.itemTitle || null,
    poster: params.poster || null,
    background: params.playerBackdropUrl || params.backdrop || params.poster || null,
    episodeTitle: params.episodeTitle || params.playerSubtitle || null,
    cloudSessionToken: isCloud ? String(params.cloudSessionToken || "").trim() || null : null,
    // buildStreamResumeIdentity is empty only without any locator, where streamMergeKey is too.
    streamIdentity: (candidate && buildStreamResumeIdentity(candidate)) || null,
    // Completion stays sticky for this source only (old player: one session per play()).
    progressSession: { completedKeys: new Set() }
  };
}

/** playerScreenMethods-07 buildScrobbleContext. */
export function buildScrobbleContext(
  params = {},
  candidate = null,
  currentSec = 0,
  durationSec = 0
) {
  const itemType = normalizeItemType(params.itemType || "movie");
  const rawItemId = String(params.itemId || "").trim();
  const rawVideoId = String(params.videoId || "").trim();
  const seasonRaw = params.season;
  const season = Number(seasonRaw);
  const episode = Number(params.episode || 0);
  const imdbId =
    [
      normalizePlayableImdbId(params.imdbId || params.imdb_id),
      normalizePlayableImdbId(rawVideoId),
      normalizePlayableImdbId(rawItemId)
    ].find(Boolean) || "";
  const tmdbId =
    [
      normalizePlayableTmdbId(params.tmdbId || params.tmdb_id),
      normalizePlayableTmdbId(rawItemId),
      normalizePlayableTmdbId(rawVideoId)
    ].find(Boolean) || 0;
  const traktId =
    [
      normalizePlayableTraktId(params.traktId || params.trakt_id),
      normalizePlayableTraktId(rawItemId),
      normalizePlayableTraktId(rawVideoId)
    ].find(Boolean) || 0;
  const progress = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;
  return {
    serverPlayback: candidate?.serverPlayback || candidate?.raw?.serverPlayback || null,
    contentId: String(params.itemId || imdbId || ""),
    videoId: String(params.videoId || params.playerVideoId || ""),
    contentType: isSeriesItemType(itemType) ? "series" : "movie",
    imdbId,
    tmdbId: tmdbId || null,
    traktId: traktId || null,
    title: String(params.playerTitle || params.itemTitle || params.title || ""),
    year: Number(params.playerReleaseYear || params.releaseYear || params.year || 0) || null,
    seasonNumber: seasonRaw != null && Number.isFinite(season) && season >= 0 ? season : null,
    episodeNumber: Number.isFinite(episode) && episode > 0 ? episode : null,
    episodeTitle: String(
      params.playerEpisodeTitle || params.episodeTitle || params.playerSubtitle || ""
    ),
    positionMs: Math.round(currentSec * 1000),
    durationMs: Math.round(durationSec * 1000),
    progressPercent: progress
  };
}

/** playerScreenMethods-06: the Sources screen focuses this stream next time (never a Party link). */
export function rememberSelectedStreamPreference(params = {}, stream = null) {
  const contentId = String(params?.itemId || "").trim();
  const videoId = String(params?.videoId || params?.itemId || "").trim();
  if (!stream?.id || !contentId || stream.partyShared || stream.raw?.partyShared) return;
  StreamPreferencesStore.set(contentId, videoId, stream.id, {
    bingeGroup: stream?.behaviorHints?.bingeGroup || stream?.raw?.behaviorHints?.bingeGroup || "",
    filename: stream?.behaviorHints?.filename || stream?.raw?.behaviorHints?.filename || null,
    infoHash: stream?.infoHash || stream?.raw?.infoHash || null,
    resumeIdentity: buildStreamResumeIdentity(stream)
  });
}

const warn = (what) => (error) => console.warn(`[player2] ${what} failed`, error?.name || "");

/**
 * Wires progress, scrobble and journal to the native events of the shared <video>. No timer
 * while playing: checkpoints are compared in timeupdate; the only timer is the 700 ms sync after
 * a seek. host: context(), scrobbleContext(), played() (an image was shown for this source),
 * presenting() (the current load shows images: false during a same-link reload), fatal(),
 * currentSeconds(), durationSeconds(), pause(), journal().
 */
export function createPlaybackProgress(video, host, { root = globalThis } = {}) {
  const now = () => root.performance?.now?.() ?? Date.now();
  let savedContext = null;
  let lastSavedMs = 0;
  let lastFlush = { context: null, key: "" };
  let seekTimer = null;
  let lastTickAt = -Infinity;
  let userPaused = false;
  let exited = false;

  const positionMs = () => Math.floor(Number(host.currentSeconds()) * 1000);
  const durationMs = () => Math.floor(Number(host.durationSeconds()) * 1000);
  const scrobbling = () => TrackingScrobbleService.isEnabled();

  // Old flushCurrentProgress modes: force = pause/stop/hide (cloud push), local = checkpoint.
  function flush({ force = false, local = false } = {}) {
    const context = host.context();
    // Nothing is saved for a source that never showed an image (old: currentTime still 0).
    if (!context?.itemId || !host.played()) return Promise.resolve(false);
    const position = positionMs();
    const duration = durationMs();
    const key = `${position}|${duration}|${force}|${local}`;
    // A hide followed by its pause event saves the same position once.
    if (lastFlush.context === context && lastFlush.key === key) return Promise.resolve(false);
    lastFlush = { context, key };
    const options = force
      ? { allowCloudSync: false, syncRemote: true }
      : local
        ? { allowCloudSync: false, syncRemote: false }
        : {};
    return PlayerController.flushProgress(position, duration, false, context, options)
      .then(() =>
        force && context.itemType !== "cloud" ? PlayerController.pushProgressIfDue(true) : true
      )
      .catch(warn("progress save"));
  }

  // saveProgressIfNeeded: a local checkpoint once the position moved by minDeltaMs.
  function checkpoint(minDeltaMs) {
    const context = host.context();
    if (context !== savedContext) {
      savedContext = context;
      lastSavedMs = 0;
    }
    const position = positionMs();
    if (!host.played() || !(position > 0) || isShortPlaceholderDuration(durationMs())) return false;
    if (Math.abs(position - lastSavedMs) < minDeltaMs) return false;
    lastSavedMs = position;
    void flush({ local: true });
    return true;
  }

  function tickJournal(paused) {
    WatchJournal.tick(host.journal(), {
      at: now(),
      position: Number(host.currentSeconds()) || 0,
      duration: Number(host.durationSeconds()) || 0,
      rate: 1,
      paused,
      seeking: Boolean(video.seeking),
      hidden: Boolean(root.document?.hidden)
    });
  }

  function clearSeekSync() {
    if (seekTimer !== null) root.clearTimeout(seekTimer);
    seekTimer = null;
  }

  const handlers = {
    timeupdate() {
      if (!host.played()) return;
      checkpoint(CHECKPOINT_MS);
      const t = now();
      if (t - lastTickAt < 1000) return;
      lastTickAt = t;
      MediaServerScrobbleService.update(host.scrobbleContext());
      // timeupdate also fires on a pause and on a seek while paused: not watched time.
      tickJournal(Boolean(video.paused));
    },
    // Android takes a local checkpoint when playback enters buffering.
    waiting() {
      checkpoint(WAITING_CHECKPOINT_MS);
    },
    playing() {
      // Debounced by the providers; also sent after each resume.
      if (scrobbling()) TrackingScrobbleService.start(host.scrobbleContext());
      if (userPaused) void flush({ local: true });
      userPaused = false;
    },
    pause() {
      // A decoder pause while buffering leaves video.paused false: only a real pause counts.
      // The teardown of a same-link reload pauses too: presenting() is already false then.
      if (!host.presenting() || !video.paused || video.ended) return;
      userPaused = true;
      clearSeekSync();
      if (scrobbling()) TrackingScrobbleService.pause(host.scrobbleContext());
      tickJournal(true);
      void flush({ force: true });
    },
    seeked() {
      // The resume seek lands before the first image: no sync for it.
      if (!host.presenting()) return;
      clearSeekSync();
      seekTimer = root.setTimeout(() => {
        seekTimer = null;
        if (!exited) void flush({ force: true });
      }, SEEK_SYNC_MS);
    },
    ended() {
      clearSeekSync();
      const duration = Number(host.durationSeconds());
      const natural =
        Number.isFinite(duration) &&
        duration > 0 &&
        shouldTreatAsNaturalPlaybackCompletion({
          hasRenderedFirstFrame: host.played(),
          hasFatalError: host.fatal(),
          durationMs: duration * 1000
        });
      // An error or placeholder end is not a completion: no stop, no watched mark.
      if (!natural) TrackingScrobbleService.cancel();
      else if (scrobbling()) TrackingScrobbleService.stop(host.scrobbleContext());
      void flush();
    }
  };
  const onMediaEvent = (event) => !exited && handlers[event.type]?.();
  // VIDAA hides or suspends the WebApp: save with a cloud push, then pause (old lifecycle flush).
  const onLifecycle = (event) => {
    if (
      exited ||
      (event.type === "visibilitychange" && root.document?.visibilityState !== "hidden")
    )
      return;
    void flush({ force: true });
    host.pause();
  };
  const mediaEvents = Object.keys(handlers);
  const documentEvents = ["visibilitychange", "nuvio:beforeExitApp"];
  for (const type of mediaEvents) video.addEventListener(type, onMediaEvent);
  for (const type of documentEvents) root.document?.addEventListener?.(type, onLifecycle);
  root.addEventListener?.("pagehide", onLifecycle);

  return {
    flush,
    /**
     * Leaving playback, before the decoder is freed: flush with a cloud push, journal, then
     * cancel the scrobble (old player parity: leaving mid-play sends cancel only). Once per mount.
     */
    exit() {
      if (exited) return false;
      clearSeekSync();
      void flush({ force: true });
      exited = true;
      try {
        WatchJournal.finish(host.journal());
      } catch (_) {}
      TrackingScrobbleService.cancel();
      return true;
    },
    destroy() {
      exited = true;
      clearSeekSync();
      for (const type of mediaEvents) video.removeEventListener(type, onMediaEvent);
      for (const type of documentEvents) root.document?.removeEventListener?.(type, onLifecycle);
      root.removeEventListener?.("pagehide", onLifecycle);
    }
  };
}
