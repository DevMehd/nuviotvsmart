// Lot P, P1: core of the new VIDAA player (js/ui/tv2/player/videoSession.js) against a fake
// <video> and fake timers. Desktop logic only; no TV timing is measured here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVideoSession } from "../js/ui/tv2/player/videoSession.js";

function createClock() {
  let now = 0;
  let next = 0;
  const timers = new Map();
  const add = (callback, delay, every) => {
    const id = ++next;
    timers.set(id, { callback, at: now + delay, every });
    return id;
  };
  const root = {
    performance: { now: () => now },
    setTimeout: (callback, delay = 0) => add(callback, delay, 0),
    setInterval: (callback, delay) => add(callback, delay, delay),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    AbortController,
    document: { querySelectorAll: () => [] }
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = Math.max(now, timer.at);
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      timer.callback();
    }
    now = end;
  };
  return {
    root,
    advance,
    timers,
    get now() {
      return now;
    }
  };
}

class FakeVideo {
  constructor() {
    this.listeners = new Map();
    this.attrs = new Map([["autoplay", ""]]);
    this.calls = [];
    this.readyState = 0;
    this.networkState = 0;
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.muted = false;
    this.error = null;
    this.currentSrc = "";
    this.bufferedEnd = 0;
    this.playResults = [];
    this.throwOnPause = false;
  }
  get buffered() {
    const end = this.bufferedEnd;
    return { length: end ? 1 : 0, end: () => end };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
  emit(type) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this });
  }
  set src(value) {
    this.calls.push(`src=${value}`);
    this.attrs.set("src", value);
    this.currentSrc = value;
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  removeAttribute(name) {
    this.calls.push(`removeAttribute:${name}`);
    this.attrs.delete(name);
    if (name === "src") this.currentSrc = "";
  }
  appendChild() {
    throw new Error("a <source> child is never used");
  }
  pause() {
    this.calls.push("pause");
    if (this.throwOnPause) throw new Error("decoder busy");
    this.paused = true;
  }
  load() {
    this.calls.push("load");
    this.error = null;
  }
  play() {
    this.calls.push(this.muted ? "play:muted" : "play");
    this.paused = false;
    return this.playResults.shift() || Promise.resolve();
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const URL_A = "http://media.invalid/a.mkv";

function setup(options = {}) {
  const clock = createClock();
  const video = new FakeVideo();
  const states = [];
  const session = createVideoSession(video, {
    root: clock.root,
    onChange: (s) => states.push(s.state),
    prepare: (url) => video.calls.push(`prepare:${url === URL_A ? "A" : "other"}`),
    stallMs: 25000,
    capMs: 90000,
    ...options
  });
  return { clock, video, session, states };
}

// 1. First attach: decoder freed then a direct src in the same task, explicit play, no <source>.
{
  const { video, session } = setup();
  session.attach(URL_A);
  assert.deepEqual(video.calls, [
    "pause",
    "removeAttribute:src",
    "load",
    "prepare:A",
    `src=${URL_A}`,
    "play"
  ]);
  assert.equal(session.state, "loading");
}

// 2. Progress keeps the start alive; N s without progress fails; a late playing clears it.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  for (let i = 0; i < 6; i += 1) {
    clock.advance(5000);
    video.bufferedEnd += 1; // download grows, nothing else
  }
  assert.equal(session.state, "loading", "30 s of slow download is not a failure");
  clock.advance(23000);
  assert.equal(session.state, "loading", "under N s without progress");
  clock.advance(3000);
  assert.equal(session.state, "error", "N s without progress");
  assert.equal(session.error.kind, "stalled");
  assert.equal(clock.timers.size, 0, "no guard left once in error");
  video.emit("playing");
  assert.equal(session.state, "loading", "late playing clears the error");
  assert.equal(session.error, null);
  assert.equal(clock.timers.size, 1, "the guard runs again until the first image");
  video.currentTime = 0.2;
  video.emit("timeupdate");
  assert.equal(session.state, "playing");
  assert.equal(session.firstFrame, true);
  assert.equal(clock.timers.size, 1, "only the freeze sentinel while playing");
  video.emit("pause");
  assert.equal(clock.timers.size, 0, "zero timers while paused");
}

// 2b. A playing that never shows an image after a late recovery still ends in an error.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  clock.advance(26000);
  assert.equal(session.error.kind, "stalled");
  video.emit("playing");
  clock.advance(26000);
  assert.equal(session.state, "error", "no endless loading after a late playing");
}

