// Next episode and skip intro of the new VIDAA player (lot P, P6). Same rules as the old player
// (playerScreenMethods-07/08/09 and 21-24, recopied small: they import playerScreenContext):
// next episode (profile shuffle, explicit nextEpisode*, sequence), card threshold, autoplay
// policy, still-watching prompt, source choice for the next episode, skip intervals. One
// timeupdate listener with numeric marks (no timer while nothing is due); countdown bars are CSS
// animations. Never plays a next episode after an error or a placeholder end.
import { I18n } from "../../../i18n/index.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { selectShuffleEpisode } from "../../../core/player/episodeShuffleSelection.js";
import { normalizePlayerEpisodeMetadata } from "../../../core/player/playerEpisodeMetadata.js";
import { shouldTreatAsNaturalPlaybackCompletion } from "../../../core/player/naturalPlaybackCompletion.js";
import {
  findActiveSkipInterval,
  findFollowingPostCreditsScene,
  getSkipIntervalTargetSeconds
} from "../../../core/player/skipIntervalRules.js";
import {
  hasEpisodeAired,
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard
} from "../../screens/player/playerNextEpisodeRules.js";
import { loadPlayerShuffleWatched } from "../../screens/player/playerEpisodeShuffle.js";
import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { selectAutoPlayStream } from "../../../core/streams/streamAutoPlaySelector.js";
import { orderStreamsByAddonOrder } from "../../../core/streams/streamOrdering.js";
import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";
import { buildNextFilename } from "../../../core/streams/filenameEpisodeMatcher.js";
import { normalizeStreamDisplayText } from "../../../core/streams/streamDisplayText.js";
import {
  flattenStreams,
  mergeStreamItems
} from "../../screens/stream/streamScreenHelpers-02-flatten-streams.js";
import { normalizePlayableImdbId, normalizePlayableTmdbId } from "./playerProgress.js";
import { streamDirectPlaybackUrl } from "./resolvePlayableCandidate.js";

export const NEXT_COUNTDOWN_MS = 3000; // old runNextEpisodeCountdown: 3, 2, 1
export const SKIP_COUNTDOWN_MS = 10000; // SKIP_INTRO_COUNTDOWN_MS
const STILL_WATCHING_MS = 60000;
const NEXT_RESOLVE_TIMEOUT_MS = 120000; // NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS
const SKIP_SEEK_SUPPRESSION_MS = 12000; // SKIP_INTERVAL_SEEK_SUPPRESSION_MS
// Next episode sources are asked once, in the last minute before the card (plan P6).
const PREFETCH_LEAD_SECONDS = 60;

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });
const isSelectKey = (keyCode) => keyCode === 13 || keyCode === 23;
const normalizeItemType = (value) =>
  String(value || "movie")
    .trim()
    .toLowerCase() || "movie";
const isSeriesItemType = (value) =>
  ["series", "tv", "show", "tvshow"].includes(normalizeItemType(value));
const skipKey = (interval) =>
  interval ? `${interval.type}:${interval.startTime}:${interval.endTime}` : "";
const bingeGroupOf = (stream) =>
  String(stream?.behaviorHints?.bingeGroup || stream?.raw?.behaviorHints?.bingeGroup || "").trim();
const orderStreams = (items) =>
  orderStreamsByAddonOrder(items, [], {
    isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
  });

export function buildSkipIntervalLabel(interval = {}, { targetsPostCredits = false } = {}) {
  const type = String(interval?.type || "")
    .trim()
    .toLowerCase();
  if (type === "recap") return t("skip_recap", [], "Skip Recap");
  if (type === "movie-credits")
    return targetsPostCredits
      ? t("skip_to_post_credits", [], "Skip to Post-Credits")
      : t("skip_movie_credits", [], "Skip Movie Credits");
  if (type === "outro" || type === "ed" || type === "mixed-ed")
    return targetsPostCredits
      ? t("skip_to_post_credits", [], "Skip to Post-Credits")
      : t("skip_outro", [], "Skip Outro");
  return t("skip_intro", [], "Skip Intro");
}

function currentEpisodeEntry(params = {}, episodes = []) {
  const videoId = String(params.videoId || "").trim();
  const byId = videoId && episodes.find((entry) => String(entry?.id || "") === videoId);
  if (byId) return byId;
  const season = Number(params.season);
  const episode = Number(params.episode || 0);
  if (params.season == null || !Number.isFinite(season) || season < 0 || episode <= 0) return null;
  return (
    episodes.find(
      (entry) => Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode
    ) || null
  );
}

