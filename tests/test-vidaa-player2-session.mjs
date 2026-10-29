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
  video.currentTime = 0.2;
  video.emit("timeupdate");
  assert.equal(session.state, "playing");
  assert.equal(session.firstFrame, true);
  assert.equal(clock.timers.size, 0, "zero timers while playing");
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

// 11. The new player never switches source by itself and never uses the forbidden paths.
for (const file of [
  "js/ui/tv2/player/videoSession.js",
  "js/ui/tv2/player/newPlayerScreen.js",
  "js/ui/tv2/player/resolvePlayableCandidate.js"
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
    "canPlayType"
  ])
    assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
}

console.log(
  "PASS: new VIDAA player session (direct src, progress guard, one retry, no source switch, teardown)"
);