// 2c. An end before any image is an explicit error, not an endless loading screen.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  video.emit("ended");
  assert.equal(session.state, "error");
  assert.equal(session.error.kind, "source");
  assert.equal(clock.timers.size, 0);
}

// 3. Absolute ceiling before the first image, even with progress.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  for (let i = 0; i < 20; i += 1) {
    clock.advance(5000);
    video.bufferedEnd += 1;
  }
  assert.equal(session.state, "error");
  assert.equal(session.error.kind, "timeout");
}

// 4. Network error before the first image: one retry of the same link after 1 s, then an error.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  video.error = { code: 2, message: "net" };
  video.emit("error");
  assert.equal(session.state, "loading", "first network error retries");
  clock.advance(999);
  assert.equal(video.calls.filter((c) => c.startsWith("src=")).length, 1);
  clock.advance(1);
  clock.advance(0);
  assert.equal(video.calls.filter((c) => c === `src=${URL_A}`).length, 2, "same link again");
  video.error = { code: 2, message: "net" };
  video.emit("error");
  assert.equal(session.state, "error");
  assert.equal(session.error.kind, "network");
  assert.equal(video.calls.filter((c) => c.startsWith("src=")).length, 2, "no third attempt");
}

// 5. A cut after the first image resumes the same link at the same position, once.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  video.emit("playing");
  video.currentTime = 40;
  video.emit("timeupdate");
  assert.equal(session.state, "playing");
  video.error = { code: 2, message: "cut" };
  video.emit("error");
  clock.advance(0);
  assert.equal(video.calls.filter((c) => c === `src=${URL_A}`).length, 2);
  video.currentTime = 0;
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 40, "resumed at the same position");
}

// 6. Decoder error: no retry, explicit message kind.
{
  const { video, session } = setup();
  session.attach(URL_A);
  video.error = { code: 3, message: "PIPELINE_ERROR_DECODE" };
  video.emit("error");
  assert.equal(session.state, "error");
  assert.equal(session.error.kind, "decode");
  assert.equal(video.calls.filter((c) => c.startsWith("src=")).length, 1);
}

// 7. Source error: the HTTP status is read on this failure path only.
{
  const probed = [];
  const { video, session } = setup({
    probeStatus: async (url) => {
      probed.push(url);
      return 403;
    }
  });
  session.attach(URL_A);
  assert.equal(probed.length, 0, "no network probe before a failure");
  video.error = { code: 4, message: "MEDIA_ELEMENT_ERROR: Format error" };
  video.emit("error");
  await tick();
  assert.equal(session.state, "error");
  assert.equal(session.error.httpStatus, 403);
  assert.deepEqual(probed, [URL_A]);
}

// 8. Aborted errors are ignored; refused autoplay with sound falls back to muted, once.
{
  const { video, session } = setup();
  const refused = Object.assign(new Error("gesture"), { name: "NotAllowedError" });
  video.playResults.push(Promise.reject(refused));
  session.attach(URL_A);
  await tick();
  assert.equal(video.muted, true);
  assert.equal(session.mutedFallback, true);
  assert.deepEqual(video.calls.slice(-2), ["play", "play:muted"]);
  video.error = { code: 1 };
  video.emit("error");
  assert.equal(session.state, "loading");
  session.restoreSound();
  assert.equal(video.muted, false);
}

// 9. A second source waits one task after the teardown; Retry keeps the link and the position.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  video.emit("playing");
  video.currentTime = 12;
  video.emit("timeupdate");
  video.calls.length = 0;
  session.retry();
  assert.deepEqual(
    video.calls,
    ["pause", "removeAttribute:src", "load"],
    "no src in the teardown task"
  );
  clock.advance(0);
  assert.deepEqual(video.calls.slice(-2), [`src=${URL_A}`, "play"]);
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 12);
}

// 10. Destroy: synchronous teardown in order, never throws, no listener or timer survives.
{
  const { clock, video, session } = setup();
  session.attach(URL_A);
  assert.ok(clock.timers.size > 0);
  video.throwOnPause = true;
  video.calls.length = 0;
  assert.doesNotThrow(() => session.destroy());
  assert.deepEqual(video.calls, ["pause", "removeAttribute:src", "load"]);
  assert.equal(clock.timers.size, 0);
  assert.equal(video.listenerCount(), 0);
  assert.equal(session.state, "idle");
}

