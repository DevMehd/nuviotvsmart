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

console.log("perso remote tests passed");
