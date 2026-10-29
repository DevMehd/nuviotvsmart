import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { sizedImageUrl } from "../imagePipeline.js";
import { createVideoSession } from "./videoSession.js";
import { pickInitialCandidate, resolvePlayableCandidate } from "./resolvePlayableCandidate.js";

// New VIDAA player (lot P, P1): start, stop and teardown, explicit errors, no automatic source
// switch. Same route "player", params and screen contract as the old player (router facade).
// Never imports playerScreenMethods-* or playerScreenContext (asserted by the VIDAA build).
// Deferred to later slices: progress/resume/Trakt (P2), OSD/seek/media keys (P3), tracks (P4),
// in-player Sources (P5), next episode (P6), Watch Party (P7).

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });
const ERROR_ACTIONS = ["sources", "retry", "back"];
const SELECT_KEY = 13;

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
  </div>`;

export const NewPlayerScreen = {
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
  listeners: null,
  videoAutoplay: false,

  get paused() {
    return this.session?.state === "paused";
  },

  isActiveMountToken(token) {
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
    this.buildRoot();
    this.session = createVideoSession(this.video, {
      prepare: (url) => Platform.prepareMediaRequest(url),
      onChange: () => token === this.playerMountToken && this.render()
    });
    const pause = () => this.session?.pause();
    const onVisibility = () => document.visibilityState === "hidden" && pause();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    this.listeners = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
    };
    this.candidate = pickInitialCandidate(this.params);
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
    // P2 passes the resume position here (startAt).
    this.session.attach(result.url);
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
    refs.buffering.hidden = Boolean(error) || session.state !== "buffering";
    refs.error.hidden = !error;
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
    if (!this.isErrorVisible()) return;
    event?.preventDefault?.();
    if (keyCode === 37 || keyCode === 39) {
      const step = keyCode === 39 ? 1 : -1;
      this.errorFocus = Math.max(0, Math.min(ERROR_ACTIONS.length - 1, this.errorFocus + step));
      this.render();
    } else if (keyCode === SELECT_KEY && !event?.repeat)
      this.runErrorAction(ERROR_ACTIONS[this.errorFocus]);
  },

  onKeyUp() {},

  onPointerActivate(target) {
    const action = target?.closest?.("[data-p2-action]")?.dataset?.p2Action;
    if (action && this.isErrorVisible()) this.runErrorAction(action);
  },

  onPointerFocus() {},
  onPointerMove() {},

  // P1: Back always leaves (loading, error or playing); P3 adds the OSD and panels first.
  consumeBackRequest() {
    return this.navigateBackToStreamScreen();
  },

  hasBackDismissableOverlay() {
    return false;
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
  seekPlaybackSeconds() {
    return false;
  },
  applyMediaAction() {
    return false;
  },
  renderControlButtons() {},
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

  // Synchronous, never throws; the decoder is freed first (NUV-089). P2 flushes progress before.
  cleanup() {
    this.playerMountToken += 1;
    try {
      this.session?.destroy();
    } catch (_) {
    } finally {
      this.session = null;
      this.stopTick();
      this.stopResolveCap();
      try {
        this.listeners?.();
      } catch (_) {}
      this.listeners = null;
      this.root?.remove();
      this.root = null;
      this.refs = null;
      if (this.video && this.videoAutoplay) this.video.setAttribute("autoplay", "");
      if (this.container) this.container.style.display = "none";
    }
  }
};
