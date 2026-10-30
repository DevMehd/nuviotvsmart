// Phone remote receiver: wire format v1 shared with the Android app (TvRemote.kt).
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.document = { documentElement: {} };

const { PersoSpace } = await import("../js/core/perso/persoSpace.js");
assert.equal(PersoSpace.remoteTopic("abcd"), "nuvio-remote-v1-939fe08ba58d4f5d", "same hash as the hand-off topic");

const { parseRemoteEvent, planRemoteCommand, buildRemoteState, stateSignature, simulateRemoteKey } =
  await import("../js/core/perso/tvRemoteReceiver.js");
const now = 1_800_000_000_000;
const wrap = (message) => JSON.stringify({ event: "message", message: JSON.stringify(message) });
const cmd = { v: 1, type: "cmd", from: "phone1", name: "Pixel", device: "android", at: now - 500, cmd: "seek", value: -10000 };

assert.equal(parseRemoteEvent(wrap(cmd), "tv1", now).cmd, "seek");
assert.equal(parseRemoteEvent(wrap(cmd), "phone1", now), null, "own messages are ignored");
assert.equal(parseRemoteEvent(wrap({ ...cmd, type: "state" }), "tv1", now), null, "states from other TVs are ignored");
assert.equal(parseRemoteEvent(wrap({ ...cmd, v: 2 }), "tv1", now), null);
const { v: _omitted, ...legacyCmd } = cmd;
assert.equal(parseRemoteEvent(wrap(legacyCmd), "tv1", now).cmd, "seek", "Nuvio Perso 1.5.0 omitted v");
assert.equal(parseRemoteEvent(wrap(cmd), "tv1", now + 120_000), null, "stale commands are dropped");
assert.equal(parseRemoteEvent(JSON.stringify({ event: "keepalive" }), "tv1", now), null);
assert.equal(parseRemoteEvent("not json", "tv1", now), null);

assert.deepEqual(planRemoteCommand("seek", -10000, true), { action: "seekBy", seconds: -10 });
assert.deepEqual(planRemoteCommand("seekTo", 90_000, true), { action: "seekTo", seconds: 90 });
assert.equal(planRemoteCommand("toggle", null, false), null, "playback commands need an open player");
assert.deepEqual(planRemoteCommand("toggle", null, true), { action: "toggle" });
assert.deepEqual(planRemoteCommand("key", 0, false), { action: "key", key: "ArrowUp", keyCode: 38 });
assert.deepEqual(planRemoteCommand("key", 4, false), { action: "key", key: "Enter", keyCode: 13 });
assert.deepEqual(planRemoteCommand("key", 6, false), { action: "home" });
assert.equal(planRemoteCommand("key", 42, false), null);
assert.deepEqual(planRemoteCommand("ping", null, false), { action: "state" });
assert.equal(planRemoteCommand("prev", null, true), null, "previous episode is not supported");
assert.equal(planRemoteCommand("volUp", null, false).delta, 0.1);

const config = { deviceId: "tv1", deviceName: "Salon" };
const idle = buildRemoteState({ playing: false, volume: NaN, muted: false }, config, now);
assert.deepEqual(idle, { v: 1, type: "state", from: "tv1", name: "Salon", device: "vidaa", at: now, playing: false, muted: false });
const playing = buildRemoteState({
  playing: true, paused: false, positionSeconds: 61.2, durationSeconds: 2400, title: "Show", subtitle: "S1 E2", poster: "https://p", volume: 0.5, muted: false
}, config, now);
assert.equal(playing.positionMs, 61_200);
assert.equal(playing.durationMs, 2_400_000);
assert.equal(playing.volume, 50);
assert.equal(playing.title, "Show");

assert.equal(stateSignature(playing, 61_000), stateSignature({ ...playing, positionMs: 62_000 }, 61_500), "normal progress is not a change");
assert.notEqual(stateSignature(playing), stateSignature({ ...playing, paused: true }));
assert.notEqual(stateSignature(playing, 10_000), stateSignature(playing), "a jump is a change");

// Simulated keys carry the keyCode the focus engine reads.
const received = [];
const target = { dispatchEvent: (event) => received.push([event.type, event.key, event.keyCode]) };
globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; this.key = init.key; } };
simulateRemoteKey("ArrowDown", 40, target);
assert.deepEqual(received, [["keydown", "ArrowDown", 40], ["keyup", "ArrowDown", 40]]);

// The new VIDAA player screen (lot P, P3) answers the same adapter: snapshot, play/pause,
// seek, volume and mute on #videoPlayer.
{
  globalThis.__NUVIO_PLATFORM__ = "vidaa";
  globalThis.location = { search: "" };
  globalThis.document.getElementById = () => null;
  globalThis.document.documentElement.classList = { contains: () => false };
  const { Router } = await import("../js/ui/navigation/routerState.js");
  const { NewPlayerScreen } = await import("../js/ui/tv2/player/newPlayerScreen.js");
  const { snapshot, applyPlan } = await import("../js/core/perso/tvRemoteReceiver.js");
  const video = {
    paused: false,
    currentTime: 61.2,
    duration: 2400,
    volume: 0.5,
    muted: false,
    play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    }
  };
  let state = "playing";
  NewPlayerScreen.video = video;
  NewPlayerScreen.container = { querySelector: (selector) => (selector === "#videoPlayer" ? video : null) };
  NewPlayerScreen.params = { playerTitle: "Show", season: 1, episode: 2, playerEpisodeTitle: "Pilot" };
  NewPlayerScreen.session = {
    firstFrame: true,
    get state() {
      return state;
    },
    currentSeconds: () => video.currentTime,
    durationSeconds: () => video.duration,
    pause: () => (video.pause(), (state = "paused")),
    resume: () => (video.play(), (state = "playing"))
  };
  Router.current = "player";
  Router.getCurrentScreen = () => NewPlayerScreen;
  const shot = snapshot();
  assert.deepEqual(
    [shot.playing, shot.paused, shot.positionSeconds, shot.durationSeconds, shot.title, shot.subtitle],
    [true, false, 61.2, 2400, "Show", "S1 E2 · Pilot"]
  );
  applyPlan({ action: "toggle" });
  assert.equal(video.paused, true, "toggle pauses");
  assert.equal(snapshot().paused, true);
  assert.equal(NewPlayerScreen.osdHideTimer, null, "a paused OSD never hides by itself");
  applyPlan({ action: "pause" });
  assert.equal(video.paused, true, "pause keeps paused");
  applyPlan({ action: "play" });
  assert.equal(video.paused, false, "play resumes");
  applyPlan({ action: "seekBy", seconds: -10 });
  assert.equal(video.currentTime, 51.2);
  applyPlan({ action: "seekTo", seconds: 9000 });
  assert.equal(video.currentTime, 2400, "clamped to the duration");
  applyPlan({ action: "volume", delta: -0.1 });
  assert.equal(video.volume, 0.4);
  applyPlan({ action: "mute" });
  assert.equal(video.muted, true);
  NewPlayerScreen.stopOsdTimers();
  NewPlayerScreen.session = null;
  Router.current = null;
}

console.log("perso remote tests passed");
