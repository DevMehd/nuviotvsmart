import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };

const { PlayerController } = await import("../js/core/player/playerController.js");
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");
const { nativeAudioTrackSelectionMatches } =
  await import("../js/core/player/playerControllerMethods-02-is-likely-direct-file-url.js");
const { selectVidaaTextTrack } = await import("../js/platform/vidaa/vidaaVideo.js");

function useTracks(audioTracks = [], textTracks = []) {
  Platform.current = null;
  Object.assign(PlayerController, {
    video: { src: "fixture-video", audioTracks, textTracks },
    playbackEngine: "native",
    playRequestToken: Number(PlayerController.playRequestToken || 0) + 1,
    avplayActive: false,
    hlsInstance: null,
    dashInstance: null,
    avplayTrackInfo: []
  });
}

const writes = [];
const audio = [false, true].map((initial, index) => {
  let enabled = initial;
  return {
    get enabled() {
      return enabled;
    },
    set enabled(next) {
      writes.push(`${index}:${next}`);
      enabled = next;
    },
    get selected() {
      return initial;
    },
    set selected(_) {
      throw new Error("The TV exposes selected as a readonly snapshot");
    }
  };
});
useTracks(audio);
assert.equal(await PlayerController.setNativeAudioTrack(0), true);
assert.deepEqual(
  writes,
  ["1:false", "0:true"],
  "Disable the competing decoder before enabling the target once"
);
assert.equal(
  nativeAudioTrackSelectionMatches(audio, 0),
  true,
  "The enabled flag must override a stale selected snapshot"
);
assert.equal(await PlayerController.setNativeAudioTrack(0), true);
assert.deepEqual(
  writes,
  ["1:false", "0:true"],
  "Reselecting the current audio must not restart the decoder"
);

let readonlyWrites = 0;
const readonlyAudio = [true, false].map((enabled) => ({
  get enabled() {
    return enabled;
  },
  set enabled(_) {
    readonlyWrites++;
  }
}));
useTracks(readonlyAudio);
const ui = {
  ...PlayerScreen,
  playerMountToken: 1,
  activePlaybackUrl: "fixture-video",
  externalTrackNodes: [],
  selectedAudioTrackIndex: 0,
  selectedEmbeddedAudioTrackIndex: -1,
  selectedSubtitleTrackIndex: -1,
  selectedEmbeddedSubtitleTrackIndex: -1,
  getAudioEntries: () =>
    readonlyAudio.map((track, audioTrackIndex) => ({ track, audioTrackIndex })),
  isAudioEntryPending: () => false,
  getAudioTrackPreference: () => ({}),
  shouldUseEmbeddedSubtitleTracks: () => false,
  invalidateTrackDialogCaches() {},
  renderControlButtons() {},
  renderAudioDialog() {}
};
assert.equal(await ui.applyAudioTrack(1), false);
assert.equal(
  readonlyWrites,
  2,
  "A failed controller confirmation must not trigger a second round of mode writes"
);
assert.equal(ui.selectedAudioTrackIndex, 0);

const modeWrites = [];
const text = ["showing", "showing", "disabled"].map((initial, index) => {
  let mode = initial;
  return {
    get mode() {
      return mode;
    },
    set mode(next) {
      modeWrites.push(`${index}:${next}`);
      mode = next;
    }
  };
});
assert.equal(await selectVidaaTextTrack(text, 0), true);
assert.deepEqual(
  modeWrites,
  ["1:disabled"],
  "Retire the competitor without hiding an already showing target or rewriting disabled tracks"
);
assert.equal(await selectVidaaTextTrack(text, -1), true);
assert.deepEqual(
  modeWrites,
  ["1:disabled", "0:disabled"],
  "OFF disables the remaining output exactly once"
);
assert.equal(await selectVidaaTextTrack(text, -1), true);
assert.equal(modeWrites.length, 2, "Repeated OFF performs no mode writes");

let delayedMode = "disabled";
const delayedText = {
  get mode() {
    return delayedMode;
  },
  set mode(next) {
    setTimeout(() => {
      delayedMode = next;
    }, 180);
  }
};
const pendingText = selectVidaaTextTrack([delayedText], 0);
await new Promise((resolve) => setTimeout(resolve, 50));
const rapidOff = selectVidaaTextTrack([delayedText], -1);
await new Promise((resolve) => setTimeout(resolve, 250));
assert.equal(await pendingText, false);
assert.equal(await rapidOff, true);
assert.equal(
  delayedMode,
  "disabled",
  "OFF must replace a showing write already queued by the TV firmware"
);

console.log("VIDAA track switch stability fixtures passed");