// 10b. Resume (P2): one seek at loadedmetadata, a second only if the first landed short.
{
  const { video, session } = setup();
  session.attach(URL_A, { startAt: 3600 });
  assert.equal(session.played, false);
  video.duration = 7200;
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 3600, "seek at loadedmetadata");
  video.emit("playing");
  video.currentTime = 3600.2;
  video.emit("timeupdate");
  assert.equal(session.firstFrame && session.played, true);
  video.currentTime = 3601;
  video.emit("playing");
  assert.equal(video.currentTime, 3601, "a landed seek is not repeated");
}
{
  const { video, session } = setup();
  session.attach(URL_A, { startAt: 600 });
  video.duration = 7200;
  video.emit("loadedmetadata");
  video.currentTime = 0; // a large MKV ignored the early seek
  video.emit("playing");
  assert.equal(video.currentTime, 600, "one second seek after a short landing");
  video.currentTime = 0;
  video.emit("playing");
  assert.equal(video.currentTime, 0, "never a third seek");
}
{
  // Percent resume uses the real duration and never lands in the last 3 s.
  const { video, session } = setup();
  session.attach(URL_A, { startAt: 0, startPercent: 50 });
  video.duration = 1000;
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 500);
  const late = setup();
  late.session.attach(URL_A, { startAt: 9999 });
  late.video.duration = 100;
  late.video.emit("loadedmetadata");
  assert.equal(late.video.currentTime, 97);
}

// 10c. Freeze sentinel (P3, C4): same link, same position; a frame counter that never moves
// proves nothing; a seek or a pause is not a freeze; repeated freezes end in an error.
{
  const notes = [];
  const { clock, video, session } = setup({ note: (name) => notes.push(name) });
  session.attach(URL_A);
  video.emit("loadedmetadata");
  video.emit("playing");
  video.currentTime = 30.2;
  video.emit("timeupdate");
  assert.equal(session.state, "playing");
  video.readyState = 4;
  let frames = 0;
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  // Hardware plane: time advances, the frame counter stays at 0 for minutes.
  for (let i = 0; i < 60; i += 1) {
    clock.advance(2000);
    video.currentTime += 2;
    video.emit("timeupdate");
  }
  assert.equal(session.attaches, 1, "a counter that never moves is not a freeze");
  // A long seek stands still without a waiting event.
  video.seeking = true;
  clock.advance(20000);
  video.seeking = false;
  assert.equal(session.attaches, 1, "a seek is not a freeze");
  video.paused = true;
  clock.advance(20000);
  video.paused = false;
  assert.equal(session.attaches, 1, "a pause the session did not see is not a freeze");
  // The time stands still with data: reload of the same link at the same position.
  clock.advance(10000);
  assert.equal(session.attaches, 2, "frozen time: one reload");
  assert.equal(session.url, URL_A, "same link");
  assert.deepEqual(notes, ["freezeTime", "freezeReload"]);
  clock.advance(0);
  video.emit("loadedmetadata");
  assert.ok(Math.abs(video.currentTime - session.currentSeconds()) < 0.01);
  assert.ok(video.currentTime > 140, `same position (${video.currentTime})`);
  // Frames seen moving, then stuck while the time still advances.
  video.emit("playing");
  video.currentTime += 0.5;
  video.emit("timeupdate");
  assert.equal(session.state, "playing");
  for (let i = 0; i < 3; i += 1) {
    clock.advance(2000);
    frames += 50;
    video.currentTime += 2;
  }
  for (let i = 0; i < 5; i += 1) {
    clock.advance(2000);
    video.currentTime += 2;
  }
  assert.equal(session.attaches, 3, "stuck frames: a second reload");
  assert.equal(notes.at(-2), "freezeFrames");
  clock.advance(0);
  video.emit("playing");
  video.currentTime += 0.5;
  video.emit("timeupdate");
  frames += 1;
  clock.advance(12000);
  assert.equal(session.state, "error", "a third freeze is an explicit error, never a loop");
  assert.equal(session.error.kind, "stalled");
  assert.equal(clock.timers.size, 0);
  // Retry starts a fresh budget on the same link.
  session.retry();
  assert.equal(session.url, URL_A);
}

