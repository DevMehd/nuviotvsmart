import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { Platform } = await import("../js/platform/index.js");
const { localMediaTracksRepository } =
  await import("../js/data/repository/localMediaTracksRepository.js");
const { subtitleRepository } = await import("../js/data/repository/subtitleRepository.js");
const originalGetTracks = localMediaTracksRepository.getTracks;
const originalGetSubtitles = subtitleRepository.getSubtitles;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function screen() {
  let refreshes = 0;
  let rendererDestroyed = 0;
  let removedTracks = 0;
  const ui = {
    ...PlayerScreen,
    uiRefs: {},
    playerMountToken: 1,
    sourcePlaybackAttemptToken: 1,
    activePlaybackUrl: "https://fixture.invalid/old.mkv",
    audioSelectionToken: 4,
    subtitleSelectionToken: 5,
    embeddedSubtitleLoadToken: 6,
    subtitleLoadToken: 7,
    manifestLoadToken: 8,
    trackDiscoveryToken: 9,
    externalTrackNodes: [
      {
        remove() {
          removedTracks++;
        }
      }
    ],
    externalSubtitleObjectUrls: [],
    subtitles: [{ id: "old-addon" }],
    embeddedSubtitleTracks: [{ id: "old-subtitle" }],
    embeddedAudioTracks: [{ id: "old-audio" }],
    manifestSubtitleTracks: [{ id: "old-manifest-subtitle" }],
    manifestAudioTracks: [{ id: "old-manifest-audio" }],
    manifestVariants: [],
    htmlSubtitleCues: [{ text: "Old source" }],
    htmlSubtitleSelectedId: "old-addon",
    selectedAddonSubtitleId: "old-addon",
    selectedAddonSubtitleIdentity: "old-addon-identity",
    selectedAudioTrackIndex: 3,
    selectedSubtitleTrackIndex: 2,
    selectedEmbeddedAudioTrackIndex: 1,
    selectedEmbeddedSubtitleTrackIndex: 1,
    pendingNativeSubtitleSelection: { isCurrent: () => true },
    startupTrackPreferenceReady: true,
    startupAudioPreferenceApplied: true,
    startupSubtitlePreferenceApplied: true,
    rememberedAudioTrackPreference: { language: "it", name: "Italiano" },
    rememberedSubtitleTrackPreference: { type: "DISABLED" },
    pendingPlaybackRestore: { timeSeconds: 75, paused: false },
    assSubtitleRenderer: {
      destroy() {
        rendererDestroyed++;
      }
    },
    getCurrentStreamCandidate: () => null,
    getPlaybackCurrentSeconds: () => 0,
    getCurrentStreamRequestHeaders: () => ({}),
    canDiscoverEmbeddedSubtitleTracks: () => true,
    canDiscoverEmbeddedAudioTracks: () => true,
    normalizeEmbeddedSubtitleTracks: (tracks) =>
      tracks.filter((track) => track.type === "subtitle"),
    normalizeEmbeddedAudioTracks: (tracks) => tracks.filter((track) => track.type === "audio"),
    warmBitmapSubtitleSharedResources() {},
    refreshTrackDialogs() {
      refreshes++;
    },
    collectStreamSidecarSubtitles: () => [],
    buildSubtitleLookupContext: () => ({ id: "film", type: "movie" }),
    mergeSubtitleCandidates: (sidecars, addons) => [...sidecars, ...addons]
  };
  Object.assign(PlayerController, {
    video: { src: ui.activePlaybackUrl },
    playRequestToken: 10,
    selectedWebOsEmbeddedAudioTrackIndex: -1,
    selectedWebOsEmbeddedSubtitleTrackIndex: -1
  });
  return {
    ui,
    refreshes: () => refreshes,
    rendererDestroyed: () => rendererDestroyed,
    removedTracks: () => removedTracks
  };
}