/** Old getNextEpisodeInSequence: specials stay among specials, numbered seasons in order. */
export function nextInSequence(episodes = [], current = null) {
  if (!current || !episodes.length) return null;
  const season = Number(current?.season);
  const hasSeason = current?.season != null && Number.isFinite(season) && season >= 0;
  const sequence = hasSeason
    ? episodes.filter((entry) =>
        season === 0 ? Number(entry?.season) === 0 : Number(entry?.season) > 0
      )
    : [...episodes]
        .filter((entry) => Number(entry?.episode || 0) > 0)
        .sort(
          (left, right) =>
            (Number(left?.season) || 0) - (Number(right?.season) || 0) ||
            Number(left?.episode || 0) - Number(right?.episode || 0)
        );
  const index = sequence.findIndex(
    (entry) =>
      String(entry?.id || "") === String(current?.id || "") ||
      ((!hasSeason || Number(entry?.season) === season) &&
        Number(entry?.episode || 0) === Number(current?.episode || 0))
  );
  return index >= 0 ? sequence[index + 1] || null : null;
}

/**
 * Old resolveNextEpisodeInfo (21:12) without its cache: shuffle pick (null with shuffle on means
 * none), then the explicit nextEpisodeVideoId, then the sequence after the current episode.
 */
export function resolveNextEpisode(
  params = {},
  episodes = [],
  { shuffle = false, shuffled = null } = {}
) {
  if (!isSeriesItemType(params.itemType)) return null;
  if (shuffle && !shuffled) return null;
  let next = shuffled || null;
  const explicit = String(params.nextEpisodeVideoId || "").trim();
  if (!next && explicit)
    next = episodes.find((entry) => String(entry?.id || "") === explicit) || null;
  if (!next && params.videoId)
    next = nextInSequence(
      episodes,
      episodes.find((entry) => String(entry?.id || "") === String(params.videoId || ""))
    );
  if (!next && episodes.length) {
    const seasonRaw = params.season;
    const season = Number(seasonRaw);
    const hasSeason = seasonRaw != null && Number.isFinite(season) && season >= 0;
    const episode = Number(params.episode || 0);
    if (episode > 0 && (seasonRaw == null || hasSeason))
      next = nextInSequence(
        episodes,
        episodes.find(
          (entry) =>
            (!hasSeason || Number(entry?.season) === season) &&
            Number(entry?.episode || 0) === episode
        )
      );
  }
  const videoId = String(next?.id || explicit || "").trim();
  if (!videoId) return null;
  const season = next?.season ?? params.nextEpisodeSeason ?? null;
  const episode = next?.episode ?? params.nextEpisodeEpisode ?? null;
  const released = String(next?.released || params.nextEpisodeReleased || "").trim() || null;
  return {
    videoId,
    season: season == null ? null : Number(season),
    episode: episode == null ? null : Number(episode),
    episodeLabel:
      (next ? `S${next.season}E${next.episode}` : params.nextEpisodeLabel || "") || null,
    episodeTitle: String(next?.title || params.nextEpisodeTitle || "").trim() || null,
    released,
    hasAired: hasEpisodeAired(released)
  };
}

/**
 * First position where the old card rule turns true (Infinity: never). The rule is monotonic in
 * the position up to the end, so a bisection to 0.1 s gives the mark compared on timeupdate.
 */
export function cardTriggerSeconds(durationSeconds, skipIntervals = [], settings = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  const show = (position) =>
    shouldShowNextEpisodeCard({
      positionSeconds: position,
      durationSeconds: duration,
      skipIntervals,
      thresholdMode: settings.nextEpisodeThresholdMode,
      thresholdPercent: settings.nextEpisodeThresholdPercent,
      thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
    });
  if (!show(duration)) return Infinity;
  if (show(0)) return 0;
  let low = 0;
  let high = duration;
  while (high - low > 0.1) {
    const middle = (low + high) / 2;
    if (show(middle)) high = middle;
    else low = middle;
  }
  return high;
}

async function installedAddonNames(addons) {
  return new Set(
    ((await addons.getInstalledAddons().catch(() => [])) || [])
      .map((addon) => String(addon?.displayName || addon?.name || "").trim())
      .filter(Boolean)
  );
}

