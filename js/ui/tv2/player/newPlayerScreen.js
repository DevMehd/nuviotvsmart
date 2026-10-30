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
import {
  OSD_ACTIONS,
  OSD_HIDE_MS,
  OSD_HTML,
  createPlayerOsd,
  resolveMediaAction
} from "./playerOsd.js";
import {
  audioNamesLine,
  createPlayerTracks,
  startupTargets,
  trackPreferenceContentId
} from "./playerTracks.js";
import { TrackPreferencesStore } from "../../../data/local/trackPreferencesStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { resolveStreamFilename } from "../../screens/player/streamFilename.js";
import { SOURCE_WINDOW, createPlayerSources, sourceWindowStart } from "./playerSourcesPanel.js";
import { loadStreamingLibs } from "../../../runtime/loadStreamingLibs.js";
import { normalizeStreamDisplayText } from "../../../core/streams/streamDisplayText.js";
import { createPlayerNext } from "./playerNext.js";
import { createPlayerPartyMethods } from "../../screens/player/playerParty.js";
import { PartyRepository } from "../../../core/party/partyRepository.js";
import { httpRequest } from "../../../core/network/httpClient.js";
import { SessionStore } from "../../../core/storage/sessionStore.js";

// New VIDAA player (lot P): start, stop and teardown, explicit errors, no automatic source
// switch (P1); resume, progress, Trakt and journal (P2, playerProgress.js); OSD, seek preview,
// media keys, buffering and the Back order (P3, playerOsd.js); audio and subtitle tracks with
// their real names (P4, playerTracks.js); in-player Sources and the user's source switch (P5,
// playerSourcesPanel.js), HLS with headers through hls.js on demand; next episode and skip
// intro (P6, playerNext.js); Watch Party (P7) through the old player's own party mixin
// (playerParty.js) over this screen's playback contract. Same route "player", params and screen
// contract as the old player (router facade). Never imports playerScreenMethods-* or
// playerScreenContext (asserted by the VIDAA build).

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });
const ERROR_ACTIONS = ["sources", "retry", "back"];
const isSelectKey = (keyCode) => keyCode === 13 || keyCode === 23;
const BUFFERING_DELAY_MS = 600;
const SEEK_COMMIT_FALLBACK_MS = 1000;
// Real media key codes of the remote, written once each to the Diagnostic (P3 risk).
const notedMediaKeys = new Set();
// File header reader (Matroska/MP4 demux), loaded only when the TV leaves a track unnamed.
let headerReader = null;
const loadHeaderReader = async () =>
  (headerReader ||= (await import("../../../platform/vidaa/vidaaEmbeddedTextProvider.js"))
    .vidaaEmbeddedTextProvider);
