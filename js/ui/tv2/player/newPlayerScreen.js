import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { sizedImageUrl } from "../imagePipeline.js";
import { createVideoSession } from "./videoSession.js";
import { pickInitialCandidate, resolvePlayableCandidate } from "./resolvePlayableCandidate.js";
import {
  buildPendingPlaybackRestore,
  buildProgressContext,
  buildScrobbleContext,
  createPlaybackProgress,
  rememberSelectedStreamPreference,
  restoreStartOptions
} from "./playerProgress.js";
import { saveReusableStreamLink } from "../../../core/streams/streamLinkReuse.js";
import { activeStreamLinkProfile } from "../../../data/local/streamLinkCacheStore.js";
import { WatchJournal } from "../../../core/perso/watchJournal.js";
import { maybeOfferRatingAfterPlayback } from "../../screens/player/persoRatingOffer.js";
import { StreamInfoMethods, isStreamInfoKey } from "../../screens/player/streamInfoOverlay.js";
import { deltaMsForKeyRepeat } from "../../../core/player/playerScrubRates.js";
import { VidaaBenchmark } from "../../../core/diagnostics/vidaaBenchmark.js";
import { OSD_HIDE_MS, OSD_HTML, createPlayerOsd, resolveMediaAction } from "./playerOsd.js";

// New VIDAA player (lot P): start, stop and teardown, explicit errors, no automatic source
// switch (P1); resume, progress, Trakt and journal (P2, playerProgress.js); OSD, seek preview,
// media keys, buffering and the Back order (P3, playerOsd.js). Same route "player", params and
// screen contract as the old player (router facade). Never imports playerScreenMethods-* or
// playerScreenContext (asserted by the VIDAA build).
// Deferred to later slices: tracks (P4), in-player Sources (P5), next episode and skip intro
// (P6), Watch Party (P7, whose restore will take priority over the route's).

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });
const ERROR_ACTIONS = ["sources", "retry", "back"];
const isSelectKey = (keyCode) => keyCode === 13 || keyCode === 23;
const BUFFERING_DELAY_MS = 600;
const SEEK_COMMIT_FALLBACK_MS = 1000;
// Real media key codes of the remote, written once each to the Diagnostic (P3 risk).
const notedMediaKeys = new Set();

function normalizeItemType(value) {
  return (
    String(value || "movie")
      .trim()
      .toLowerCase() || "movie"
  );
}
function isSeriesItemType(value) {
  return ["series", "tv", "show", "tvshow"].includes(normalizeItemType(value));
}

function httpErrorMessage(status) {
  const hint =
    status === 400 || status === 403
      ? t(
          "player_error_stream_blocked",
          [],
          "\n\nThe stream source is blocked or restricted. Try a different source."
        )
      : status === 404
        ? t(
            "player_error_stream_removed",
            [],
            "\n\nThe stream link has expired or been removed. Try a different source."
          )
        : status === 401 || status === 410
          ? t(
              "player_error_stream_expired",
              [],
              "\n\nThe stream link has expired. Try a different source."
            )
          : status === 429
            ? t(
                "player_error_stream_rate_limited",
                [],
                "\n\nToo many requests to the stream source. Wait a moment and try again."
              )
            : status >= 500
              ? t(
                  "player_error_stream_unavailable",
                  [],
                  "\n\nThe stream server is currently unavailable. Try a different source."
                )
              : "";
  return `HTTP ${status}${hint}`;
}

/** Error screen text: localized, never a link or a host. */
export function playerErrorMessage(error) {
  if (!error) return "";
  if (error.errorKey) return t(error.errorKey, [], error.fallback);
  if (error.httpStatus >= 400) return httpErrorMessage(error.httpStatus);
  const message =
    error.kind === "decode"
      ? t("player2_error_decode", [], "This format is not played by the TV decoder.")
      : error.kind === "network"
        ? t("player2_error_network", [], "The connection to the source was lost.")
        : error.kind === "stalled"
          ? t("player2_error_stalled", [], "The source stopped sending data.")
          : error.kind === "timeout"
            ? t("player2_error_timeout", [], "The video did not start in time.")
            : t("player2_error_unreadable", [], "Source unreadable or expired.");
  return error.code ? `${message} [MEDIA_ERR ${error.code}]` : message;
}

