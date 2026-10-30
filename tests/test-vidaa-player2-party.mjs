// Lot P, P7: Watch Party on the new VIDAA player. The old player's party mixin runs on the new
// screen's own playback contract (fake session and <video>, stubbed PartyRepository): derived
// fields, no speed nudge, guest lock on pause / seek / skip / next episode, host publishing,
// Party start position over the route's and the media server's, shared headers, Back order and
// one leave before the decoder is freed.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = {
  getElementById: () => null,
  documentElement: { classList: { contains: () => false } },
  visibilityState: "visible"
};

const { NewPlayerScreen: screen } = await import("../js/ui/tv2/player/newPlayerScreen.js");
const { Router } = await import("../js/ui/navigation/routerState.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { PartyRepository } = await import("../js/core/party/partyRepository.js");
const { PartyMemberStatus } = await import("../js/core/party/partyModels.js");

const KEY = "movie|tt1||";
const URL_A = "https://media.invalid/film.mp4";
let repoState = { party: null };
let repoPlayback = null;
let serverNow = 1_000_000;
const published = [];
const statuses = [];
const messages = [];
Object.assign(PartyRepository, {
  getState: () => repoState,
  getPlayback: () => repoPlayback,
  nowMs: () => serverNow,
  isAvailable: () => true,
  publishPlayback: (paused, positionMs, rate) => published.push({ paused, positionMs, rate }),
  setLocalStatus: (status, mediaKey) => statuses.push({ status, mediaKey }),
  publishMedia: async () => {},
  shareStream: () => {},
  subscribeState: () => () => {},
  subscribePlayback: () => () => {},
  subscribeAvailable: () => () => {},
  subscribeNotices: () => () => {},
  subscribeEvents: () => () => {}
});
const engine = { pauses: 0, resumes: 0, rates: [] };
Object.assign(PlayerController, {
  pause: () => {
    engine.pauses += 1;
    video.paused = true;
    session.state = "paused";
  },
  resume: () => {
    engine.resumes += 1;
    video.paused = false;
    session.state = "playing";
  },
  setPlaybackRate: async (rate) => (engine.rates.push(rate), true),
  getSupportedPlaybackRates: () => [0.5, 1, 1.5, 2],
  currentPlaybackHeaders: { Stale: "old player" }
});

const video = { paused: false, playbackRate: 1, currentTime: 60, ended: false };
PlayerController.video = video;
const session = {
  state: "playing",
  firstFrame: true,
  url: URL_A,
  currentSeconds: () => video.currentTime,
  durationSeconds: () => 7200,
  pause() {
    video.paused = true;
    this.state = "paused";
  },
  resume() {
    video.paused = false;
    this.state = "playing";
  },
  teardown() {}
};

function party({ memberId = "m2", host = "m1", presence = {}, hostOnly = true } = {}) {
  return {
    id: "p1",
    memberId,
    hostMemberId: host,
    members: [
      { id: "m1", display_name: "Host" },
      { id: "m2", display_name: "Guest" }
    ],
    presence,
    media: { type: "movie", meta_id: "tt1", meta_type: "movie" },
    mediaKey: KEY,
    connected: true,
    hostOnly,
    sharing: false
  };
}

function reset({ guest = true, playback = null } = {}) {
  repoState = { party: party(guest ? {} : { memberId: "m1" }) };
  repoPlayback = playback;
  published.length = 0;
  messages.length = 0;
  Object.assign(video, { paused: false, playbackRate: 1, currentTime: 60, ended: false });
  session.state = "playing";
  Object.assign(screen, {
    params: { itemId: "tt1", itemType: "movie", playerTitle: "Film" },
    session,
    video,
    candidate: { url: URL_A, name: "Source" },
    partyBehind: false,
    partyBehindMs: null,
    partyPanelVisible: false,
    partyRefs: null,
    trackPanel: "",
    playerBackNavigationInProgress: false,
    showPartyMessage: (text) => messages.push(text)
  });
}

// 1. The fields the mixin reads come from the session; paused is never overwritten by it.
reset();
assert.equal(screen.hasPresentedPlaybackFrame, true);
assert.equal(screen.loadingVisible, false);
assert.equal(screen.activePlaybackUrl, URL_A);
assert.equal(screen.partyPositionMs(), 60000);
assert.equal(screen.partyDurationMs(), 7200000);
assert.doesNotThrow(() => (screen.paused = true), "the mixin writes paused");
assert.equal(screen.paused, false, "the session state stays the truth");
session.state = "buffering";
assert.equal(screen.partyIsLoading(), true);
session.state = "playing";
// Drift is corrected by a seek: never a speed nudge, even with an engine that has rates.
assert.equal(screen.partyNudgeSupported(), false);
screen.applyPartyNudge(1.05);
assert.ok(screen.partyRateNudge == null);
assert.deepEqual(engine.rates, []);
video.playbackRate = 1.5;
assert.equal(screen.getPlaybackSpeed(), 1.5, "the host's speed is read from the video");
video.playbackRate = 1;

// 2. Guest of a host-only party: OK pauses only for itself (behind), never publishes; a seek ahead is refused.
reset({ playback: { paused: false, position_ms: 60000, rate: 1, at: serverNow, seq: 1 } });
assert.equal(screen.isPartyControlLocked(), true);
screen.togglePause();
assert.equal(engine.pauses, 1);
assert.equal(screen.partyBehind, true);
assert.equal(published.length, 0);
screen.togglePause();
assert.equal(engine.resumes, 1, "resumes from behind");
reset({ playback: { paused: false, position_ms: 60000, rate: 1, at: serverNow, seq: 1 } });
const seeks = [];
const seek = screen.seekPlaybackSeconds;
screen.seekPlaybackSeconds = (seconds) => (seeks.push(seconds), true);
assert.equal(screen.userSeek(600), false, "a guest cannot jump ahead of the party");
assert.deepEqual(seeks, []);
assert.equal(messages.length, 1, "it says why");
assert.equal(screen.userSeek(30), true, "falling behind is allowed");
assert.deepEqual(seeks, [30]);
assert.equal(screen.partyBehind, true);

// 3. Host: pause and seek are published with the position.
reset({ guest: false, playback: { paused: false, position_ms: 60000, rate: 1, at: serverNow } });
assert.equal(screen.isPartyControlLocked(), false);
screen.setControlsVisible = () => {};
screen.togglePause();
assert.equal(video.paused, true);
assert.deepEqual(published.at(-1), { paused: true, positionMs: 60000, rate: 1 });
seeks.length = 0;
assert.equal(screen.userSeek(90), true);
assert.deepEqual(seeks, [90]);
assert.equal(published.at(-1).positionMs, 90000);
screen.seekPlaybackSeconds = seek;
delete screen.setControlsVisible;

// 4. Sync tick: a guest 3 s off a playing party seeks to it (no rate), reports Ready.
reset({ playback: { paused: false, position_ms: 63000, rate: 1, at: serverNow, seq: 2 } });
screen.seekPlaybackSeconds = (seconds) => (seeks.push(seconds), true);
seeks.length = 0;
screen.startPartySync();
screen.partySyncTick(screen.partySync);
assert.equal(seeks.length, 1);
assert.ok(Math.abs(seeks[0] - 63) < 0.01, `seek to the party position (${seeks[0]})`);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Ready);
assert.deepEqual(engine.rates, []);
screen.stopPartySync();
assert.equal(screen.partySyncTimer, null);
screen.seekPlaybackSeconds = seek;