try {
  Platform.current = null;
  const { ui, rendererDestroyed, removedTracks } = screen();
  const rememberedAudio = ui.rememberedAudioTrackPreference;
  const rememberedSubtitle = ui.rememberedSubtitleTrackPreference;
  const restore = ui.pendingPlaybackRestore;
  let aborted = 0;
  ui.manifestLoadAbortController = {
    abort() {
      aborted++;
    }
  };
  const oldTracks = deferred();
  const oldAddons = deferred();
  localMediaTracksRepository.getTracks = () => oldTracks.promise;
  subtitleRepository.getSubtitles = () => oldAddons.promise;
  const oldDiscovery = ui.loadEmbeddedSubtitleTracks();
  const oldAddonDiscovery = ui.loadSubtitles();

  // This is the automatic fallback gap: stop has occurred, the next URL is unresolved.
  ui.resetSourceTrackState();
  const retiredLoadToken = ui.embeddedSubtitleLoadToken;
  assert.equal(ui.audioSelectionToken, 5);
  assert.equal(ui.subtitleSelectionToken, 6);
  assert.equal(ui.selectedAudioTrackIndex, -1);
  assert.equal(ui.selectedSubtitleTrackIndex, -1);
  assert.equal(ui.pendingNativeSubtitleSelection, null);
  assert.equal(ui.startupTrackPreferenceReady, false);
  assert.equal(aborted, 1);
  assert.equal(rendererDestroyed(), 1);
  assert.equal(removedTracks(), 1);
  assert.deepEqual(ui.htmlSubtitleCues, []);
  assert.equal(ui.rememberedAudioTrackPreference, rememberedAudio);
  assert.equal(ui.rememberedSubtitleTrackPreference, rememberedSubtitle);
  assert.equal(ui.pendingPlaybackRestore, restore);
  oldTracks.resolve([
    { type: "audio", id: "old-it" },
    { type: "subtitle", id: "old-en" }
  ]);
  oldAddons.resolve([{ id: "old-result", url: "https://fixture.invalid/old.vtt" }]);
  await Promise.all([oldDiscovery, oldAddonDiscovery]);
  assert.deepEqual(
    ui.embeddedAudioTracks,
    [],
    "A retired probe cannot repopulate audio while the next resolver waits"
  );
  assert.deepEqual(ui.embeddedSubtitleTracks, []);
  assert.deepEqual(
    ui.subtitles,
    [],
    "Retired source-specific addon results cannot reach startup preferences"
  );
  assert.equal(ui.embeddedSubtitleLoadToken, retiredLoadToken);
  assert.equal(ui.embeddedAudioLoading, false);
  assert.equal(ui.subtitleLoading, false);
  console.log(
    "PASS fallback retires old discovery, selection and renderers before the next resolver completes"
  );

  ui.sourcePlaybackAttemptToken++;
  ui.activePlaybackUrl = "https://fixture.invalid/new.mkv";
  localMediaTracksRepository.getTracks = async () => [
    { type: "audio", id: "new-it" },
    { type: "subtitle", id: "new-en" }
  ];
  await ui.loadEmbeddedSubtitleTracks();
  assert.deepEqual(ui.embeddedAudioTracks, [{ type: "audio", id: "new-it" }]);
  assert.deepEqual(ui.embeddedSubtitleTracks, [{ type: "subtitle", id: "new-en" }]);
  assert.equal(ui.lastEmbeddedTrackProbeUrl, ui.activePlaybackUrl);
  console.log("PASS replacement source accepts only its own audio/subtitle discovery");

  const stale = screen();
  const pending = deferred();
  localMediaTracksRepository.getTracks = () => pending.promise;
  const probe = stale.ui.loadEmbeddedSubtitleTracks();
  const refreshesBefore = stale.refreshes();
  stale.ui.sourcePlaybackAttemptToken++;
  pending.resolve([{ type: "audio", id: "retired" }]);
  await probe;
  assert.deepEqual(stale.ui.embeddedAudioTracks, []);
  assert.equal(
    stale.refreshes(),
    refreshesBefore,
    "An old attempt cannot clear loading or refresh preference UI"
  );
  console.log("PASS discovery rejects a different source attempt even before the new URL is known");

  const recovery = screen().ui;
  const selectedAudio = recovery.selectedAudioTrackIndex;
  const selectedSubtitle = recovery.selectedAddonSubtitleId;
  const subtitleToken = recovery.subtitleSelectionToken;
  const audioTracks = recovery.embeddedAudioTracks;
  recovery.webOsEmbeddedTextSubtitleTrack = { sourceTrackId: 4 };
  const embeddedSubtitleTrack = recovery.webOsEmbeddedTextSubtitleTrack;
  recovery.pendingWebOsAddonSubtitleRestore = { subtitleSelectionToken: subtitleToken };
  const addonRestore = recovery.pendingWebOsAddonSubtitleRestore;
  recovery.resetSourceTrackState({ preserveWebOsTrackSelections: true, discoveryInProgress: true });
  assert.equal(recovery.selectedAudioTrackIndex, selectedAudio);
  assert.equal(recovery.selectedAddonSubtitleId, selectedSubtitle);
  assert.equal(recovery.subtitleSelectionToken, subtitleToken);
  assert.equal(recovery.embeddedAudioTracks, audioTracks);
  assert.equal(recovery.webOsEmbeddedTextSubtitleTrack, embeddedSubtitleTrack);
  assert.equal(recovery.pendingWebOsAddonSubtitleRestore, addonRestore);
  assert.equal(recovery.trackDiscoveryInProgress, true);
  console.log("PASS same-source webOS recovery retains its selection and pending addon restore");
} finally {
  localMediaTracksRepository.getTracks = originalGetTracks;
  subtitleRepository.getSubtitles = originalGetSubtitles;
}
