import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.fetch = () => {
  throw new Error("Unexpected network request");
};

const { PlayerController } = await import("../js/core/player/playerController.js");
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");
const controller = { ...PlayerController };
const tests = [];
const test = (name, run) => tests.push({ name, run });

function fixture() {
  const en = { id: "english", language: "en", codec: "aac", enabled: true };
  const it = { id: "italian", language: "it", codec: "aac", enabled: false };
  const video = { src: "fixture-video", audioTracks: [en, it], textTracks: [] };
  Platform.current = null;
  Object.assign(PlayerController, controller, {
    video,
    playbackEngine: "native-file",
    playRequestToken: 1,
    avplayActive: false,
    hlsInstance: null,
    dashInstance: null,
    avplayTrackInfo: [],
    setNativeAudioTrack(index) {
      this.video.audioTracks.forEach((track, ordinal) => {
        track.enabled = ordinal === index;
      });
      return true;
    }
  });
  const ui = {
    ...PlayerScreen,
    playerMountToken: 1,
    sourcePlaybackAttemptToken: 1,
    activePlaybackUrl: "fixture-video",
    externalTrackNodes: [],
    embeddedAudioTracks: [],
    embeddedSubtitleTracks: [],
    manifestAudioTracks: [],
    manifestSubtitleTracks: [],
    selectedAudioTrackIndex: 0,
    selectedEmbeddedAudioTrackIndex: -1,
    selectedSubtitleTrackIndex: -1,
    selectedEmbeddedSubtitleTrackIndex: -1,
    audioSelectionToken: 0,
    shouldUseEmbeddedSubtitleTracks: () => false,
    renderControlButtons() {},
    renderAudioDialog() {}
  };
  ui.invalidateTrackDialogCaches();
  return { ui, video, en, it };
}

test("a visible cached Italian entry follows its native object when the list reorders before change", async () => {
  const { ui, video, en, it } = fixture();
  const italianIndex = ui.getAudioEntries().findIndex((entry) => entry.track.language === "it");
  video.audioTracks = [it, en];
  assert.equal(await ui.applyAudioTrack(italianIndex), true);
  assert.equal(it.enabled, true);
  assert.equal(en.enabled, false);
  assert.equal(ui.selectedAudioTrackIndex, 0);
});

test("a cached entry resolves replacement track objects before the first backend write", async () => {
  const { ui, video } = fixture();
  const italianIndex = ui.getAudioEntries().findIndex((entry) => entry.track.language === "it");
  const it = { id: "italian", language: "it", codec: "aac", enabled: false };
  const en = { id: "english", language: "en", codec: "aac", enabled: true };
  video.audioTracks = [it, en];
  assert.equal(await ui.applyAudioTrack(italianIndex), true);
  assert.equal(it.enabled, true);
  assert.equal(en.enabled, false);
});

test("a pending native completion cannot commit after the playback engine changes", async () => {
  const { ui, it, en } = fixture();
  let finish;
  PlayerController.setNativeAudioTrack = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const selecting = ui.applyAudioTrack(1);
  PlayerController.playbackEngine = "hls";
  PlayerController.hlsInstance = {};
  it.enabled = true;
  en.enabled = false;
  finish(true);
  assert.equal(await selecting, false);
  assert.equal(ui.selectedAudioTrackIndex, 0);
});

test("a cached entry from a retired engine is rejected before requesting selection", async () => {
  const { ui } = fixture();
  ui.getAudioEntries();
  PlayerController.playbackEngine = "hls";
  PlayerController.hlsInstance = {};
  let writes = 0;
  PlayerController.setNativeAudioTrack = () => {
    writes++;
    return true;
  };
  assert.equal(await ui.applyAudioTrack(1), false);
  assert.equal(writes, 0);
});

test("an absent cached native identity cannot select another track at the reused ordinal", async () => {
  const { ui, video } = fixture();
  ui.getAudioEntries();
  video.audioTracks = [{ id: "commentary", language: "it", codec: "aac", enabled: true }];
  let writes = 0;
  PlayerController.setNativeAudioTrack = () => {
    writes++;
    return true;
  };
  assert.equal(await ui.applyAudioTrack(1), false);
  assert.equal(writes, 0);
  assert.equal(video.audioTracks[0].enabled, true);
});

test("conflicting container metadata cannot replace a native track's explicit codec", () => {
  const { ui } = fixture();
  ui.embeddedAudioTracks = [
    { embeddedTrackIndex: 0, nativeTrackIndex: 0, language: "en", codec: "dts" }
  ];
  const merged = ui.mergeEmbeddedAudioTrackMetadata(
    { id: "french", language: "fr", codec: "aac" },
    0
  );
  assert.equal(merged.codec, "aac");
  assert.equal(merged.language, "fr");
});

test("a filtered native list matches its language and codec without duplicating probe entries", () => {
  const { ui, video, en } = fixture();
  video.audioTracks = [en];
  ui.embeddedAudioTracks = ui.normalizeEmbeddedAudioTracks([
    { type: "audio", id: 1, language: "it", codec: "dts" },
    { type: "audio", id: 2, language: "en", codec: "aac" }
  ]);
  const entries = ui.getAudioEntries();
  assert.equal(entries.length, 2);
  const native = entries.find((entry) => entry.nativeAudioTrack);
  assert.equal(native.track.language, "en");
  assert.equal(native.track.codec, "aac");
  assert.equal(native.selected, true);
  const unavailable = entries.find((entry) => entry.embeddedAudioTrackIndex != null);
  assert.equal(unavailable.track.language, "it");
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.unsupportedReason, "native-track-unavailable");
});

test("probe-only audio leaves automatic playback selected and never invokes a WebOS selector on VIDAA", async () => {
  const { ui, video } = fixture();
  video.audioTracks = [];
  video.muted = false;
  video.paused = false;
  ui.getCurrentStreamCandidate = () => ({ url: "fixture-video" });
  ui.embeddedAudioTracks = ui.normalizeEmbeddedAudioTracks([
    { type: "audio", id: 1, language: "it", codec: "aac" }
  ]);
  let writes = 0;
  PlayerController.setWebOsEmbeddedAudioTrack = () => {
    writes++;
    return true;
  };
  const entries = ui.getAudioEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].implicitAudioTrack, true);
  assert.equal(entries[0].selected, true);
  assert.equal(entries[0].supported, true);
  assert.equal(entries[1].supported, false);
  assert.equal(entries[1].unsupportedReason, "native-track-unavailable");
  await ui.applyAudioTrack(1);
  assert.equal(writes, 0);
  assert.equal(ui.pendingWebOsAudioSelection, undefined);
  assert.equal(video.muted, false);
  assert.equal(video.paused, false);
});

test("automatic fallback stays owned until asynchronous native confirmation settles", async () => {
  const { ui } = fixture();
  ui.getAudioEntries = () => [
    { id: "unsupported", supported: false, selected: true },
    { id: "supported", supported: true, selected: false }
  ];
  let finish;
  let requests = 0;
  ui.applyAudioTrack = () => {
    requests++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  assert.equal(ui.ensureSupportedAudioTrackSelected(), true);
  assert.equal(ui.ensureSupportedAudioTrackSelected(), false);
  assert.equal(requests, 1);
  finish(true);
  for (let index = 0; index < 10; index++) await Promise.resolve();
  assert.equal(ui.audioFallbackApplying, false);
});

let failures = 0;
try {
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${name}: ${error.message}`);
    }
  }
} finally {
  Object.assign(PlayerController, controller);
}
assert.equal(failures, 0, `${failures} audio identity checks failed`);