/** Old selectNextEpisodeStreamByAutoPlayPolicy (23), same options. */
export async function selectNextStream(
  streams,
  {
    settings = PlayerSettingsStore.get(),
    current = null,
    params = {},
    next = null,
    bingeGroupOnly = false,
    installedNames = null,
    addons = addonRepository
  } = {}
) {
  if (!Array.isArray(streams) || !streams.length) return null;
  const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
  const preferBingeGroup = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);
  const autoInManual =
    mode === "MANUAL" && (Boolean(settings.autoplayNextEpisode) || preferBingeGroup);
  const preferredBingeGroup = preferBingeGroup ? bingeGroupOf(current) : "";
  const bingeOnlyManual = autoInManual && preferBingeGroup;
  if (bingeOnlyManual && !preferredBingeGroup && bingeGroupOnly) return null;
  const names = installedNames instanceof Set ? installedNames : await installedAddonNames(addons);
  const filename = current?.behaviorHints?.filename || current?.raw?.behaviorHints?.filename || "";
  const expectedFilename = next
    ? buildNextFilename(
        filename,
        params.season,
        params.episode ?? 0,
        next.season,
        next.episode ?? 0
      ) || filename
    : filename;
  return selectAutoPlayStream(streams, {
    preferredFilename: expectedFilename,
    filenameOnlyFallback: !bingeGroupOnly,
    mode: autoInManual && (!bingeOnlyManual || preferredBingeGroup) ? "FIRST_STREAM" : mode,
    source: autoInManual ? "ALL_SOURCES" : String(settings.streamAutoPlaySource || "ALL_SOURCES"),
    regexPattern: autoInManual ? "" : String(settings.streamAutoPlayRegex || ""),
    installedAddonNames: names,
    selectedAddons: autoInManual ? [] : settings.streamAutoPlaySelectedAddons,
    selectedPlugins: autoInManual ? [] : settings.streamAutoPlaySelectedPlugins,
    preferredBingeGroup,
    preferBingeGroupInSelection: preferBingeGroup,
    bingeGroupOnly: Boolean(bingeGroupOnly || bingeOnlyManual)
  });
}

const NEXT_HTML = `
  <div class="p2-skip" hidden><span class="p2-skip-label"></span><span class="p2-skip-bar"></span></div>
  <div class="p2-next" hidden>
    <div class="p2-next-kicker"></div>
    <div class="p2-next-title"></div>
    <div class="p2-next-status"></div>
    <div class="p2-next-actions">
      <span class="p2-next-action" data-p2-next="play"></span>
      <span class="p2-next-action" data-p2-next="exit" hidden></span>
    </div>
    <div class="p2-next-bar"><div class="p2-next-fill"></div></div>
  </div>`;

/**
 * host: { params, isActive(), firstFrame(), fatal(), osdVisible(), hideControls(),
 * currentStream(), seek(seconds), pause(), flush(), navigate(route, params, options), leave(),
 * partyLocked() }. root: the player overlay (null in node: state only).
 */
