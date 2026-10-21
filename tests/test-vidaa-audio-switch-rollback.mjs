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
const { createNativeAudioSelectionRollback } =
  await import("../js/core/player/playerControllerMethods-02-is-likely-direct-file-url.js");

function fixture() {
  const original = { id: "original", language: "en", enabled: true };
  const target = { id: "italian", language: "it" };
  let targetWrites = 0;
  Object.defineProperty(target, "enabled", {
    configurable: true,
    get: () => false,
    set() {
      targetWrites++;
    }
  });
  const video = { src: "fixture", audioTracks: [original, target] };
  Object.assign(PlayerController, {
    video,
    playbackEngine: "native-file",
    playRequestToken: 1,
    hlsInstance: null,
    dashInstance: null,
    nativeAudioTrackSelectionToken: 0,
    pendingNativeAudioTrackSelection: null
  });
  return { video, original, target, targetWrites: () => targetWrites };
}

{
  const { original, target, targetWrites } = fixture();
  const selection = PlayerController.setNativeAudioTrack(1);
  assert.equal(original.enabled, false, "fixture reproduces accepted old-track disable");
  assert.equal(await selection, false, "rejected target remains a failed selection");
  assert.equal(original.enabled, true, "failed switch restores previously active output");
  assert.equal(target.enabled, false);
  assert.equal(targetWrites(), 1, "rollback does not retry the rejected target enable");
}

for (const invalidate of [
  () => {
    PlayerController.playRequestToken++;
  },
  () => {
    PlayerController.video.src = "replacement";
  },
  () => {
    PlayerController.playbackEngine = "hls.js";
  },
  () => {
    PlayerController.hlsInstance = {};
  },
  () => {
    PlayerController.dashInstance = {};
  },
  () => {
    PlayerController.nativeAudioTrackSelectionToken++;
  }
]) {
  const { original } = fixture();
  const selection = PlayerController.setNativeAudioTrack(1);
  invalidate();
  assert.equal(await selection, false);
  assert.equal(original.enabled, false, "superseded request cannot restore old native flags");
}

{
  const { video, original } = fixture();
  const selection = PlayerController.setNativeAudioTrack(1);
  const replacement = [
    { id: "new", enabled: true },
    { id: "new-italian", enabled: false }
  ];
  video.audioTracks = replacement;
  assert.equal(await selection, false);
  assert.equal(original.enabled, false, "retired objects are not restored");
  assert.deepEqual(
    replacement.map((track) => track.enabled),
    [true, false]
  );
}

{
  const { video, original, target } = fixture();
  let targetEnabled = false;
  Object.defineProperty(target, "enabled", {
    get: () => targetEnabled,
    set(value) {
      queueMicrotask(() => {
        targetEnabled = value;
        video.audioTracks = [target, original];
      });
    }
  });
  assert.equal(
    await PlayerController.setNativeAudioTrack(1),
    true,
    "confirmation follows reordered native object"
  );
  assert.equal(target.enabled, true);
  assert.equal(original.enabled, false, "successful switch is never rolled back");
}

{
  const old = { enabled: true, selected: true };
  const next = { enabled: false, selected: false };
  let current = true;
  const rollback = createNativeAudioSelectionRollback([old, next], {
    preferEnabled: true,
    isCurrent: () => current
  });
  old.enabled = false;
  old.selected = false;
  assert.equal(rollback([next, old]), true, "same objects may reorder before rollback");
  assert.equal(old.enabled, true);
  assert.equal(
    old.selected,
    false,
    "VIDAA enabled flag does not overwrite its independent selected snapshot"
  );
  current = false;
  old.enabled = false;
  assert.equal(rollback([old, next]), false);
  assert.equal(old.enabled, false);
}

{
  const { video, original, target } = fixture();
  const selectNative = PlayerController.setNativeAudioTrack;
  PlayerController.setNativeAudioTrack = () => false;
  const ui = {
    ...PlayerScreen,
    playerMountToken: 1,
    sourcePlaybackAttemptToken: 1,
    activePlaybackUrl: "fixture",
    externalTrackNodes: [],
    embeddedAudioTracks: [],
    embeddedSubtitleTracks: [],
    manifestAudioTracks: [],
    manifestSubtitleTracks: [],
    selectedAudioTrackIndex: 0,
    selectedEmbeddedAudioTrackIndex: -1,
    selectedSubtitleTrackIndex: -1,
    selectedEmbeddedSubtitleTrackIndex: -1,
    shouldUseEmbeddedSubtitleTracks: () => false,
    renderControlButtons() {},
    renderAudioDialog() {}
  };
  ui.invalidateTrackDialogCaches();
  try {
    assert.equal(await ui.applyAudioTrack(1), false, "direct UI fallback preserves failure result");
    assert.equal(original.enabled, true, "direct UI fallback also restores previous output");
    assert.equal(target.enabled, false);
    assert.equal(video.audioTracks[0], original);
  } finally {
    PlayerController.setNativeAudioTrack = selectNative;
  }
}

for (const obsolete of [false, true]) {
  fixture();
  let requests = 0;
  let complete;
  const ui = {
    ...PlayerScreen,
    audioSelectionToken: 0,
    sourcePlaybackAttemptToken: 1,
    playerMountToken: 1,
    getAudioEntries: () => [
      { id: "unsupported", selected: true, supported: false },
      { id: "supported", selected: false, supported: true }
    ],
    applyAudioTrack() {
      requests++;
      this.audioSelectionToken++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    }
  };
  assert.equal(ui.ensureSupportedAudioTrackSelected(), true);
  if (obsolete) ui.sourcePlaybackAttemptToken++;
  complete(false);
  for (let index = 0; index < 10; index++) await Promise.resolve();
  assert.equal(ui.audioFallbackApplying, false);
  if (obsolete) {
    assert.notEqual(
      ui.failedAutomaticAudioFallbackEntryId,
      "supported",
      "retired fallback cannot suppress a new source"
    );
  } else {
    assert.equal(ui.failedAutomaticAudioFallbackEntryId, "supported");
    assert.equal(
      ui.ensureSupportedAudioTrackSelected(),
      false,
      "failed automatic selection is not repeated on refresh"
    );
    assert.equal(requests, 1);
  }
}

console.log(
  "PASS: rejected VIDAA audio switches restore the previous output; successful, reordered, replacement and superseded selections remain isolated (fixtures, no TV)."
);
