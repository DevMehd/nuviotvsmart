import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.window = new EventTarget();
globalThis.document = {
  getElementById: () => null,
  documentElement: {},
  visibilityState: "visible"
};
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const {
  PlayerScreen,
  PlayerController,
  subtitleRepository,
  localMediaTracksRepository,
  streamRepository,
  DirectDebridResolver
} = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");
const { initializePlayerMountState } =
  await import("../js/ui/screens/player/playerMountStateInitialization.js");
const { createPlayerVideoLifecycleHandlers } =
  await import("../js/ui/screens/player/playerVideoLifecycleHandlers.js");

// The source/track orchestration and selection methods stay real. Only native
// decoder I/O, repository I/O and UI presentation have test doubles.
const controller = { ...PlayerController };
const originals = {
  now: Date.now,
  setTimeout,
  clearTimeout,
  getSubtitles: subtitleRepository.getSubtitles,
  getTracks: localMediaTracksRepository.getTracks,
  pauseSearch: streamRepository.setLocalPluginSearchPaused,
  canResolve: DirectDebridResolver.canResolveStream,
  resolve: DirectDebridResolver.resolve
};
let now = 100000;
let nextTimer = 0;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextTimer;
  timers.set(id, { callback, at: now + Number(delay || 0) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
subtitleRepository.getSubtitles = async () => [];
localMediaTracksRepository.getTracks = async () => [];
streamRepository.setLocalPluginSearchPaused = () => {};

async function drain() {
  for (let index = 0; index < 80; index++) await Promise.resolve();
}
async function advance(ms) {
  const end = now + ms;
  await drain();
  let count = 0;
  while (true) {
    const due = [...timers]
      .filter(([, timer]) => timer.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    assert.ok(++count < 150, "Native confirmations and discovery timers remain bounded");
    const [id, timer] = due;
    timers.delete(id);
    now = timer.at;
    timer.callback();
    await drain();
  }
  now = end;
  await drain();
}
function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function list(tracks) {
  return Object.assign(new EventTarget(), {
    length: tracks.length,
    item: (index) => tracks[index]
  });
}
function track(id, language, flag, initial) {
  const result = Object.assign(new EventTarget(), {
    id,
    language,
    label: language === "it" ? "Italiano" : "English",
    delay: 0,
    cues: []
  });
  let value = initial;
  Object.defineProperty(result, flag, {
    enumerable: true,
    get: () => value,
    set(next) {
      if (result.delay)
        setTimeout(() => {
          value = next;
        }, result.delay);
      else value = next;
    }
  });
  return result;
}
function sourceTracks(id) {
  // Native IDs are local to each source: ID 2 is Italian on A but English on B.
  const languages = id === "a" ? ["en", "it"] : ["it", "en"];
  return {
    audio: languages.map((language, index) =>
      track(index + 1, language, "enabled", id === "a" ? index === 0 : index === 1)
    ),
    text: languages.map((language, index) =>
      track(index + 1, language, "mode", language === "en" ? "showing" : "disabled")
    )
  };
}
function fixture({ resolveNext = false } = {}) {
  Platform.current = null;
  const video = Object.assign(new EventTarget(), {
    currentTime: 0,
    duration: 3600,
    paused: false,
    ended: false,
    readyState: 4,
    src: "",
    currentSrc: ""
  });
  const sources = [
    { id: "a", url: "https://fixture.invalid/a.mp4", addonName: "fixture" },
    {
      id: "b",
      ...(resolveNext ? {} : { url: "https://fixture.invalid/b.mp4" }),
      addonName: "fixture"
    }
  ];
  const native = new Map(sources.map((source) => [source.id, sourceTracks(source.id)]));
  const playCalls = [];
  const resolver = deferred();
  DirectDebridResolver.canResolveStream = (source) => resolveNext && source.id === "b";
  DirectDebridResolver.resolve = () => resolver.promise;
  Object.assign(PlayerController, controller, {
    video,
    playbackEngine: "native",
    avplayActive: false,
    hlsInstance: null,
    dashInstance: null,
    avplayTrackInfo: [],
    nativeMediaId: "",
    playRequestToken: 0,
    setStartupAudioGate() {},
    setStartupPresentationAudioMuted() {},
    async play(url) {
      const id = url.includes("/a.mp4") ? "a" : "b";
      playCalls.push(id);
      this.playRequestToken++;
      video.src = video.currentSrc = url;
      video.audioTracks = list(native.get(id).audio);
      video.textTracks = list(native.get(id).text);
      video.currentTime = 0;
    },
    async stop() {
      this.playRequestToken++;
      video.currentTime = 0;
    },
    seekToSeconds(seconds) {
      video.currentTime = seconds;
      return true;
    }
  });
  const params = {
    itemId: `fixture-${resolveNext ? "off" : "internal"}`,
    itemType: "movie",
    videoId: "fixture-video"
  };
  const ui = {
    ...PlayerScreen,
    params,
    container: {},
    uiRefs: {},
    playerRouteActive: true,
    playerMountToken: 1,
    streamCandidates: sources,
    currentStreamIndex: 0
  };
  initializePlayerMountState.call(ui, params, sources[0].url);
  Object.assign(ui, {
    subtitleStyle: {},
    subtitleDelayMs: 0,
    subtitleRenderMode: "native",
    currentEngineFsStream: null,
    trackPreferenceContentId: params.itemId
  });
  for (const name of [
    "renderControlButtons",
    "renderSubtitleDialog",
    "renderAudioDialog",
    "renderSpeedDialog",
    "renderSourcesPanel",
    "renderSubtitleDelayOverlay",
    "renderSubtitleTimingDialog",
    "renderEpisodePanel",
    "updateModalBackdrop",
    "updateUiTick",
    "updateLoadingVisibility",
    "syncLoadingOverlayStatus",
    "setControlsVisible",
    "resetControlsAutoHide",
    "scheduleLoadingCompletionCheck",
    "schedulePlaybackStallGuard",
    "updateMediaSessionPositionState",
    "applyAudioAmplification",
    "applySubtitlePresentationSettings",
    "applyAspectMode"
  ])
    ui[name] = () => {};
  const lifecycle = createPlayerVideoLifecycleHandlers.call(ui, video, () => false);
  return { ui, video, sources, native, playCalls, resolver, metadata: lifecycle.onLoadedMetadata };
}
async function startAndRemember(fixture, subtitleType) {
  const { ui, metadata } = fixture;
  await ui.playStreamCandidate(fixture.sources[0], { mountToken: 1 });
  await drain();
  assert.deepEqual(
    fixture.playCalls,
    ["a"],
    "Source A starts through the production source pipeline"
  );
  assert.equal(ui.startupErrorMessage, "");
  metadata();
  await advance(50);
  await ui.applyAudioTrack(1, { rememberSelection: true });
  ui.syncTrackState();
  const subtitle = ui
    .collectSubtitleOptionItems()
    .find((option) =>
      subtitleType === "off"
        ? option.sourceType === "off"
        : option.sourceType === "internal" && option.languageKey === "it"
    );
  assert.ok(subtitle, "Source A exposes the user's subtitle choice");
  ui.rememberSubtitleTrackSelection(subtitle);
  await ui.applySubtitleEntry(subtitle.entry);
  ui.syncTrackState();
  ui.hasPresentedPlaybackFrame = true;
  fixture.video.currentTime = 80;
  assert.equal(ui.selectedAudioTrackIndex, 1);
  assert.equal(ui.rememberedAudioTrackPreference.language, "it");
  assert.equal(ui.rememberedAudioTrackPreference.trackId, "2");
  assert.equal(
    ui.rememberedSubtitleTrackPreference.type,
    subtitleType === "off" ? "DISABLED" : "INTERNAL"
  );
}
function failCurrent({ ui, sources }) {
  ui.showStartupError("FAILURE", {
    streamCandidate: sources[0],
    playbackUrl: sources[0].url,
    sourceAttemptToken: ui.sourcePlaybackAttemptToken,
    reason: "native-failure"
  });
}
function assertItalianAudio({ ui, native }) {
  assert.deepEqual(
    native.get("b").audio.map((audio) => audio.enabled),
    [true, false]
  );
  assert.equal(ui.selectedAudioTrackIndex, 0, "Remembered Italian follows the new source's index");
  assert.equal(ui.startupAudioPreferenceApplied, true);
}

const tests = [
  [
    "FAILURE resolves the next source, retires old renderers and restores Italian audio with subtitles OFF",
    async () => {
      const current = fixture({ resolveNext: true });
      const { ui, native, resolver, metadata } = current;
      await startAndRemember(current, "off");
      let destroyed = 0;
      let disposed = 0;
      ui.assSubtitleRenderer = { destroy: () => destroyed++ };
      ui.bitmapSubtitleDecoder = { dispose: () => disposed++ };
      ui.bitmapSubtitleTrack = { id: "old-bitmap" };
      ui.webOsEmbeddedTextSubtitleTrack = { embeddedTextProvider: "vidaa-range" };
      ui.htmlSubtitleSelectedId = "vidaa-embedded-text-old";
      ui.htmlSubtitleCues = [{ start: 0, end: 100, text: "old source" }];
      ui.htmlSubtitleRenderTimer = setTimeout(
        () => assert.fail("Old subtitle renderer survived source failure"),
        200
      );
      failCurrent(current);
      assert.equal(ui.hasPresentedPlaybackFrame, false);
      assert.equal(ui.startupTrackPreferenceReady, false);
      assert.equal(ui.startupAudioPreferenceApplied, false);
      assert.equal(ui.startupSubtitlePreferenceApplied, false);
      assert.equal(ui.assSubtitleRenderer, null);
      assert.equal(ui.bitmapSubtitleDecoder, null);
      assert.equal(ui.webOsEmbeddedTextSubtitleTrack, null);
      assert.deepEqual(ui.htmlSubtitleCues, []);
      assert.equal(destroyed, 1);
      assert.equal(disposed, 1);
      await advance(250);
      assert.deepEqual(
        current.playCalls,
        ["a"],
        "Fallback reset occurs before its resolver finishes"
      );
      resolver.resolve({ status: "success", stream: { url: "https://fixture.invalid/b.mp4" } });
      await drain();
      assert.deepEqual(current.playCalls, ["a", "b"]);
      assert.equal(
        native.get("b").text[1].mode,
        "showing",
        "The new decoder initially enables its default subtitle"
      );
      metadata();
      await advance(900);
      ui.refreshTrackDialogs();
      await drain();
      assertItalianAudio(current);
      assert.deepEqual(
        native.get("b").text.map((text) => text.mode),
        ["disabled", "disabled"]
      );
      assert.equal(ui.selectedSubtitleTrackIndex, -1);
      assert.deepEqual(
        ui
          .collectSubtitleOptionItems()
          .filter((option) => option.selected)
          .map((option) => option.sourceType),
        ["off"]
      );
      assert.equal(ui.htmlSubtitleSelectedId, null);
    }
  ],
  [
    "Remembered internal Italian remaps exclusively and pending old native confirmations cannot overwrite the new source",
    async () => {
      const current = fixture();
      const { ui, native, metadata } = current;
      await startAndRemember(current, "internal");
      const old = native.get("a");
      old.audio.forEach((audio) => {
        audio.delay = 180;
      });
      old.text.forEach((text) => {
        text.delay = 180;
      });
      const pendingAudio = ui.applyAudioTrack(0);
      const pendingSubtitle = ui.applySubtitleEntry({ trackIndex: 0 });
      failCurrent(current);
      await drain();
      assert.deepEqual(current.playCalls, ["a", "b"]);
      assert.equal(ui.startupTrackPreferenceReady, false);
      metadata();
      await advance(900);
      assert.equal(await pendingAudio, false);
      assert.equal(await pendingSubtitle, false);
      ui.refreshTrackDialogs();
      await drain();
      assertItalianAudio(current);
      assert.deepEqual(
        native.get("b").text.map((text) => text.mode),
        ["showing", "disabled"]
      );
      assert.equal(ui.selectedSubtitleTrackIndex, 0);
      const selected = ui.collectSubtitleOptionItems().filter((option) => option.selected);
      assert.equal(selected.length, 1);
      assert.equal(selected[0].sourceType, "internal");
      assert.equal(selected[0].languageKey, "it");
      assert.equal(ui.rememberedSubtitleTrackPreference.language, "it");
      assert.equal(ui.rememberedSubtitleTrackPreference.trackId, "2");
      assert.equal(ui.activePlaybackUrl, "https://fixture.invalid/b.mp4");
    }
  ]
];

let passed = 0;
try {
  for (const [name, run] of tests) {
    timers.clear();
    await run();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`${passed}/${tests.length} VIDAA source/track integration tests passed`);
} finally {
  Object.assign(PlayerController, controller);
  Date.now = originals.now;
  globalThis.setTimeout = originals.setTimeout;
  globalThis.clearTimeout = originals.clearTimeout;
  subtitleRepository.getSubtitles = originals.getSubtitles;
  localMediaTracksRepository.getTracks = originals.getTracks;
  streamRepository.setLocalPluginSearchPaused = originals.pauseSearch;
  DirectDebridResolver.canResolveStream = originals.canResolve;
  DirectDebridResolver.resolve = originals.resolve;
}