// 10e. Review P3: a frame counter that stops while the time advances never turns a playing
// video into an error; still time without data waits the start guard's patience, not 8 s.
{
  const notes = [];
  const { clock, video, session } = setup({ note: (name) => notes.push(name) });
  const replay = () => {
    clock.advance(0);
    video.emit("playing");
    video.currentTime += 0.5;
    video.emit("timeupdate");
    assert.equal(session.state, "playing");
  };
  session.attach(URL_A);
  replay();
  video.readyState = 4;
  let frames = 0;
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 3; i += 1) {
      clock.advance(2000);
      frames += 50;
      video.currentTime += 2;
    }
    for (let i = 0; i < 5; i += 1) {
      clock.advance(2000);
      video.currentTime += 2;
    }
    if (round < 2) replay();
  }
  assert.equal(session.attaches, 3, "two reloads for stuck frames");
  assert.equal(notes.filter((name) => name === "freezeFrames").length, 3);
  assert.equal(session.state, "playing", "the third frames-only stall is noted, never an error");
  for (let i = 0; i < 30; i += 1) {
    clock.advance(2000);
    video.currentTime += 2;
  }
  assert.equal(session.state, "playing");
  assert.equal(session.attaches, 3, "a counter that stays still is no longer acted on");

  const refill = setup();
  refill.session.attach(URL_A);
  refill.clock.advance(0);
  refill.video.emit("playing");
  refill.video.currentTime = 0.5;
  refill.video.emit("timeupdate");
  refill.video.readyState = 2; // no data, and the firmware sent no waiting
  refill.clock.advance(20000);
  assert.equal(refill.session.attaches, 1, "a silent refill is not an 8 s freeze");
  refill.clock.advance(8000);
  assert.equal(refill.session.attaches, 2, "still without data past the stall limit: one reload");
}

// 10d. Resume after a user pause plays again, never before the first image.
{
  const { video, session } = setup();
  session.attach(URL_A);
  video.calls.length = 0;
  session.resume();
  assert.deepEqual(video.calls, [], "no play() before the first image");
  video.emit("playing");
  video.currentTime = 0.3;
  video.emit("timeupdate");
  session.pause();
  video.emit("pause");
  assert.equal(session.state, "paused");
  session.resume();
  assert.equal(video.calls.at(-1), "play");
}

// 11. The new player never switches source by itself and never uses the forbidden paths.
for (const file of [
  "js/ui/tv2/player/videoSession.js",
  "js/ui/tv2/player/newPlayerScreen.js",
  "js/ui/tv2/player/resolvePlayableCandidate.js",
  "js/ui/tv2/player/playerProgress.js",
  "js/ui/tv2/player/playerOsd.js",
  "js/ui/tv2/player/playerTracks.js"
]) {
  // Code only: the comments name the old paths they replace.
  const source = (await readFile(new URL(`../${file}`, import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "tryNextStreamCandidate",
    "PlayerController.play(",
    'createElement("source")',
    "createMediaElementSource",
    "AudioContext",
    "playerScreenMethods-",
    "playerScreenContext",
    "canPlayType",
    // A spread of a native track loses its getters (language, label): audit point 5.
    "...track"
  ])
    assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
}

// 12. P4: a media error right after an audio track change reloads the same link at the same
// position once (back to the last kept track), instead of the error screen; later it fails.
{
  const switchErrors = [];
  const { clock, video, session } = setup({ onTrackSwitchError: () => switchErrors.push(1) });
  session.attach(URL_A);
  video.currentTime = 0.2;
  video.emit("playing");
  video.currentTime = 42;
  video.emit("timeupdate");
  assert.equal(session.firstFrame, true);
  session.guardTrackSwitch();
  video.calls.length = 0;
  video.error = { code: 3 };
  video.emit("error");
  assert.equal(session.state, "loading", "no error screen for a track switch failure");
  assert.equal(switchErrors.length, 1);
  clock.advance(0);
  assert.ok(video.calls.includes(`src=${URL_A}`), "same link, never another source");
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 42, "same position");
  video.currentTime = 42.2;
  video.emit("playing");
  video.currentTime = 42.5;
  video.emit("timeupdate");
  clock.advance(2000);
  video.error = { code: 3 };
  video.emit("error");
  assert.equal(session.state, "error", "outside the 1.5 s window a decode error is shown");
  assert.equal(session.error.kind, "decode");
}

console.log(
  "PASS: new VIDAA player session (direct src, progress guard, one retry, no source switch, teardown)"
);
