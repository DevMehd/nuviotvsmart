import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.window = new EventTarget();

const { PlayerController } = await import("../js/core/player/playerController.js");
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");
let timerId = 0;
const timers = new Map();
globalThis.setTimeout = (callback) => {
  const id = ++timerId;
  timers.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
function flush() {
  assert.ok(timers.size <= 1, "Native track events must share one pending refresh");
  const pending = [...timers.values()];
  timers.clear();
  pending.forEach((callback) => callback());
}
function fixture() {
  const audio = new EventTarget();
  const text = new EventTarget();
  const tracks = [false, true].map((initial, index) => {
    let enabled = initial;
    return {
      // VIDAA firmware can leave this readonly snapshot behind after a switch.
      selected: initial,
      get enabled() {
        return enabled;
      },
      set enabled(value) {
        enabled = value;
        audio.dispatchEvent(new Event("change"));
      },
      id: String(index)
    };
  });
  Object.assign(audio, { length: tracks.length, item: (index) => tracks[index] });
  tracks.forEach((track, index) => {
    audio[index] = track;
  });
  Object.assign(text, { length: 0 });
  const video = Object.assign(new EventTarget(), {
    src: "fixture",
    audioTracks: audio,
    textTracks: text
  });
  PlayerController.video = video;
  PlayerController.playRequestToken = 1;
  Platform.current = null;
  const updates = [];
  let aspectWrites = 0;
  const ui = {
    ...PlayerScreen,
    videoListeners: [],
    externalTrackNodes: [],
    selectedAudioTrackIndex: 1,
    selectedSubtitleTrackIndex: -1,
    playerMountToken: 1,
    trackDiscoveryInProgress: false,
    isActiveMountToken: () => true,
    getVideoAudioTrackList: () => audio,
    getVideoTextTrackList: () => text,
    getAudioTracks: () => tracks,
    getTextTracks: () => [],
    shouldUseEmbeddedSubtitleTracks: () => false,
    invalidateTrackDialogCaches() {},
    applyAspectMode() {
      aspectWrites++;
    },
    refreshTrackDialogs() {
      this.syncTrackState();
      updates.push({
        enabled: tracks.map((track) => track.enabled),
        index: this.selectedAudioTrackIndex
      });
    },
    refreshSubtitleCueStyles: () => false,
    canDiscoverEmbeddedAudioTracks: () => false
  };
  ui.bindVideoEvents();
  return { ui, video, audio, text, tracks, updates, aspectWrites: () => aspectWrites };
}

const first = fixture();
assert.equal(await PlayerController.setNativeAudioTrack(0), true);
first.text.dispatchEvent(new Event("change"));
assert.equal(first.updates.length, 0, "Do not render menus inside decoder setters");
flush();
assert.deepEqual(first.updates, [{ enabled: [true, false], index: 0 }]);
assert.equal(
  first.aspectWrites(),
  0,
  "An audio/subtitle change must keep the video surface intact"
);
first.ui.unbindVideoEvents();
assert.equal(timers.size, 0);

for (const obsolete of ["source", "playRequest", "mount", "unbound"]) {
  const f = fixture();
  f.audio.dispatchEvent(new Event("change"));
  if (obsolete === "source") f.video.src = "new-source";
  if (obsolete === "playRequest") PlayerController.playRequestToken++;
  if (obsolete === "mount") f.ui.playerMountToken++;
  if (obsolete === "unbound") f.ui.unbindVideoEvents();
  flush();
  assert.equal(f.updates.length, 0, `Ignore ${obsolete} track events`);
  f.ui.unbindVideoEvents();
}
console.log(
  "PASS: coherent audio selection, bounded track events, stable video surface, and stale event cleanup"
);