export function createPlayerNext(
  video,
  host,
  {
    root = null,
    repository = streamRepository,
    skipRepository = skipIntroRepository,
    addons = addonRepository,
    now = () => Date.now()
  } = {}
) {
  const params = host.params || {};
  const series = isSeriesItemType(params.itemType);
  const episodes = series
    ? normalizePlayerEpisodeMetadata(params.episodes, { fallbackSeason: params.season })
    : [];
  let consecutive = Math.max(0, Math.trunc(Number(params.consecutiveAutoPlayCount || 0) || 0));
  let destroyed = false;
  let intervals = [];
  let skipToken = 0;
  let active = null;
  let skipDismissed = false;
  let skipHidden = false;
  let suppressedKey = "";
  let suppressedUntil = 0;
  let cardAt = Infinity;
  let prefetchAt = Infinity;
  let prefetched = false;
  let nextAt = 0;
  let dismissed = false;
  let attemptedKey = "";
  let launch = null; // { token, phase: "searching" | "countdown", source }
  let launchToken = 0;
  let still = null; // { focus: "continue" | "exit" }
  let timer = null;
  let wake = null;
  let cancelResolve = null;
  let streams = { key: "", items: null, promise: null };
  let abort = null;
  let pluginsResumed = false;
  let framed = false;
  // loadPlayerShuffleWatched writes the profile's watched episodes on this host.
  const shuffleHost = {
    params,
    shuffleRemoteWatched: null,
    shuffleNextCache: null,
    isActiveMountToken: () => !destroyed && host.isActive()
  };

  const time = () => Number(video.currentTime) || 0;
  const duration = () => {
    const value = Number(video.duration);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const eligible = () =>
    duration() > 0 &&
    shouldTreatAsNaturalPlaybackCompletion({
      hasRenderedFirstFrame: host.firstFrame(),
      hasFatalError: host.fatal(),
      durationMs: duration() * 1000
    });
  const wait = (ms) =>
    new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });
  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const resolve = wake;
    wake = null;
    resolve?.();
  }

  // The old cleanup pauses the local plugin search again; a dropped launch does the same.
  function pausePlugins() {
    if (!pluginsResumed) return;
    pluginsResumed = false;
    repository.setLocalPluginSearchPaused?.(true);
  }

  function info() {
    if (!series || destroyed) return null;
    const contentId = params.itemId || params.contentId;
    const shuffle = EpisodeShuffleStore.get(contentId, normalizeItemType(params.itemType));
    let shuffled = null;
    if (shuffle.enabled) {
      const key = JSON.stringify([
        ProfileManager.getActiveProfileId(),
        contentId,
        params.videoId,
        params.season,
        params.episode,
        params.nextEpisodeVideoId,
        shuffle.includeWatched,
        LocalStore.revision("watchedItems"),
        LocalStore.revision("watchProgressItems")
      ]);
      if (shuffleHost.shuffleNextCache?.key !== key) {
        const current =
          currentEpisodeEntry(params, episodes) ||
          (params.season != null && Number(params.season) >= 0 && Number(params.episode) > 0
            ? { season: params.season, episode: params.episode }
            : null);
        shuffleHost.shuffleNextCache = {
          key,
          selected: selectShuffleEpisode({
            contentId,
            contentType: normalizeItemType(params.itemType),
            videos: episodes,
            surface: "playback",
            watched: shuffleHost.shuffleRemoteWatched || new Set(),
            current,
            preferredVideoId: params.nextEpisodeVideoId || null,
            reference: params
          })
        };
      }
      shuffled = shuffleHost.shuffleNextCache.selected;
    }
    return resolveNextEpisode(params, episodes, { shuffle: shuffle.enabled, shuffled });
  }

  // ---- Skip intro ----
  async function loadSkipIntervals() {
    const token = ++skipToken;
    intervals = [];
    active = null;
    if (!PlayerSettingsStore.get().skipIntroEnabled) return;
    const rawItemId = String(params.itemId || "").trim();
    const rawVideoId = String(params.videoId || "").trim();
    const imdbId =
      [params.imdbId || params.imdb_id, rawVideoId, rawItemId]
        .map(normalizePlayableImdbId)
        .find(Boolean) || "";
    const season = Number(params.season);
    const episode = Number(params.episode || 0);
    let found = [];
    try {
      if (series) {
        if (!imdbId || !(params.season != null && season > 0) || !(episode > 0)) return;
        found = await skipRepository.getSkipIntervals(imdbId, season, episode);
      } else {
        const tmdbId =
          [params.tmdbId || params.tmdb_id, rawItemId, rawVideoId]
            .map(normalizePlayableTmdbId)
            .find(Boolean) || 0;
        const contentId = params.itemId || params.contentId || params.videoId || "";
        if (!imdbId && !tmdbId && !contentId) return;
        found = await skipRepository.getMovieSkipIntervals({
          imdbId,
          tmdbId,
          contentId,
          videoId: rawVideoId
        });
      }
    } catch (_) {
      return;
    }
    if (destroyed || token !== skipToken) return;
    intervals = Array.isArray(found) ? found : [];
    recompute();
  }

  function updateSkip(position, settings) {
    let next = settings.skipIntroEnabled ? findActiveSkipInterval(intervals, position) : null;
    // A TV can report the pre-seek position while a skip seek settles.
    if (suppressedKey && now() >= suppressedUntil) suppressedKey = "";
    else if (suppressedKey && skipKey(next) === suppressedKey) next = null;
    if (skipKey(next) === skipKey(active)) return;
    active = next;
    skipDismissed = false;
    skipHidden = false;
    const type = String(active?.type || "")
      .trim()
      .toLowerCase();
    const autoType = ["outro", "ed", "mixed-ed"].includes(type)
      ? "outro"
      : ["recap", "movie-credits"].includes(type)
        ? type
        : "intro";
    if (active && settings.autoSkipSegmentTypes?.includes(autoType) && !host.partyLocked()) skip();
  }

  function skip() {
    if (!active) return false;
    const total = duration();
    const target = getSkipIntervalTargetSeconds(active, intervals, total);
    if (!Number.isFinite(target)) return false;
    suppressedKey = skipKey(active);
    suppressedUntil = now() + SKIP_SEEK_SUPPRESSION_MS;
    // shortcut: a Party guest's skip goes through seek like any seek, Party target rules come with P7.
    host.seek(total > 0 ? Math.min(target, total) : target);
    skipDismissed = true;
    active = null;
    render();
    return true;
  }

  // ---- Next episode ----
  function recompute() {
    const settings = PlayerSettingsStore.get();
    const total = duration();
    cardAt = series
      ? cardTriggerSeconds(total, settings.skipIntroEnabled ? intervals : [], settings)
      : Infinity;
    prefetchAt =
      series && total > 0 ? Math.max(0, Math.min(cardAt, total) - PREFETCH_LEAD_SECONDS) : Infinity;
    nextAt = 0;
    evaluate();
  }

  function reached() {
    return time() >= cardAt && eligible();
  }

  function cardVisible() {
    if (destroyed || !host.firstFrame() || host.fatal()) return false;
    if (launch || still) return true;
    return !dismissed && !host.osdVisible() && reached() && Boolean(info());
  }

  function skipVisible() {
    return Boolean(
      active &&
      !skipDismissed &&
      !skipHidden &&
      host.firstFrame() &&
      !host.fatal() &&
      !host.osdVisible() &&
      !cardVisible()
    );
  }

  function evaluate({ seeked = false } = {}) {
    if (destroyed || !host.firstFrame()) return;
    const position = time();
    const settings = PlayerSettingsStore.get();
    updateSkip(position, settings);
    if (reached()) maybeAutoplay(settings);
    else {
      // Below the mark again (seek back): the card cycle starts over, a launch is dropped.
      dismissed = false;
      attemptedKey = "";
      if (seeked && launch) cancelLaunch();
    }
    if (!prefetched && position >= prefetchAt && eligible()) prefetch();
    // Past the card mark every timeupdate counts (autoplay waits for a resume); before it, only
    // the next interval edge or mark.
    const marks = [cardAt, prefetched ? Infinity : prefetchAt];
    for (const interval of intervals)
      marks.push(Number(interval?.startTime), Number(interval?.endTime) - 0.5);
    nextAt =
      position >= cardAt
        ? position
        : Math.min(...marks.filter((mark) => Number.isFinite(mark) && mark > position));
    render();
  }

  function maybeAutoplay(settings) {
    if (launch || still || video.paused) return;
    const next = info();
    if (!next || !settings.autoplayNextEpisode || !next.hasAired) {
      attemptedKey = "";
      return;
    }
    const key = `${next.videoId}:${next.season ?? ""}:${next.episode ?? ""}`;
    if (attemptedKey === key) return;
    if (stillWatchingDue(settings, next)) {
      attemptedKey = "";
      openStill();
      return;
    }
    attemptedKey = key;
    void play({ userInitiated: false, pickOnMiss: false });
  }

  // MANUAL without autoplay nor binge group: the user picks the next episode's source.
  const autoSelects = (settings) =>
    String(settings.streamAutoPlayMode || "MANUAL").toUpperCase() !== "MANUAL" ||
    Boolean(settings.autoplayNextEpisode) ||
    Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);

  const stillWatchingDue = (settings, next) =>
    shouldEnterStillWatchingPrompt({
      stillWatchingEnabled: settings.stillWatchingEnabled,
      autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
      nextEpisodeHasAired: next?.hasAired,
      consecutiveAutoPlayCount: consecutive,
      threshold: settings.stillWatchingEpisodeThreshold
    });

  function openStill() {
    if (still || launch || !info()?.hasAired) return;
    still = { focus: "continue" };
    host.pause();
    host.hideControls();
    clearTimer();
    void wait(STILL_WATCHING_MS).then(() => still && !destroyed && exitStill());
    render();
  }

  function continueStill() {
    still = null;
    clearTimer();
    consecutive = 0;
    render();
    return play({ userInitiated: true });
  }

  function exitStill() {
    still = null;
    clearTimer();
    consecutive = 0;
    render();
    return host.leave();
  }

  function prefetch() {
    prefetched = true;
    // Plain MANUAL opens the Sources screen, which searches itself: no request during playback.
    if (!autoSelects(PlayerSettingsStore.get())) return;
    const next = info();
    if (next?.videoId && next.hasAired !== false) void loadStreams(next).catch(() => {});
  }

  // Old getPlayableStreamsForVideo, one entry: a running prefetch is awaited, not asked again.
  function loadStreams(next, onChunk = null) {
    const key = JSON.stringify([next.videoId, next.season, next.episode]);
    if (streams.key === key && streams.items) {
      onChunk?.(streams.items);
      return Promise.resolve(streams.items);
    }
    if (streams.key === key && streams.promise) return streams.promise;
    abort?.abort?.();
    abort = typeof AbortController === "function" ? new AbortController() : null;
    let partial = [];
    const promise = repository
      .getStreamsFromAllAddons(normalizeItemType(params.itemType), next.videoId, {
        itemId: String(params.itemId || ""),
        season: next.season ?? null,
        episode: next.episode ?? null,
        signal: abort?.signal || null,
        onChunk: (chunk) => {
          const items = flattenStreams(chunk);
          if (destroyed || !items.length) return;
          partial = mergeStreamItems(partial, items);
          onChunk?.(orderStreams(partial));
        }
      })
      .then((result) => {
        const items = orderStreams(mergeStreamItems(partial, flattenStreams(result)));
        // An empty answer is not kept: the next ask searches again (Android repository cache).
        if (streams.promise === promise) streams = { key: items.length ? key : "", items };
        return items;
      });
    // A failed search is not kept either (old getPlayableStreamsForVideo drops its promise).
    promise.catch(() => {
      if (streams.promise === promise) streams = { key: "", items: null, promise: null };
    });
    streams = { key, items: null, promise };
    return promise;
  }

  // Old resolveNextEpisodeStreamByAutoPlayPolicy (23): binge group as chunks arrive, the policy
  // after streamAutoPlayTimeoutSeconds, then on the full list; 120 s bound.
  async function resolveStream(next, settings) {
    repository.setLocalPluginSearchPaused?.(false);
    pluginsResumed = true;
    const names = await installedAddonNames(addons);
    const current = host.currentStream();
    let latest = [];
    let timeoutElapsed = Number(settings.streamAutoPlayTimeoutSeconds || 0) === 0;
    const hasGroup = Boolean(
      settings.streamAutoPlayPreferBingeGroupForNextEpisode && bingeGroupOf(current)
    );
    const pick = (bingeGroupOnly = false) =>
      selectNextStream(latest, {
        settings,
        current,
        params,
        next,
        bingeGroupOnly,
        installedNames: names
      });
    return new Promise((resolve) => {
      let settled = false;
      let selectionTimer = null;
      let hardTimer = null;
      const finish = (selectedStream, error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(selectionTimer);
        clearTimeout(hardTimer);
        if (cancelResolve === finish) cancelResolve = null;
        resolve({ selectedStream: selectedStream || null, streamItems: latest, error });
      };
      cancelResolve = finish;
      const seconds = Math.max(0, Math.trunc(Number(settings.streamAutoPlayTimeoutSeconds || 0)));
      if (seconds > 0 && seconds !== 2147483647)
        selectionTimer = setTimeout(() => {
          timeoutElapsed = true;
          if (latest.length) void pick().then(finish);
        }, seconds * 1000);
      hardTimer = setTimeout(
        () => finish(null, new Error("Next episode stream selection timed out")),
        NEXT_RESOLVE_TIMEOUT_MS
      );
      const onChunk = (items) => {
        latest = Array.isArray(items) ? items : latest;
        void (async () => {
          if (hasGroup) {
            const grouped = await pick(true);
            if (grouped) return finish(grouped);
          }
          if (timeoutElapsed) finish(await pick());
        })();
      };
      loadStreams(next, onChunk)
        .then(async (items) => {
          latest = Array.isArray(items) ? items : latest;
          finish(await pick());
        })
        .catch((error) => finish(null, error));
    });
  }

  // An error during the search or the countdown drops the launch: never a next episode after it.
  const launchActive = (token) =>
    !destroyed && launch?.token === token && host.isActive() && !host.fatal();

  function cancelLaunch() {
    launch = null;
    clearTimer();
    cancelResolve?.(null);
    pausePlugins();
    render();
  }

  function followingFields(next) {
    const index = episodes.findIndex((entry) => String(entry?.id || "") === String(next.videoId));
    const following = index >= 0 ? episodes[index + 1] || null : null;
    return {
      nextEpisodeVideoId: following?.id || null,
      nextEpisodeLabel: following ? `S${following.season}E${following.episode}` : null,
      nextEpisodeSeason: following?.season ?? null,
      nextEpisodeEpisode: following?.episode ?? null,
      nextEpisodeTitle: following?.title || "",
      nextEpisodeReleased: following?.released || ""
    };
  }

  function sharedRouteFields() {
    const backdrop = params.playerBackdropUrl || params.backdrop || params.poster || null;
    return {
      itemId: params.itemId || null,
      itemType: normalizeItemType(params.itemType),
      imdbId: params.imdbId || null,
      tmdbId: params.tmdbId || params.tmdb_id || null,
      traktId: params.traktId || params.trakt_id || null,
      backdrop,
      logo: params.playerLogoUrl || params.logo || null
    };
  }

  // The old player opens its episode panel on the next episode's sources; the new one has no
  // episode panel (lot P scope): the Sources screen of that episode, same params as 21:236.
  // shortcut: leaves playback for the picker, upgrade when lot E brings an episode panel.
  function openPicker(next) {
    launch = null;
    clearTimer();
    render();
    if (destroyed || !host.isActive()) return false;
    const shared = sharedRouteFields();
    void host.navigate(
      "stream",
      {
        ...shared,
        returnToDetail: true,
        fromDetailRoute: Boolean(params.fromDetailRoute),
        itemTitle: params.playerTitle || params.itemTitle || params.itemId || "Untitled",
        itemSubtitle: "",
        year: params.playerReleaseYear || params.year || "",
        poster: params.poster || shared.backdrop,
        parentalWarnings: params.parentalWarnings || null,
        parentalGuide: params.parentalGuide || null,
        videoId: next.videoId,
        season: next.season,
        episode: next.episode,
        episodeTitle: next.episodeTitle || "",
        episodes,
        ...followingFields(next)
      },
      { skipStackPush: true, replaceHistory: true }
    );
    return true;
  }

  /**
   * Old playNextEpisode (24): policy source, 3 s countdown, flush, then the player route.
   * pickOnMiss false (autoplay while the episode still plays): no source found keeps the card
   * and the video instead of leaving for the Sources screen (the old player opened a panel).
   */
  async function play({ userInitiated = false, pickOnMiss = true } = {}) {
    if (destroyed || host.partyLocked()) return false;
    const next = info();
    if (!next?.videoId || next.hasAired === false || launch) return false;
    const settings = PlayerSettingsStore.get();
    if (!autoSelects(settings)) return openPicker(next);
    const token = ++launchToken;
    launch = { token, phase: "searching", source: "" };
    if (userInitiated) consecutive = 0;
    host.hideControls();
    render();
    let resolution;
    try {
      resolution = await resolveStream(next, settings);
    } catch (error) {
      resolution = { selectedStream: null, error };
    }
    if (!launchActive(token)) return false;
    const stream = resolution.selectedStream;
    // The episode ended during the search (onEnded skipped it): nothing left to keep playing.
    if (!stream && !pickOnMiss && !video.ended) {
      launch = null;
      pausePlugins();
      render();
      return false;
    }
    if (!stream) return openPicker(next);
    launch.phase = "countdown";
    launch.source = normalizeStreamDisplayText(String(stream.name || stream.addonName || ""));
    render();
    await wait(NEXT_COUNTDOWN_MS);
    if (!launchActive(token)) return false;
    timer = null;
    consecutive = userInitiated ? 0 : consecutive + 1;
    try {
      await host.flush();
    } catch (_) {}
    if (!launchActive(token)) return false;
    const shared = sharedRouteFields();
    // The route mounts this screen again: cleanup destroys this object (tokens, timers, DOM).
    await host.navigate(
      "player",
      {
        streamUrl: streamDirectPlaybackUrl(stream) || null,
        itemId: params.itemId,
        itemType: shared.itemType,
        imdbId: shared.imdbId,
        tmdbId: shared.tmdbId,
        traktId: shared.traktId,
        contentLanguage: params.contentLanguage || null,
        videoId: next.videoId,
        season: next.season,
        episode: next.episode,
        episodeLabel: next.episodeLabel || null,
        playerTitle: params.playerTitle || params.itemId,
        playerSubtitle: next.episodeTitle || next.episodeLabel || "",
        playerEpisodeTitle: next.episodeTitle || "",
        playerBackdropUrl: params.playerBackdropUrl || null,
        playerLogoUrl: params.playerLogoUrl || null,
        episodes,
        streamCandidates: resolution.streamItems || [],
        preferredStreamId: stream.id || null,
        returnToStreamOnBack: false,
        returnHomeOnBack: Boolean(
          params.returnHomeOnBack ||
          params.streamRouteParams?.continueWatchingBackHome ||
          params.streamRouteParams?.returnHomeOnBack
        ),
        ...followingFields(next),
        consecutiveAutoPlayCount: consecutive
      },
      { replaceHistory: true }
    );
    return true;
  }

  // Natural end: autoplay (or still watching), else Detail like the old finishNaturalPlaybackEnded.
  // An error or placeholder end neither plays the next episode nor leaves.
  async function onEnded() {
    if (destroyed || launch || still || !eligible()) return;
    const settings = PlayerSettingsStore.get();
    const total = duration();
    const position = time();
    if (settings.autoplayNextEpisode && (total - position <= 1 || position / total >= 0.999)) {
      if (stillWatchingDue(settings, info())) {
        openStill();
        return;
      }
      const handled = await play({ userInitiated: false });
      if (handled || launch || destroyed || !host.isActive()) return;
    }
    if (params.itemId && !destroyed && host.isActive()) host.leave();
  }

  // ---- Keys and Back ----
  function onKey(keyCode, event) {
    if (still) {
      if (keyCode === 37 || keyCode === 39) {
        still.focus = still.focus === "continue" ? "exit" : "continue";
        render();
      } else if (isSelectKey(keyCode) && !event?.repeat) {
        if (still.focus === "exit") exitStill();
        else void continueStill();
      }
      return true;
    }
    if (!isSelectKey(keyCode) || host.osdVisible()) return false;
    if (launch) return true;
    if (cardVisible()) {
      if (!event?.repeat) void play({ userInitiated: true });
      return true;
    }
    if (skipVisible()) {
      if (!event?.repeat) skip();
      return true;
    }
    return false;
  }

  function back() {
    if (still) return exitStill();
    if (launch) {
      cancelLaunch();
      dismissed = true;
      render();
      return true;
    }
    if (host.osdVisible()) return false;
    if (cardVisible()) {
      dismissed = true;
      render();
      return true;
    }
    if (skipVisible()) {
      skipDismissed = true;
      render();
      return true;
    }
    return false;
  }

  // ---- DOM ----
  let refs = null;
  let rendered = "";
  let shownCounting = 0;
  if (root) {
    const holder = document.createElement("div");
    holder.className = "p2-next-root";
    holder.innerHTML = NEXT_HTML;
    const q = (selector) => holder.querySelector(selector);
    refs = {
      holder,
      skip: q(".p2-skip"),
      skipLabel: q(".p2-skip-label"),
      card: q(".p2-next"),
      kicker: q(".p2-next-kicker"),
      title: q(".p2-next-title"),
      status: q(".p2-next-status"),
      play: q('[data-p2-next="play"]'),
      exit: q('[data-p2-next="exit"]'),
      bar: q(".p2-next-bar"),
      fill: q(".p2-next-fill")
    };
    // The 10 s bar ends: the button hides until the next interval (old auto-hide).
    // shortcut: the bar restarts when the OSD hides again (old one resumed), fine until lot E.
    q(".p2-skip-bar").addEventListener("animationend", () => {
      skipHidden = true;
      render();
    });
    root.appendChild(holder);
  }

  function render() {
    if (!refs) return;
    const showSkip = skipVisible();
    const showCard = cardVisible();
    const next = showCard ? info() : null;
    const total = duration();
    const label = showSkip
      ? buildSkipIntervalLabel(active, {
          targetsPostCredits: Boolean(findFollowingPostCreditsScene(active, intervals, total))
        })
      : "";
    const status = still
      ? ""
      : launch?.phase === "searching"
        ? t("next_episode_finding_source", [], "Finding source…")
        : launch?.phase === "countdown"
          ? launch.source
          : next && next.hasAired === false
            ? t("next_episode_not_aired_yet", [], "Next episode has not aired yet")
            : "";
    const counting = still
      ? STILL_WATCHING_MS
      : launch?.phase === "countdown"
        ? NEXT_COUNTDOWN_MS
        : 0;
    const view = JSON.stringify([
      showSkip,
      label,
      showCard,
      still?.focus || "",
      next?.videoId,
      next?.episodeLabel,
      next?.episodeTitle,
      status,
      counting,
      Boolean(launch)
    ]);
    if (view === rendered) return;
    rendered = view;
    refs.skip.hidden = !showSkip;
    refs.skipLabel.textContent = label;
    refs.card.hidden = !showCard;
    if (!showCard) return;
    refs.kicker.textContent = still
      ? t("still_watching_title", [], "Are you still watching?")
      : t("next_episode_label", [], "Next episode");
    refs.title.textContent = [next?.episodeLabel, next?.episodeTitle].filter(Boolean).join(" · ");
    refs.status.textContent = status;
    refs.status.hidden = !status;
    refs.play.textContent = still
      ? t("still_watching_continue", [], "Continue")
      : t("next_episode_play", [], "Watch");
    refs.play.hidden = Boolean(launch) || next?.hasAired === false;
    refs.exit.textContent = t("still_watching_exit", [], "Exit");
    refs.exit.hidden = !still;
    refs.play.classList.toggle("focused", !still || still.focus === "continue");
    refs.exit.classList.toggle("focused", still?.focus === "exit");
    // The countdown bar is a CSS animation of that length; the logic waits on one timer.
    refs.bar.hidden = !counting;
    refs.fill.style.animationDuration = counting ? `${counting}ms` : "";
    if (counting !== shownCounting) {
      // Still prompt -> countdown can change within one task: restart the bar, one style flush.
      refs.card.classList.remove("is-counting");
      if (counting) void refs.fill.offsetWidth;
      shownCounting = counting;
    }
    refs.card.classList.toggle("is-counting", Boolean(counting));
  }

  // ---- Media events ----
  const onEvent = (event) => {
    if (destroyed) return;
    if (event.type === "timeupdate") {
      if (time() >= nextAt) evaluate();
    } else if (event.type === "seeked") evaluate({ seeked: true });
    else if (event.type === "ended") void onEnded();
    else recompute();
  };
  const EVENTS = ["timeupdate", "seeked", "ended", "loadedmetadata", "durationchange"];
  for (const type of EVENTS) video.addEventListener(type, onEvent);

  return {
    info,
    play,
    skip,
    onKey,
    back,
    render,
    loadSkipIntervals,
    hasOverlay: () => Boolean(still || launch || cardVisible() || skipVisible()),
    /** State read by the tests and the screen. */
    get state() {
      return {
        cardAt,
        prefetchAt,
        prefetched,
        nextAt,
        consecutive,
        launch: launch ? { ...launch } : null,
        still: Boolean(still),
        cardVisible: cardVisible(),
        skipVisible: skipVisible(),
        activeSkip: active,
        timer: timer !== null
      };
    },
    /** Skip intervals and the shuffle's watched list wait for the first image (no request during
     * the start). */
    onFirstFrame() {
      if (framed || destroyed) return;
      framed = true;
      void loadSkipIntervals();
      void loadPlayerShuffleWatched(shuffleHost, 0);
      recompute();
    },
    destroy() {
      destroyed = true;
      launch = null;
      still = null;
      clearTimer();
      cancelResolve?.(null);
      abort?.abort?.();
      pausePlugins();
      skipToken += 1;
      for (const type of EVENTS) video.removeEventListener(type, onEvent);
      refs?.holder.remove();
      refs = null;
    }
  };
}