const ROOT_HTML = `
  <div class="p2-loading">
    <img class="p2-backdrop" alt="" hidden />
    <div class="p2-loading-text">
      <div class="p2-title"></div>
      <div class="p2-status"><span class="p2-spinner"></span><span class="p2-status-text"></span></div>
    </div>
  </div>
  <div class="p2-buffering" hidden><span class="p2-spinner"></span></div>
  <div class="p2-error" hidden>
    <div class="p2-error-panel">
      <div class="p2-error-title"></div>
      <div class="p2-error-message"></div>
      <div class="p2-error-actions">
        <button type="button" class="p2-error-button" data-p2-action="sources"></button>
        <button type="button" class="p2-error-button" data-p2-action="retry"></button>
        <button type="button" class="p2-error-button" data-p2-action="back"></button>
      </div>
    </div>
  </div>${OSD_HTML}`;

export const NewPlayerScreen = {
  // Stream info (i) overlay of the old player, shared as is; it drives the OSD through the
  // setControlsVisible / resetControlsAutoHide / clearControlsAutoHide names below.
  ...StreamInfoMethods,
  container: null,
  params: {},
  video: null,
  session: null,
  root: null,
  refs: null,
  candidate: null,
  resolveError: null,
  errorFocus: 0,
  playerMountToken: 0,
  playerBackNavigationInProgress: false,
  tickTimer: null,
  resolveTimer: null,
  resolveAttempt: 0,
  resolveCapMs: 45000,
  progress: null,
  progressContext: null,
  pendingPlaybackRestore: null,
  personalWatchRun: null,
  streamLinkCacheProfileId: null,
  initialFilenameStreamCandidate: null,
  videoAutoplay: false,
  osd: null,
  controlsVisible: false,
  controlFocusZone: "",
  controlFocusIndex: 0,
  streamInfoVisible: false,
  streamInfoOverlay: null,
  seekPreviewSeconds: null,
  seekPreviewDirection: 0,
  seekRepeatCount: 0,
  seekOpenedOsd: false,
  osdHideTimer: null,
  osdTickTimer: null,
  seekCommitTimer: null,
  bufferingTimer: null,
  bufferingShown: false,

  get paused() {
    return this.session?.state === "paused";
  },

  // saveReusableStreamLink calls it without a token.
  isActiveMountToken(token = this.playerMountToken) {
    return token === this.playerMountToken && Router.current === "player";
  },

  async mount(params = {}) {
    const token = ++this.playerMountToken;
    this.params = params || {};
    this.playerBackNavigationInProgress = false;
    this.resolveError = null;
    this.errorFocus = 0;
    this.container = document.getElementById("player");
    this.container.style.display = "block";
    this.video = document.getElementById("videoPlayer");
    // play() is explicit: the shell's autoplay would start a src the moment it is set.
    this.videoAutoplay = this.video.hasAttribute("autoplay");
    this.video.removeAttribute("autoplay");
    this.video.muted = false;
    this.resetOsdState();
    this.buildRoot();
    this.session = createVideoSession(this.video, {
      prepare: (url) => Platform.prepareMediaRequest(url),
      onChange: () => token === this.playerMountToken && this.render(),
      note: (name) => VidaaBenchmark.notePlayerEvent?.(name)
    });
    this.candidate = pickInitialCandidate(this.params);
    this.initialFilenameStreamCandidate = this.candidate;
    this.streamLinkCacheProfileId = activeStreamLinkProfile();
    this.pendingPlaybackRestore = buildPendingPlaybackRestore(this.params);
    this.progressContext = null;
    WatchJournal.finish(this.personalWatchRun);
    this.personalWatchRun = WatchJournal.start(this.params);
    // Hide, pagehide and app exit save with a cloud push, then pause.
    this.progress = createPlaybackProgress(this.video, {
      context: () => this.progressContext,
      scrobbleContext: () =>
        buildScrobbleContext(
          this.params,
          this.candidate,
          this.getPlaybackCurrentSeconds(),
          this.getPlaybackDurationSeconds()
        ),
      played: () => Boolean(this.session?.played),
      presenting: () => Boolean(this.session?.firstFrame),
      fatal: () => this.session?.state === "error" || Number(this.video?.error?.code || 0) > 0,
      currentSeconds: () => this.getPlaybackCurrentSeconds(),
      durationSeconds: () => this.getPlaybackDurationSeconds(),
      pause: () => this.session?.pause(),
      journal: () => this.personalWatchRun
    });
    this.render();
    // The Router awaits mount: resolution and playback continue after it returns.
    void this.startCandidate(token);
  },

  async startCandidate(token = this.playerMountToken) {
    this.resolveError = null;
    this.stopResolveCap();
    const attempt = ++this.resolveAttempt;
    const isCurrent = () => attempt === this.resolveAttempt && this.isActiveMountToken(token);
    this.render();
    let result;
    try {
      // Debrid calls have no timeout of their own: a hung answer must end in an error (C2).
      result = await Promise.race([
        resolvePlayableCandidate(this.candidate, { params: this.params, isCurrent }),
        new Promise((resolve) => {
          this.resolveTimer = setTimeout(() => resolve({ kind: "timeout" }), this.resolveCapMs);
        })
      ]);
    } catch (_) {
      result = { errorKey: "player_error_playback_fallback", fallback: "Playback error" };
    }
    if (attempt === this.resolveAttempt) this.stopResolveCap();
    if (!result || !isCurrent()) return;
    if (!result.url) {
      this.resolveError = result;
      this.render();
      return;
    }
    // One context (and completion latch) per source, built after resolution like the old player.
    this.progressContext = buildProgressContext(this.params, this.candidate);
    // Each started source, like the old 35:233 (a synthetic link has no id and is skipped).
    rememberSelectedStreamPreference(this.params, this.candidate);
    saveReusableStreamLink(this, this.candidate, { url: result.url });
    // A newer media server position wins over the route's (old player 35:44-53).
    const restore =
      result.serverResumeMs > 0
        ? { timeSeconds: result.serverResumeMs / 1000 }
        : this.pendingPlaybackRestore;
    this.session.attach(result.url, restoreStartOptions(restore));
  },

  /** Leaving playback: save, journal, scrobble cancel, rating offer; before the decoder is freed. */
  finishPlayback() {
    if (!this.progress?.exit()) return;
    maybeOfferRatingAfterPlayback(
      { params: this.params, episodes: this.params?.episodes },
      this.video
    );
  },

  buildRoot() {
    this.root?.remove();
    const root = document.createElement("div");
    root.className = "p2-root";
    root.innerHTML = ROOT_HTML;
    const q = (selector) => root.querySelector(selector);
    this.refs = {
      loading: q(".p2-loading"),
      backdrop: q(".p2-backdrop"),
      title: q(".p2-title"),
      status: q(".p2-status-text"),
      buffering: q(".p2-buffering"),
      error: q(".p2-error"),
      errorTitle: q(".p2-error-title"),
      errorMessage: q(".p2-error-message"),
      buttons: [...root.querySelectorAll("[data-p2-action]")]
    };
    const params = this.params;
    this.refs.title.textContent = params.playerTitle || params.itemTitle || "";
    const backdrop = sizedImageUrl(params.playerBackdropUrl || params.backdrop || "", 1280);
    if (backdrop) {
      this.refs.backdrop.src = backdrop;
      this.refs.backdrop.hidden = false;
    }
    this.refs.errorTitle.textContent = t("player_error_title", [], "Playback error");
    const labels = {
      sources: t("sources_title", [], "Sources"),
      retry: t("action_retry", [], "Retry"),
      back: t("player_go_back", [], "Go Back")
    };
    for (const button of this.refs.buttons) button.textContent = labels[button.dataset.p2Action];
    const series = isSeriesItemType(params.itemType);
    const episode =
      series && params.season != null && params.episode != null
        ? `S${params.season} E${params.episode}`
        : "";
    this.osd = createPlayerOsd(root, {
      title: params.playerTitle || params.itemTitle || "",
      subtitle:
        [episode, series ? params.playerEpisodeTitle || params.episodeTitle || "" : ""]
          .filter(Boolean)
          .join(" · ") ||
        params.playerSubtitle ||
        ""
    });
    this.container.appendChild(root);
    this.root = root;
  },

  currentError() {
    return this.resolveError || (this.session?.state === "error" ? this.session.error : null);
  },

  isErrorVisible() {
    return Boolean(this.currentError());
  },

  render() {
    const refs = this.refs;
    const session = this.session;
    if (!refs || !session) return;
    const error = this.currentError();
    const loading = !error && !session.firstFrame;
    refs.loading.hidden = !loading;
    if (loading) {
      // The backdrop goes at the first image: a hardware video plane may sit under it.
      const seconds = session.startedAt
        ? Math.floor((performance.now() - session.startedAt) / 1000)
        : 0;
      refs.status.textContent = session.startedAt
        ? t("player2_opening", [seconds], `Opening… ${seconds} s`)
        : t("player_loading_preparing", [], "Preparing stream…");
    }
    // The spinner waits 600 ms of waiting without a new playing: short refills stay invisible.
    if (error || session.state !== "buffering") {
      if (this.bufferingTimer !== null) clearTimeout(this.bufferingTimer);
      this.bufferingTimer = null;
      this.bufferingShown = false;
    } else if (!this.bufferingShown && this.bufferingTimer === null) {
      this.bufferingTimer = setTimeout(() => {
        this.bufferingTimer = null;
        this.bufferingShown = true;
        this.render();
      }, BUFFERING_DELAY_MS);
    }
    refs.buffering.hidden = !this.bufferingShown;
    refs.error.hidden = !error;
    // A pause keeps the OSD up; a new playing starts its auto-hide again.
    if (this.controlsVisible) this.resetControlsAutoHide();
    this.renderOsd();
    if (error) {
      refs.errorMessage.textContent = playerErrorMessage(error);
      refs.buttons.forEach((button, index) =>
        button.classList.toggle("focused", index === this.errorFocus)
      );
    }
    // One 1 Hz tick for the elapsed time, only while the loading screen shows.
    if (loading && this.tickTimer === null) this.tickTimer = setInterval(() => this.render(), 1000);
    else if (!loading && this.tickTimer !== null) this.stopTick();
  },

  stopResolveCap() {
    if (this.resolveTimer !== null) clearTimeout(this.resolveTimer);
    this.resolveTimer = null;
  },

  stopTick() {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
  },

  runErrorAction(action) {
    if (action === "retry") {
      this.errorFocus = 0;
      if (this.resolveError || !this.session?.url) void this.startCandidate();
      else this.session.retry();
      return;
    }
    // P1: Sources returns to the Sources screen; P5 opens the panel in place.
    this.navigateBackToStreamScreen();
  },

  onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    this.session?.restoreSound();
    if (this.isErrorVisible()) {
      event?.preventDefault?.();
      if (keyCode === 37 || keyCode === 39) {
        const step = keyCode === 39 ? 1 : -1;
        this.errorFocus = Math.max(0, Math.min(ERROR_ACTIONS.length - 1, this.errorFocus + step));
        this.render();
      } else if (isSelectKey(keyCode) && !event?.repeat)
        this.runErrorAction(ERROR_ACTIONS[this.errorFocus]);
      return;
    }
    // Loading: only Back acts (FocusEngine -> consumeBackRequest).
    if (!this.session?.firstFrame) return;
    if (this.streamInfoVisible) {
      event?.preventDefault?.();
      if (!event?.repeat && (isStreamInfoKey(event) || isSelectKey(keyCode)))
        this.closeStreamInfo();
      else if ((keyCode === 38 || keyCode === 40) && this.streamInfoOverlay)
        this.streamInfoOverlay.scrollTop += keyCode === 40 ? 100 : -100;
      return;
    }
    if (isStreamInfoKey(event)) {
      event?.preventDefault?.();
      if (!event?.repeat) this.showStreamInfo();
      return;
    }
    const action = resolveMediaAction(event);
    if (action) {
      event?.preventDefault?.();
      const code = Number(event?.originalKeyCode || keyCode);
      if (!notedMediaKeys.has(code)) {
        notedMediaKeys.add(code);
        VidaaBenchmark.notePlayerEvent?.(`key${code}-${action}`);
      }
      this.applyMediaAction(action, event);
      return;
    }
    if (isSelectKey(keyCode)) {
      event?.preventDefault?.();
      if (event?.repeat) return;
      if (this.seekPreviewSeconds != null) this.commitSeekPreview();
      this.togglePause();
      return;
    }
    if (keyCode === 37 || keyCode === 39) {
      event?.preventDefault?.();
      this.beginSeekPreview(keyCode === 39 ? 1 : -1, Boolean(event?.repeat));
      return;
    }
    if (keyCode === 38 || keyCode === 40) {
      event?.preventDefault?.();
      this.setControlsVisible(true);
    }
  },

  // Android parity: preview while a direction is held, one seek on release.
  onKeyUp(event) {
    const keyCode = Number(event?.keyCode || 0);
    const action = resolveMediaAction(event);
    if (
      this.seekPreviewSeconds != null &&
      (keyCode === 37 || keyCode === 39 || action === "fastForward" || action === "rewind")
    ) {
      event?.preventDefault?.();
      this.commitSeekPreview();
    }
  },

  resetOsdState() {
    this.stopOsdTimers();
    this.controlsVisible = false;
    this.streamInfoVisible = false;
    this.streamInfoOverlay = null;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOpenedOsd = false;
    this.bufferingShown = false;
  },

  stopOsdTimers() {
    for (const name of ["osdHideTimer", "seekCommitTimer", "bufferingTimer"]) {
      if (this[name] !== null) clearTimeout(this[name]);
      this[name] = null;
    }
    if (this.osdTickTimer !== null) clearInterval(this.osdTickTimer);
    this.osdTickTimer = null;
  },

  renderOsd() {
    this.osd?.update({
      visible: this.controlsVisible && Boolean(this.session?.firstFrame),
      paused: Boolean(this.video?.paused),
      current: this.getPlaybackCurrentSeconds(),
      duration: this.getPlaybackDurationSeconds(),
      preview: this.seekPreviewSeconds
    });
  },

  // Zero OSD timer while it is hidden: the 1 Hz update and the auto-hide live only while shown.
  setControlsVisible(visible) {
    this.controlsVisible = Boolean(visible);
    if (!this.controlsVisible) {
      this.seekOpenedOsd = false;
      if (this.osdTickTimer !== null) clearInterval(this.osdTickTimer);
      this.osdTickTimer = null;
    } else if (this.osdTickTimer === null) {
      this.osdTickTimer = setInterval(() => this.renderOsd(), 1000);
    }
    this.resetControlsAutoHide();
    this.renderOsd();
  },

  clearControlsAutoHide() {
    if (this.osdHideTimer !== null) clearTimeout(this.osdHideTimer);
    this.osdHideTimer = null;
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (
      !this.controlsVisible ||
      this.paused ||
      this.seekPreviewSeconds != null ||
      this.streamInfoVisible
    )
      return;
    this.osdHideTimer = setTimeout(() => {
      this.osdHideTimer = null;
      this.setControlsVisible(false);
    }, OSD_HIDE_MS);
  },

  togglePause() {
    if (!this.session?.firstFrame || this.isErrorVisible()) return;
    if (this.video?.paused) this.session.resume();
    else this.session.pause();
    this.setControlsVisible(true);
  },

  beginSeekPreview(direction, repeat = false) {
    if (!this.session?.firstFrame || this.isErrorVisible()) return;
    if (direction !== this.seekPreviewDirection || !repeat) this.seekRepeatCount = 0;
    this.seekPreviewDirection = direction;
    const delta = deltaMsForKeyRepeat(this.seekRepeatCount, direction > 0) / 1000;
    this.seekRepeatCount += 1;
    const duration = this.getPlaybackDurationSeconds();
    const base = this.seekPreviewSeconds ?? this.getPlaybackCurrentSeconds();
    const next = Math.max(0, base + delta);
    this.seekPreviewSeconds = duration > 0 ? Math.min(next, duration) : next;
    if (!this.controlsVisible) this.seekOpenedOsd = true;
    this.setControlsVisible(true);
    // The video is untouched until the key is released, or 1 s after the last key without keyup.
    if (this.seekCommitTimer !== null) clearTimeout(this.seekCommitTimer);
    this.seekCommitTimer = setTimeout(() => this.commitSeekPreview(), SEEK_COMMIT_FALLBACK_MS);
  },

  commitSeekPreview() {
    if (this.seekCommitTimer !== null) clearTimeout(this.seekCommitTimer);
    this.seekCommitTimer = null;
    const target = this.seekPreviewSeconds;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOpenedOsd = false;
    if (target != null) this.seekPlaybackSeconds(target);
    this.resetControlsAutoHide();
    this.renderOsd();
  },

  cancelSeekPreview() {
    if (this.seekCommitTimer !== null) clearTimeout(this.seekCommitTimer);
    this.seekCommitTimer = null;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    // A preview opened from a hidden OSD leaves it hidden again.
    this.setControlsVisible(!this.seekOpenedOsd);
  },

  // StreamInfoMethods hooks: the new player has no external frame and no post-play (deferred).
  isStartupErrorVisible() {
    return this.isErrorVisible();
  },
  isExternalFrameMode() {
    return false;
  },
  isPostPlayVisible() {
    return false;
  },

  onPointerActivate(target) {
    const action = target?.closest?.("[data-p2-action]")?.dataset?.p2Action;
    if (action && this.isErrorVisible()) this.runErrorAction(action);
  },

  onPointerFocus() {},
  onPointerMove() {},

  // Back order: panel, seek preview, (next card / skip intro: P6), visible OSD, then leave.
  // Loading and error always leave; navigateBackToStreamScreen locks a doubled Back.
  consumeBackRequest() {
    if (this.isErrorVisible() || !this.session?.firstFrame || this.playerBackNavigationInProgress)
      return this.navigateBackToStreamScreen();
    if (this.streamInfoVisible) {
      this.closeStreamInfo();
      return true;
    }
    if (this.seekPreviewSeconds != null) {
      this.cancelSeekPreview();
      return true;
    }
    if (this.controlsVisible) {
      this.setControlsVisible(false);
      return true;
    }
    return this.navigateBackToStreamScreen();
  },

  // Same list as the old player: a visible OSD alone lets a history Back return to Sources.
  hasBackDismissableOverlay() {
    return Boolean(this.streamInfoVisible || this.seekPreviewSeconds != null);
  },

  cancelSourceLoad() {},

  shouldReturnToStreamOnBack() {
    if (this.params?.returnToStreamOnBack === false) return false;
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    return Boolean(
      this.params?.returnToStreamOnBack ||
      this.params?.streamRouteParams ||
      streamParams.itemId ||
      streamParams.videoId
    );
  },

  resolveCurrentEpisodeEntry() {
    const episodes = Array.isArray(this.params?.episodes) ? this.params.episodes : [];
    const videoId = String(this.params?.videoId || "").trim();
    const season = Number(this.params?.season);
    const episode = Number(this.params?.episode || 0);
    return (
      (videoId && episodes.find((entry) => String(entry?.id || "") === videoId)) ||
      (this.params?.season != null && episode > 0
        ? episodes.find(
            (entry) =>
              Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode
          )
        : null) ||
      null
    );
  },

  // Same shape as the old player (playerScreenMethods-21), without the next episode fields (P6).
  buildReturnStreamRouteParamsFromPlayer() {
    const params = this.params || {};
    const itemType = normalizeItemType(params.itemType);
    const series = isSeriesItemType(itemType);
    const currentEpisode = series ? this.resolveCurrentEpisodeEntry() : null;
    const positionMs = Math.round(this.getPlaybackCurrentSeconds() * 1000);
    const backdrop = params.playerBackdropUrl || params.backdrop || params.poster || null;
    const derived = {
      itemId: params.itemId || null,
      itemType,
      imdbId: params.imdbId || null,
      tmdbId: params.tmdbId || params.tmdb_id || null,
      traktId: params.traktId || params.trakt_id || null,
      returnToDetail: true,
      fromDetailRoute: Boolean(params.fromDetailRoute),
      itemTitle: params.playerTitle || params.itemTitle || params.itemId || "Untitled",
      itemSubtitle: series ? "" : params.playerSubtitle || "",
      year: params.playerReleaseYear || params.year || "",
      backdrop,
      poster: params.poster || backdrop,
      logo: params.playerLogoUrl || params.logo || null,
      parentalWarnings: params.parentalWarnings || null,
      parentalGuide: params.parentalGuide || null,
      videoId: series
        ? params.videoId || currentEpisode?.id || null
        : params.videoId || params.itemId || null,
      season: series ? (params.season ?? currentEpisode?.season ?? null) : null,
      episode: series ? (params.episode ?? currentEpisode?.episode ?? null) : null,
      episodeTitle: series
        ? params.playerEpisodeTitle || params.playerSubtitle || currentEpisode?.title || ""
        : "",
      episodes: Array.isArray(params.episodes) ? params.episodes : [],
      resumePositionMs: Number.isFinite(positionMs) && positionMs > 0 ? positionMs : 0
    };
    const original =
      params.streamRouteParams && typeof params.streamRouteParams === "object"
        ? params.streamRouteParams
        : null;
    return original
      ? {
          ...derived,
          ...original,
          resumePositionMs: derived.resumePositionMs,
          startFromBeginning: false
        }
      : derived;
  },

  buildDetailRouteParamsFromPlayer() {
    const params = this.params || {};
    const itemType = normalizeItemType(params.itemType);
    const series = isSeriesItemType(itemType);
    const streamRouteParams =
      params.streamRouteParams && typeof params.streamRouteParams === "object"
        ? params.streamRouteParams
        : null;
    const seasonRaw = series ? (params.season ?? this.resolveCurrentEpisodeEntry()?.season) : null;
    const season = Number(seasonRaw);
    return {
      itemId: params.itemId || null,
      itemType,
      fallbackTitle: params.playerTitle || params.itemTitle || params.itemId || "Untitled",
      imdbId: params.imdbId || null,
      tmdbId: params.tmdbId || params.tmdb_id || null,
      traktId: params.traktId || params.trakt_id || null,
      returnToSearchOnBack: Boolean(
        params.returnToSearchOnBack || streamRouteParams?.returnToSearchOnBack
      ),
      returnHomeOnBack: Boolean(
        params.returnHomeOnBack ||
        streamRouteParams?.continueWatchingBackHome ||
        streamRouteParams?.returnHomeOnBack
      ),
      preferredSeason: seasonRaw != null && Number.isFinite(season) && season >= 0 ? season : null
    };
  },

  // Same targets and order as the old player; frees the decoder before the next screen renders.
  navigateBackToStreamScreen({ forceDetail = false } = {}) {
    // A duplicate Back must not make FocusEngine swallow the first traversal.
    if (this.playerBackNavigationInProgress) return "history";
    this.playerBackNavigationInProgress = true;
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    this.finishPlayback();
    this.session?.teardown();
    const params = this.params || {};
    const toLibrary = !forceDetail && params.returnToLibraryOnBack === true;
    const toHome = !forceDetail && params.returnToHomeOnBack === true;
    const toStream = !toLibrary && !toHome && !forceDetail && this.shouldReturnToStreamOnBack();
    const route = toHome
      ? "home"
      : toLibrary
        ? "library"
        : toStream
          ? "stream"
          : params.itemId
            ? "detail"
            : "home";
    const routeParams =
      route === "stream"
        ? streamParams
        : route === "detail"
          ? this.buildDetailRouteParamsFromPlayer()
          : {};
    if (
      Router.popToExistingRoute?.(route, routeParams, {
        allowSingleIntermediateRoute: route === "detail"
      })
    )
      return "history";
    void Router.navigate(route, routeParams, {
      skipStackPush: true,
      replaceHistory: true,
      isBackNavigation: true
    });
    return true;
  },

  // Playback contract read by the phone remote, Stream info and the Watch Party (later slices).
  getPlaybackCurrentSeconds() {
    return Number(this.session?.currentSeconds()) || 0;
  },
  getPlaybackDurationSeconds() {
    return Number(this.session?.durationSeconds()) || 0;
  },
  getPlaybackControlPaused() {
    return this.paused;
  },
  getPlaybackSpeed() {
    return 1;
  },
  seekPlaybackSeconds(seconds) {
    const target = Number(seconds);
    if (!this.session?.firstFrame || !this.video || !Number.isFinite(target)) return false;
    const duration = this.getPlaybackDurationSeconds();
    try {
      this.video.currentTime = Math.max(0, duration > 0 ? Math.min(target, duration) : target);
    } catch (_) {
      return false;
    }
    return true;
  },
  // Media keys and the phone remote; Stop pauses like the old player.
  applyMediaAction(action, event = null) {
    if (action === "toggle") this.togglePause();
    else if (action === "play" || action === "pause" || action === "stop") {
      if (Boolean(this.video?.paused) === (action === "play")) this.togglePause();
    } else if (action === "fastForward" || action === "rewind")
      this.beginSeekPreview(action === "fastForward" ? 1 : -1, Boolean(event?.repeat));
  },
  renderControlButtons() {
    this.renderOsd();
  },
  resolveNextEpisodeInfo() {
    return null;
  },
  playNextEpisode() {
    return false;
  },
  subtitleDialogVisible: false,
  openSubtitleDialog() {},
  closeSubtitleDialog() {},
  getSubtitleEntries() {
    return [];
  },
  getAudioEntries() {
    return [];
  },
  applyAudioTrack() {
    return false;
  },
  openAudioDialog() {},
  getCurrentStreamCandidate() {
    return this.candidate || null;
  },
  getCurrentStreamDisplayName() {
    const stream = this.candidate || {};
    return String(stream.name || stream.title || stream.label || stream.addonName || "");
  },

  // Synchronous, never throws: position read and saved, then the decoder freed (NUV-089).
  cleanup() {
    this.playerMountToken += 1;
    try {
      this.finishPlayback();
    } catch (_) {}
    try {
      this.session?.destroy();
    } catch (_) {
    } finally {
      this.session = null;
      this.stopTick();
      this.stopResolveCap();
      try {
        this.closeStreamInfo({ restore: false });
      } catch (_) {}
      this.resetOsdState();
      this.osd = null;
      try {
        this.progress?.destroy();
      } catch (_) {}
      this.progress = null;
      this.personalWatchRun = null;
      this.root?.remove();
      this.root = null;
      this.refs = null;
      if (this.video && this.videoAutoplay) this.video.setAttribute("autoplay", "");
      if (this.container) this.container.style.display = "none";
    }
  }
};