// The media host refused CORS: the site's server reads the header (server/mediaTracksService.js).
// Only the hosted build has that server, and it answers signed-in allowlisted accounts only.
// null = not available here: the client category stays in the Diagnostic. The old player is
// not wired to it.
async function fetchServerAudioTracks(url) {
  if (globalThis.__NUVIO_ADDON_DATA_SERVICE__ !== true || !SessionStore.accessToken) return null;
  const data = await httpRequest("/api/media-tracks", {
    method: "POST",
    body: JSON.stringify({ url }),
    cache: "no-store",
    timeoutMs: 12000
  });
  return (Array.isArray(data?.audio) ? data.audio.slice(0, 64) : [])
    .filter((track) => track && typeof track === "object")
    .map((track) => ({
      name: String(track.name || "").slice(0, 200),
      language: String(track.language || "").slice(0, 32),
      codecId: String(track.codecId || "").slice(0, 64),
      codec: String(track.codec || "").slice(0, 32),
      channels: Number(track.channels) || ""
    }));
}

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
            : error.kind === "unsupported"
              ? t(
                  "player_error_vidaa_standalone_unsupported",
                  [],
                  "This source requires network features that are not available on this device. Try a different source."
                )
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
  </div>
  <div class="player-aspect-toast p2-toast hidden"></div>${OSD_HTML}`;

const partyMethods = createPlayerPartyMethods();

export const NewPlayerScreen = {
  // Stream info (i) overlay of the old player, shared as is; it drives the OSD through the
  // setControlsVisible / resetControlsAutoHide / clearControlsAutoHide names below.
  ...StreamInfoMethods,
  // Watch Party of the old player as is (P7): pill, side panel, sync tick, guest lock.
  ...partyMethods,
  // Drift is corrected by a seek, never by speed: a rate other than 1 can break TrueHD passthrough.
  partyNudgeSupported() {
    return false;
  },
  // No speed control here: a host's speed must not outlive the party (left, ended or unbound).
  stopPartySync() {
    partyMethods.stopPartySync.call(this);
    if (this.video && this.video.playbackRate !== 1) this.video.playbackRate = 1;
  },
  partyPanelVisible: false,
  // Forwardable request headers of the source playing (HLS through hls.js), shared by the Party.
  playbackHeaders: {},
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
  tracks: null,
  trackPanel: "",
  trackPanelFocus: 0,
  sources: null,
  // Sources panel line: { kind: "opening" } while a chosen source resolves, or
  // { kind: "failed", message } when it could not be opened (the current one stays).
  sourcesStatus: null,
  // Next episode card, still-watching prompt and skip intro (P6).
  next: null,

  get paused() {
    return this.session?.state === "paused";
  },
  // The party mixin writes paused after its own pause/resume: the session state stays the truth.
  set paused(_) {},
  // Fields the party mixin reads, derived from the session.
  get hasPresentedPlaybackFrame() {
    return Boolean(this.session?.firstFrame);
  },
  get loadingVisible() {
    return Boolean(this.session) && !this.session.firstFrame && !this.isErrorVisible();
  },
  get bufferingActive() {
    return this.session?.state === "buffering";
  },
  get activePlaybackUrl() {
    return this.session?.url || "";
  },
  get uiRefs() {
    return { root: this.root, aspectToast: this.refs?.toast || null };
  },
  // The party panel closes the other panels through these names.
  get sourcesPanelVisible() {
    return this.trackPanel === "sources";
  },
  get audioDialogVisible() {
    return this.trackPanel === "audio";
  },
  closeSourcesPanel() {
    if (this.trackPanel === "sources") this.closeTrackPanel();
  },
  closeAudioDialog() {
    if (this.trackPanel === "audio") this.closeTrackPanel();
  },
  currentPlaybackHeaders() {
    return this.playbackHeaders;
  },

  // saveReusableStreamLink calls it without a token.
  isActiveMountToken(token = this.playerMountToken) {
    return token === this.playerMountToken && Router.current === "player";
  },

  async mount(params = {}, navigationContext = {}) {
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
      note: (name) => VidaaBenchmark.notePlayerEvent?.(name),
      onTrackSwitchError: () => this.tracks?.revertAudio(),
      loadHls: async () => {
        await loadStreamingLibs({ hls: true, dash: false });
        const Hls = globalThis.Hls;
        return Hls?.isSupported?.() ? Hls : null;
      }
    });
    const contentId = trackPreferenceContentId(this.params);
    this.tracks = createPlayerTracks(this.video, {
      // The phone's choice ("Envoyer à la TV") wins over the title's, then the profile language.
      preferences: () => ({
        audio: this.params.handoffAudio || TrackPreferencesStore.getAudio(contentId),
        subtitle: this.params.handoffSubtitle || TrackPreferencesStore.getSubtitle(contentId),
        targets: startupTargets(PlayerSettingsStore.get(), I18n.getLocale?.() || "", this.params)
      }),
      remember: {
        audio: (preference) => contentId && TrackPreferencesStore.setAudio(contentId, preference),
        subtitle: (preference) =>
          contentId && TrackPreferencesStore.setSubtitle(contentId, preference)
      },
      probe: async (url) => (await loadHeaderReader()).getTracks(url, { audioOnly: true }),
      probeDiagnostics: () => headerReader?.diagnostics().audio || {},
      probeServer: fetchServerAudioTracks,
      loadAddonSubtitles: () => this.loadAddonSubtitles(),
      guardSwitch: () => this.session?.guardTrackSwitch(),
      onChange: () => token === this.playerMountToken && this.renderTrackPanel(),
      note: (status) => VidaaBenchmark.noteAudioNames?.(status)
    });
    this.candidate = pickInitialCandidate(this.params);
    this.initialFilenameStreamCandidate = this.candidate;
    this.sourcesStatus = null;
    this.sources = createPlayerSources(this.params, {
      onChange: () => token === this.playerMountToken && this.renderTrackPanel()
    });
    this.sources.include(this.candidate);
    this.streamLinkCacheProfileId = activeStreamLinkProfile();
    this.pendingPlaybackRestore = buildPendingPlaybackRestore(this.params);
    this.playbackHeaders = {};
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
    this.next = createPlayerNext(
      this.video,
      {
        params: this.params,
        isActive: () => this.isActiveMountToken(token),
        firstFrame: () => Boolean(this.session?.firstFrame),
        fatal: () => this.isErrorVisible() || Number(this.video?.error?.code || 0) > 0,
        osdVisible: () =>
          this.controlsVisible || Boolean(this.trackPanel) || this.streamInfoVisible,
        hideControls: () => this.setControlsVisible(false),
        currentStream: () => this.candidate,
        seek: (seconds) => this.userSeek(seconds),
        pause: () => this.session?.pause(),
        // Old playNextEpisode: flush with a cloud push before the next route.
        flush: () => this.progress?.flush({ force: true }),
        navigate: (route, params, options) => Router.navigate(route, params, options),
        // Still watching "Exit" and a natural end without autoplay: Detail, like the old player.
        leave: () => this.navigateBackToStreamScreen({ forceDetail: true }),
        // A Party guest neither skips nor starts the next episode; asked by the user, it says why.
        partyLocked: (notify = false) =>
          notify ? this.partyBlocksControl() : this.isPartyControlLocked()
      },
      { root: this.root }
    );
    // A party on this title sets the start position (pendingPlaybackRestore) and starts its tick.
    this.bindParty(navigationContext);
    this.loadPartyProfile();
    this.render();
    // The Router awaits mount: resolution and playback continue after it returns.
    void this.startCandidate(token);
  },

  /**
   * Resolves then plays a source. switching: a source chosen in the Sources panel; until it
   * resolves, the current source (playing or failed) stays as is, and a failure is only shown in
   * the panel. Never called without a user action after the first source.
   */
  async startCandidate(
    token = this.playerMountToken,
    stream = this.candidate,
    { switching = false } = {}
  ) {
    if (!switching) this.resolveError = null;
    this.stopResolveCap();
    const attempt = ++this.resolveAttempt;
    const isCurrent = () => attempt === this.resolveAttempt && this.isActiveMountToken(token);
    this.render();
    let result;
    try {
      // Debrid calls have no timeout of their own: a hung answer must end in an error (C2).
      result = await Promise.race([
        resolvePlayableCandidate(stream, { params: this.params, isCurrent }),
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
      if (switching) {
        this.sources?.markFailed(stream);
        this.sourcesStatus = { kind: "failed", message: playerErrorMessage(result).trim() };
        this.renderTrackPanel();
        return;
      }
      this.resolveError = result;
      this.render();
      return;
    }
    if (switching) {
      // Position of the source being left, read before its decoder is freed, then saved.
      if (this.session?.played)
        this.pendingPlaybackRestore = { timeSeconds: this.getPlaybackCurrentSeconds() };
      void this.progress?.flush({ force: true });
      VidaaBenchmark.notePlayerEvent?.("userSourceSwitch");
      this.candidate = stream;
      this.resolveError = null;
      this.sourcesStatus = null;
      this.closeTrackPanel();
      this.setControlsVisible(false);
    }
    // One context (and completion latch) per source, built after resolution like the old player.
    this.progressContext = buildProgressContext(this.params, this.candidate);
    // Each started source, like the old 35:233 (a synthetic link has no id and is skipped).
    rememberSelectedStreamPreference(this.params, this.candidate);
    saveReusableStreamLink(this, this.candidate, { url: result.url });
    // Where the Party is now wins over the route's position; a newer media server position wins
    // over the route's (old player 35:44-53). Neither overrides a source the user switches from.
    const partyMs = switching ? null : this.partyResumePositionMs();
    const restore =
      partyMs != null
        ? { timeSeconds: partyMs / 1000 }
        : !switching && result.serverResumeMs > 0
          ? { timeSeconds: result.serverResumeMs / 1000 }
          : this.pendingPlaybackRestore;
    this.playbackHeaders = result.headers || {};
    this.tracks.reset(result.url);
    this.session.attach(result.url, {
      ...restoreStartOptions(restore),
      headers: result.headers || null
    });
  },

  /** Leaving playback: save, journal, scrobble cancel, rating offer; before the decoder is freed. */
  finishPlayback() {
    // The Party reads the position before the decoder is freed, once (Android stopAndRelease).
    if (this.partyUnsubscribers?.length) {
      try {
        this.leavePartyPlayback();
      } catch (_) {}
      try {
        this.unbindParty();
      } catch (_) {}
    }
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
      toast: q(".p2-toast"),
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
    // The error owns the keys: stream info (above it) or a pending seek must not stay behind.
    // The Sources panel stays: it is the error's own way out.
    const keepSources = this.trackPanel === "sources";
    if (error && this.partyPanelVisible) this.dismissPartyPanel();
    if (
      error &&
      (this.streamInfoVisible ||
        this.controlsVisible ||
        this.seekCommitTimer !== null ||
        (this.trackPanel && !keepSources))
    ) {
      this.closeStreamInfo({ restore: false });
      this.resetOsdState();
      if (keepSources) {
        this.trackPanel = "sources";
        this.renderTrackPanel();
      }
    }
    // A failed source stays listed and marked; an image shown clears the mark.
    if (this.candidate && this.sources) {
      if (error) this.sources.markFailed(this.candidate);
      else if (session.firstFrame) this.sources.markFailed(this.candidate, false);
    }
    const loading = !error && !session.firstFrame;
    if (session.firstFrame) {
      this.tracks?.onFirstFrame();
      this.next?.onFirstFrame();
    }
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
    if (action === "sources") this.openSourcesPanel();
    else this.navigateBackToStreamScreen();
  },

  onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    this.session?.restoreSound();
    // The Sources panel opened from the error screen (or left over a new loading) owns the keys.
    if (this.trackPanel && (this.isErrorVisible() || !this.session?.firstFrame)) {
      event?.preventDefault?.();
      this.onTrackPanelKey(keyCode, event);
      return;
    }
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
    // The party panel owns every key while it is open (it may open during a loading).
    if (this.partyPanelVisible && this.handlePartyPanelKey(event)) return;
    // Loading: only Back acts (FocusEngine -> consumeBackRequest).
    if (!this.session?.firstFrame) return;
    // Still watching owns the keys; OK on the next episode card or the skip button acts on it.
    if (!this.streamInfoVisible && this.next?.onKey(keyCode, event)) {
      event?.preventDefault?.();
      return;
    }
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
    if (this.trackPanel) {
      event?.preventDefault?.();
      this.onTrackPanelKey(keyCode, event);
      return;
    }
    if (
      this.controlsVisible &&
      this.controlFocusZone === "actions" &&
      [13, 23, 37, 38, 39, 40].includes(keyCode)
    ) {
      event?.preventDefault?.();
      this.onActionKey(keyCode, event);
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
      // A visible OSD: Down goes to the Audio and Subtitles buttons.
      if (keyCode === 40 && this.controlsVisible && this.seekPreviewSeconds == null) {
        this.controlFocusZone = "actions";
        this.controlFocusIndex = 0;
      }
      this.setControlsVisible(true);
    }
  },

  onActionKey(keyCode, event) {
    if (keyCode === 37 || keyCode === 39) {
      const step = keyCode === 39 ? 1 : -1;
      this.controlFocusIndex = Math.max(
        0,
        Math.min(this.osdActionCount() - 1, this.controlFocusIndex + step)
      );
    } else if (keyCode === 38) this.controlFocusZone = "";
    else if (isSelectKey(keyCode) && !event?.repeat) {
      const action = OSD_ACTIONS[this.controlFocusIndex];
      if (action === "party") this.togglePartyPanel();
      else if (action === "sources") this.openSourcesPanel();
      else this.openTrackPanel(action);
      return;
    }
    this.resetControlsAutoHide();
    this.renderOsd();
  },

  // Audio or Subtitles panel: Up/Down move, OK chooses (and remembers), Back closes.
  openTrackPanel(kind) {
    if (!this.session?.firstFrame || this.isErrorVisible() || !this.tracks) return;
    if (!this.controlsVisible) this.setControlsVisible(true);
    this.trackPanel = kind;
    // Opening Audio reads the header again after a transient failure.
    if (kind === "audio") this.tracks.probeAgain();
    this.trackPanelFocus = Math.max(
      0,
      this.trackPanelItems().findIndex((item) => item.selected)
    );
    this.clearControlsAutoHide();
    this.renderTrackPanel();
  },

  // Sources: from the OSD or from the error screen, focus on the current source. The list is the
  // route's candidates; addons are asked again only through the Reload row.
  openSourcesPanel() {
    if (!this.sources) return;
    if (this.session?.firstFrame && !this.isErrorVisible() && !this.controlsVisible)
      this.setControlsVisible(true);
    this.trackPanel = "sources";
    this.sourcesStatus = null;
    this.focusCurrentSource();
    this.clearControlsAutoHide();
    this.renderTrackPanel();
  },

  focusCurrentSource() {
    const items = this.trackPanelItems();
    const current = items.findIndex((item) => item.selected);
    this.trackPanelFocus = current >= 0 ? current : items.length > 1 ? 1 : 0;
  },

  closeTrackPanel() {
    if (!this.trackPanel) return;
    if (this.trackPanel === "sources") {
      this.sources?.cancel();
      // Closing the panel while a chosen source resolves drops that choice.
      if (this.sourcesStatus?.kind === "opening") {
        this.resolveAttempt += 1;
        this.stopResolveCap();
      }
      this.sourcesStatus = null;
    }
    this.trackPanel = "";
    this.osd?.renderPanel(null);
    this.resetControlsAutoHide();
  },

  trackPanelItems() {
    if (this.trackPanel === "sources") return this.sourcePanelItems();
    if (!this.tracks) return [];
    if (this.trackPanel === "audio") return this.tracks.audioEntries();
    return [...this.tracks.subtitleEntries("builtIn"), ...this.tracks.subtitleEntries("addons")];
  },

  // Reload, then the sources of the filter; addon text only, never a link.
  sourcePanelItems() {
    const sources = this.sources;
    if (!sources) return [];
    const playing = t("sources_playing", [], "Playing");
    const failed = t("player2_source_failed_short", [], "Failed");
    const rows = sources.list().map((stream) => {
      const current = sources.isSame(stream, this.candidate);
      const isFailed = sources.isFailed(stream);
      const detail = String((stream.name ? stream.title : "") || stream.description || "")
        .split("\n")[0]
        .trim();
      return {
        stream,
        selected: current,
        failed: isFailed,
        label: normalizeStreamDisplayText(
          stream.name || stream.label || stream.title || stream.addonName || "Stream"
        ),
        secondary: [
          isFailed ? failed : current ? playing : "",
          normalizeStreamDisplayText(stream.addonName || ""),
          normalizeStreamDisplayText(detail)
        ]
          .filter(Boolean)
          .join(" · ")
      };
    });
    return [{ action: "reload", label: t("sources_reload", [], "Reload") }, ...rows];
  },

  renderSourcesPanel() {
    const sources = this.sources;
    const items = this.trackPanelItems();
    this.trackPanelFocus = Math.max(0, Math.min(items.length - 1, this.trackPanelFocus));
    const start = sourceWindowStart(items.length, this.trackPanelFocus);
    const filters = sources.filters();
    const filterName =
      sources.filter === "all"
        ? t("subtitle_all", [], "All")
        : normalizeStreamDisplayText(sources.filter);
    const status = this.sourcesStatus;
    const lines = [
      filters.length > 2 ? `‹ ${filterName} ›` : "",
      status?.kind === "opening"
        ? t("player2_source_opening", [], "Opening the source…")
        : status?.kind === "failed"
          ? [t("player2_source_failed", [], "This source could not be opened."), status.message]
              .filter(Boolean)
              .join("\n")
          : "",
      sources.loading
        ? t("stream_finding_source", [], "Finding stream source")
        : sources.error
          ? t("panel_failed_load_streams", [], "Failed to load streams")
          : items.length < 2
            ? t("sources_no_streams", [], "No streams found")
            : ""
    ];
    this.osd.renderPanel({
      title: t("sources_title", [], "Sources"),
      status: lines.filter(Boolean).join("\n"),
      items: items.slice(start, start + SOURCE_WINDOW),
      focus: this.trackPanelFocus,
      offset: start
    });
  },

  renderTrackPanel() {
    if (this.trackPanel === "sources" && this.sources && this.osd) {
      this.renderSourcesPanel();
      return;
    }
    const tracks = this.tracks;
    if (!this.trackPanel || !tracks || !this.osd) return;
    const items = this.trackPanelItems();
    this.trackPanelFocus = Math.max(0, Math.min(items.length - 1, this.trackPanelFocus));
    const audio = this.trackPanel === "audio";
    const status = audio
      ? !tracks.supported
        ? t("player2_audio_tv_managed", [], "Track choice is handled by the TV.")
        : tracks.audioError
          ? t("player2_audio_refused", [], "The TV did not keep this track.")
          : audioNamesLine(tracks.status())
      : tracks.subtitleError
        ? t("player2_subtitle_failed", [], "This subtitle could not be loaded.")
        : tracks.addonSubtitlesLoaded
          ? ""
          : t("player2_subtitles_loading", [], "Loading addon subtitles…");
    this.osd.renderPanel({
      title: audio
        ? t("audio_dialog_title", [], "Audio")
        : t("subtitle_dialog_title", [], "Subtitles"),
      status,
      items,
      focus: this.trackPanelFocus
    });
  },

  onTrackPanelKey(keyCode, event) {
    if (this.trackPanel === "sources" && (keyCode === 37 || keyCode === 39)) {
      this.sources?.cycleFilter(keyCode === 39 ? 1 : -1);
      this.focusCurrentSource();
      this.renderTrackPanel();
      return;
    }
    if (keyCode === 38 || keyCode === 40) {
      this.trackPanelFocus += keyCode === 40 ? 1 : -1;
      this.renderTrackPanel();
    } else if (isSelectKey(keyCode) && !event?.repeat) this.chooseTrack(this.trackPanelFocus);
  },

  chooseTrack(index) {
    const item = this.trackPanelItems()[index];
    if (!item) return;
    this.trackPanelFocus = index;
    if (this.trackPanel === "sources") this.chooseSource(item);
    else if (this.trackPanel === "audio")
      void this.applyAudioTrack(index, { rememberSelection: true });
    else void this.tracks?.selectSubtitle(item, { rememberSelection: true });
  },

  // OK on a row: Reload asks the addons again; a source is resolved, then played at the same
  // position. The current source playing fine just closes the panel.
  chooseSource(item) {
    if (item.action === "reload") {
      void this.sources?.reload();
      return;
    }
    if (
      this.sources?.isSame(item.stream, this.candidate) &&
      this.session?.firstFrame &&
      !this.isErrorVisible()
    ) {
      this.closeTrackPanel();
      this.resetControlsAutoHide();
      return;
    }
    this.sourcesStatus = { kind: "opening" };
    this.renderTrackPanel();
    void this.startCandidate(this.playerMountToken, item.stream, { switching: true });
  },

  // Same lookup as the old player (playerScreenMethods-07/68): stream sidecars, then addons.
  async loadAddonSubtitles() {
    const params = this.params || {};
    const type = normalizeItemType(params.itemType);
    const imdb = [params.imdbId, params.imdb_id, params.videoId, params.itemId]
      .map((value) => String(value || "").split(":")[0])
      .find((value) => /^tt\d+$/i.test(value));
    const rawItemId = String(params.itemId || "").trim();
    const id = imdb || rawItemId.split(":")[0] || rawItemId;
    const candidate = this.candidate || {};
    const raw = candidate.raw || candidate;
    const hints = { ...raw.behaviorHints, ...candidate.behaviorHints };
    const sidecars = (candidate.subtitles || raw.subtitles || [])
      .filter((subtitle) => subtitle?.url)
      .map((subtitle, index) => ({
        id: subtitle.id || `sidecar-${index}`,
        url: subtitle.url,
        lang: subtitle.lang || subtitle.language || "",
        addonName: candidate.addonName || raw.addonName || ""
      }));
    if (!id) return sidecars;
    let videoId = null;
    if (type === "series") {
      const season = Number(params.season);
      const episode = Number(params.episode);
      videoId =
        String(params.videoId || "").trim() ||
        (season > 0 && episode > 0 ? `${id}:${season}:${episode}` : null);
    }
    const found = await subtitleRepository.getSubtitles(type, id, videoId, {
      season: params.season ?? null,
      episode: params.episode ?? null,
      title: params.playerTitle || params.itemTitle || null,
      year: params.playerReleaseYear || params.year || null,
      videoHash: hints.videoHash || candidate.videoHash || params.videoHash || null,
      videoSize: hints.videoSize || candidate.videoSize || params.videoSize || null,
      filename: resolveStreamFilename(
        candidate,
        this.initialFilenameStreamCandidate,
        params.filename
      )
    });
    return [...sidecars, ...(Array.isArray(found) ? found : [])];
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
    this.controlFocusZone = "";
    this.controlFocusIndex = 0;
    this.trackPanel = "";
    this.osd?.renderPanel(null);
  },

  stopOsdTimers() {
    for (const name of ["osdHideTimer", "seekCommitTimer", "bufferingTimer"]) {
      if (this[name] !== null) clearTimeout(this[name]);
      this[name] = null;
    }
    if (this.osdTickTimer !== null) clearInterval(this.osdTickTimer);
    this.osdTickTimer = null;
  },

  osdActionCount() {
    return OSD_ACTIONS.length - (this.isPartyButtonAvailable() ? 0 : 1);
  },

  renderOsd() {
    const count = this.osdActionCount();
    if (this.controlFocusIndex >= count) this.controlFocusIndex = count - 1;
    this.osd?.update({
      visible: this.controlsVisible && Boolean(this.session?.firstFrame),
      paused: Boolean(this.video?.paused),
      current: this.getPlaybackCurrentSeconds(),
      duration: this.getPlaybackDurationSeconds(),
      preview: this.seekPreviewSeconds,
      action: this.controlFocusZone === "actions" ? this.controlFocusIndex : -1,
      party: count < OSD_ACTIONS.length ? 0 : PartyRepository.getState().party ? 2 : 1
    });
    // The pill follows the OSD (shown with it, or alone for a notice).
    this.renderPartyPill();
    // The card and the skip button give way to the OSD and its panels.
    this.next?.render();
  },

  // Zero OSD timer while it is hidden: the 1 Hz update and the auto-hide live only while shown.
  setControlsVisible(visible) {
    this.controlsVisible = Boolean(visible);
    if (!this.controlsVisible) {
      this.seekOpenedOsd = false;
      this.controlFocusZone = "";
      this.closeTrackPanel();
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
      this.streamInfoVisible ||
      this.trackPanel ||
      this.partyPanelVisible
    )
      return;
    this.osdHideTimer = setTimeout(() => {
      this.osdHideTimer = null;
      this.setControlsVisible(false);
    }, OSD_HIDE_MS);
  },

  togglePause() {
    if (!this.session?.firstFrame || this.isErrorVisible()) return;
    // A Party guest only pauses for itself (and falls behind) or resumes from behind.
    if (this.isPartyControlLocked()) {
      this.toggleOwnPlayback();
      return;
    }
    const wasPaused = Boolean(this.video?.paused);
    if (wasPaused) this.session.resume();
    else this.session.pause();
    this.setControlsVisible(true);
    this.publishPartyPlayback({ paused: !wasPaused });
  },

  // A user seek (seek preview, skip intro): a Party guest may only fall behind; then published.
  userSeek(seconds) {
    const targetMs = this.partyUserSeekTarget(Math.round(Number(seconds) * 1000));
    if (targetMs == null || !this.seekPlaybackSeconds(targetMs / 1000)) return false;
    this.publishPartyPlayback({ positionMs: targetMs });
    return true;
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
    if (target != null) this.userSeek(target);
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
    const panel = target?.closest?.("[data-p2-osd]")?.dataset?.p2Osd;
    if (panel === "party" && !this.isErrorVisible()) this.togglePartyPanel();
    else if (panel === "sources" && !this.isErrorVisible()) this.openSourcesPanel();
    else if (panel && !this.isErrorVisible()) this.openTrackPanel(panel);
    const item = target?.closest?.("[data-p2-item]")?.dataset?.p2Item;
    if (item != null && this.trackPanel) this.chooseTrack(Number(item));
  },

  onPointerFocus() {},
  onPointerMove() {},

  // Back order: party panel, panel, seek preview, still watching / next card / skip intro,
  // visible OSD, then leave.
  // Loading and error leave once the panel (Sources over the error) is closed;
  // navigateBackToStreamScreen locks a doubled Back.
  consumeBackRequest() {
    if (this.partyPanelVisible && !this.playerBackNavigationInProgress) {
      this.dismissPartyPanel();
      return true;
    }
    if (this.trackPanel && !this.playerBackNavigationInProgress) {
      this.closeTrackPanel();
      return true;
    }
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
    const nextBack = this.next?.back();
    if (nextBack) return nextBack;
    if (this.controlsVisible) {
      this.setControlsVisible(false);
      return true;
    }
    return this.navigateBackToStreamScreen();
  },

  // Same list as the old player: a visible OSD alone lets a history Back return to Sources.
  hasBackDismissableOverlay() {
    return Boolean(
      this.partyPanelVisible ||
      this.trackPanel ||
      this.streamInfoVisible ||
      this.seekPreviewSeconds != null ||
      this.next?.hasOverlay()
    );
  },

  cancelSourceLoad() {
    this.sources?.cancel();
  },

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

  // Same shape as the old player (playerScreenMethods-21).
  buildReturnStreamRouteParamsFromPlayer() {
    const params = this.params || {};
    const itemType = normalizeItemType(params.itemType);
    const series = isSeriesItemType(itemType);
    const currentEpisode = series ? this.resolveCurrentEpisodeEntry() : null;
    const nextEpisode = series ? this.resolveNextEpisodeInfo() : null;
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
      nextEpisodeVideoId: nextEpisode?.videoId || null,
      nextEpisodeLabel: nextEpisode?.episodeLabel || null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.episodeTitle || "",
      nextEpisodeReleased: nextEpisode?.released || "",
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
  // Only the Party host changes it (no speed control in the new player).
  getPlaybackSpeed() {
    return Number(this.video?.playbackRate) || 1;
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
  // Phone remote "next episode" and the Watch Party (host moving to the next episode).
  resolveNextEpisodeInfo() {
    return this.next?.info() || null;
  },
  playNextEpisode({ userInitiated = true } = {}) {
    return this.next ? this.next.play({ userInitiated }) : Promise.resolve(false);
  },
  // Tracks (P4): read by the phone remote and Stream info.
  get subtitleDialogVisible() {
    return this.trackPanel === "subtitles";
  },
  get selectedAddonSubtitleId() {
    return this.tracks?.selectedAddonSubtitleId || "";
  },
  openSubtitleDialog() {
    this.openTrackPanel("subtitles");
  },
  closeSubtitleDialog() {
    if (this.trackPanel === "subtitles") this.closeTrackPanel();
  },
  getSubtitleEntries(kind = "builtIn") {
    return this.tracks?.subtitleEntries(kind === "addons" ? "addons" : "builtIn") || [];
  },
  getAudioEntries() {
    return this.tracks?.audioEntries() || [];
  },
  applyAudioTrack(index, { rememberSelection = false } = {}) {
    if (!this.session?.firstFrame || !this.tracks) return Promise.resolve(false);
    return this.tracks.selectAudio(Number(index), { rememberSelection });
  },
  openAudioDialog() {
    this.openTrackPanel("audio");
  },
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
    // Countdowns, the source search and the card go first (player -> player reuses this object).
    try {
      this.next?.destroy();
    } catch (_) {}
    this.next = null;
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
      // Added subtitle <track> elements and their blobs, and any header read in flight.
      try {
        this.tracks?.destroy();
        headerReader?.dispose();
      } catch (_) {}
      this.tracks = null;
      try {
        this.sources?.cancel();
      } catch (_) {}
      this.sources = null;
      this.sourcesStatus = null;
      this.personalWatchRun = null;
      this.partyPanelVisible = false;
      clearTimeout(this.aspectToastTimer);
      this.partyRefs = null;
      this.root?.remove();
      this.root = null;
      this.refs = null;
      if (this.video && this.videoAutoplay) this.video.setAttribute("autoplay", "");
      if (this.container) this.container.style.display = "none";
    }
  }
};