// 5. Start position: where the party is now wins over the route's and the media server's;
// a user source switch keeps its own position.
{
  reset({ playback: { paused: true, position_ms: 1_200_000, rate: 1, at: serverNow } });
  const attaches = [];
  Router.current = "player";
  Object.assign(screen, {
    playerMountToken: 7,
    tracks: { reset() {} },
    session: { ...session, played: false, attach: (url, options) => attaches.push(options) },
    pendingPlaybackRestore: { timeSeconds: 30 }
  });
  await screen.startCandidate(7, { url: URL_A, name: "Source" });
  assert.equal(attaches.at(-1).startAt, 1200, "the party position");
  repoState = { party: null };
  await screen.startCandidate(7, { url: URL_A, name: "Source" });
  assert.equal(attaches.at(-1).startAt, 30, "no party: the route's position");
}

// 6. Shared stream headers are this player's own, never the idle controller's stale ones.
reset({ guest: false });
screen.playbackHeaders = { Referer: "r" };
assert.deepEqual(screen.currentPartyStream().headers, { Referer: "r" });
screen.playbackHeaders = {};
assert.deepEqual(screen.currentPartyStream().headers, {});

// 7. Back closes the party panel first; it counts as an overlay for a history Back.
reset();
screen.partyPanelVisible = true;
assert.equal(screen.hasBackDismissableOverlay(), true);
assert.equal(screen.consumeBackRequest(), true);
assert.equal(screen.partyPanelVisible, false);

// 8. Leaving: one pause published at the position before the decoder is freed, then unbound;
// the second finishPlayback (cleanup after Back) publishes nothing at position 0.
reset({ guest: false, playback: { paused: false, position_ms: 60000, rate: 1, at: serverNow } });
screen.progress = null;
screen.partyUnsubscribers = [() => {}];
screen.finishPlayback();
assert.deepEqual(published, [{ paused: true, positionMs: 60000, rate: 1 }]);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Browsing);
assert.deepEqual(screen.partyUnsubscribers, []);
video.currentTime = 0;
screen.finishPlayback();
assert.equal(published.length, 1);

// 9. The new screen and the old one share the mixin: its primitives exist on the host.
for (const name of [
  "bindParty",
  "unbindParty",
  "leavePartyPlayback",
  "togglePartyPanel",
  "handlePartyPanelKey",
  "renderPartyPill",
  "isPartyButtonAvailable",
  "closeSourcesPanel",
  "closeAudioDialog",
  "currentPlaybackHeaders"
])
  assert.equal(typeof screen[name], "function", name);

console.log("PASS: VIDAA player2 Watch Party (P7)");
process.exit(0);
