import assert from "node:assert/strict";
import { runRawVideoProbe } from "../js/core/diagnostics/rawVideoProbe.js";

const URL_UNDER_TEST =
  "https://cdn.secret.invalid/dl/Movie.2160p.DV.TrueHD.mkv?token=private-token";

// Native track: fields are prototype getters, so a spread copy would be empty.
class FakeAudioTrack {
  #id;
  #language;
  #label;
  constructor(id, language, label, enabled) {
    this.#id = id;
    this.#language = language;
    this.#label = label;
    this.enabled = enabled;
  }
  get id() {
    return this.#id;
  }
  get kind() {
    return "main";
  }
  get language() {
    return this.#language;
  }
  get label() {
    return this.#label;
  }
}

function fakeVideo(log, behavior) {
  const video = new EventTarget();
  const timers = new Set();
  let src = "";
  const later = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const fire = (type) => video.dispatchEvent(new Event(type));
  // defineProperties keeps the src accessors (Object.assign would copy their values).
  Object.defineProperties(
    video,
    Object.getOwnPropertyDescriptors({
      tagName: "VIDEO",
      style: {},
      muted: false,
      currentTime: 0,
      readyState: 0,
      networkState: 0,
      videoWidth: 0,
      videoHeight: 0,
      error: null,
      textTracks: [],
      audioTracks: [
        new FakeAudioTrack("1", "fre", "Français", true),
        new FakeAudioTrack("2", "eng", "English Atmos", false)
      ],
      buffered: { length: 1, start: () => 0, end: () => 6 },
      get currentSrc() {
        return src;
      },
      get src() {
        return src;
      },
      set src(value) {
        src = value;
        log.push("src");
        video.error = null;
        if (behavior === "silent") return;
        later(5, () => fire("loadstart"));
        if (behavior === "error") {
          later(15, () => {
            video.error = { code: 4, message: `MEDIA_ELEMENT_ERROR: ${URL_UNDER_TEST}` };
            video.networkState = 3;
            fire("error");
          });
          return;
        }
        later(10, () => fire("progress"));
        later(20, () => {
          Object.assign(video, { readyState: 1, videoWidth: 3840, videoHeight: 2160 });
          fire("loadedmetadata");
        });
        later(30, () => {
          video.readyState = 4;
          fire("canplay");
          fire("playing");
        });
        later(45, () => {
          video.currentTime = 0.5;
          fire("timeupdate");
        });
      },
      setAttribute: (name) => log.push(`set:${name}`),
      getAttribute: () => src || null,
      removeAttribute(name) {
        log.push(`remove:${name}`);
        if (name !== "src") return;
        src = "";
        for (const id of timers) clearTimeout(id);
        timers.clear();
        video.currentTime = 0;
      },
      load: () => log.push("load"),
      pause: () => log.push("pause"),
      remove: () => log.push("element-removed"),
      play() {
        log.push(video.muted ? "play-muted" : "play");
        if (!video.muted) {
          const error = new Error("autoplay");
          error.name = "NotAllowedError";
          return Promise.reject(error);
        }
        return Promise.resolve();
      },
      canPlayType: (type) => (type.includes("matroska") ? "maybe" : ""),
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 120, droppedVideoFrames: 3 }),
      requestVideoFrameCallback: (callback) => later(35, callback)
    })
  );
  return video;
}

function setup(behavior = "ok") {
  const log = [];
  const shared = fakeVideo(log, behavior);
  shared.src = "https://app.secret.invalid/previous.mp4";
  log.length = 0;
  let probeVideo = null;
  const root = {
    setTimeout,
    performance,
    HTMLMediaElement: { prototype: { audioTracks: null } },
    Hisense_GetModelName: () => "55U6NQ",
    omiPlayer: {},
    unrelated: 1,
    document: {
      querySelectorAll: () => [shared],
      createElement: () => (probeVideo = fakeVideo(log, behavior)),
      body: { appendChild: () => log.push("append") }
    }
  };
  return { log, root, shared, probe: () => probeVideo };
}

const privacy = (result) => {
  const json = JSON.stringify(result);
  assert.ok(!/secret|private-token|https?:/.test(json), json);
};

{
  const h = setup();
  const prepared = [];
  const result = await runRawVideoProbe({
    root: h.root,
    url: URL_UNDER_TEST,
    observeMs: 300,
    prepare: (url) => prepared.push(url) && h.log.push("prepare"),
    headerCount: 2
  });
  assert.deepEqual(h.log.slice(0, 4), ["pause", "remove:src", "load", "set:playsinline"]);
  assert.ok(h.log.indexOf("prepare") < h.log.indexOf("src"), "domain prepared before src");
  assert.deepEqual(prepared, [URL_UNDER_TEST]);
  assert.equal(h.log.filter((entry) => entry === "src").length, 1, "direct src, never <source>");
  assert.deepEqual(h.log.slice(-4), ["pause", "remove:src", "load", "element-removed"]);
  assert.equal(result.outcome, "playing");
  assert.equal(result.variant, "raw");
  assert.equal(result.container, "mkv");
  const m = result.marks;
  for (const name of ["srcSet", "playCalled", "mutedFallback", "loadstart", "loadedmetadata"])
    assert.ok(m[name] !== undefined, `${name} marked`);
  assert.ok(m.srcSet <= m.playCalled && m.playCalled <= m.loadstart);
  assert.ok(m.loadstart <= m.firstProgress && m.firstProgress <= m.loadedmetadata);
  assert.ok(m.loadedmetadata <= m.playing && m.playing <= m.firstTimeAdvance);
  assert.equal(result.firstFrameMs, Math.min(m.firstFrame, m.firstTimeAdvance));
  assert.equal(result.probe.muted, true, "NotAllowedError falls back to a muted play()");
  assert.equal(result.probe.released, 1);
  assert.equal(result.probe.headerCount, 2);
  assert.deepEqual(result.probe.audio, [
    { id: "1", kind: "main", label: "Français", language: "fre", enabled: true },
    { id: "2", kind: "main", label: "English Atmos", language: "eng", enabled: false }
  ]);
  assert.equal(result.probe.audioTracksApi, true);
  assert.equal(result.probe.rvfcFired, true);
  assert.deepEqual(result.probe.quality, { total: 120, dropped: 3 });
  assert.equal(result.probe.canPlay.mkv, "maybe");
  assert.deepEqual(result.probe.globals.sort(), ["Hisense_GetModelName", "omiPlayer"]);
  assert.deepEqual([result.width, result.height, result.readyState], [3840, 2160, 4]);
  privacy(result);
}
{
  const h = setup("error");
  const result = await runRawVideoProbe({ root: h.root, url: URL_UNDER_TEST, observeMs: 300 });
  assert.equal(result.outcome, "error");
  assert.equal(result.errorCode, 4);
  assert.equal(result.networkState, 3);
  assert.equal(result.errorMessage, "MEDIA_ELEMENT_ERROR: [lien]");
  privacy(result);
}
{
  const h = setup("silent");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const started = performance.now();
  const result = await runRawVideoProbe({
    root: h.root,
    url: URL_UNDER_TEST,
    observeMs: 5000,
    signal: controller.signal
  });
  assert.ok(performance.now() - started < 1000, "Back stops the probe at once");
  assert.equal(result.outcome, "abandoned");
  assert.equal(h.log.at(-1), "element-removed");
  const timeout = await runRawVideoProbe({
    root: setup("silent").root,
    url: URL_UNDER_TEST,
    observeMs: 250
  });
  assert.equal(timeout.outcome, "timeout");
}
{
  const h = setup();
  const result = await runRawVideoProbe({
    root: h.root,
    url: URL_UNDER_TEST,
    observeMs: 200,
    variant: "audio-switch"
  });
  const swap = result.probe.audioSwitch;
  assert.deepEqual([swap.from, swap.to, swap.enabled, swap.errorCode], [0, 1, [false, true], null]);
}
{
  const h = setup();
  const result = await runRawVideoProbe({
    root: h.root,
    url: URL_UNDER_TEST,
    observeMs: 150,
    cycleMs: 400,
    variant: "source-cycles"
  });
  assert.equal(result.probe.cycles.length, 10);
  assert.ok(result.probe.cycles.every((cycle) => cycle.firstFrameMs !== null && !cycle.errorCode));
  assert.equal(h.log.filter((entry) => entry === "src").length, 11);
  privacy(result);
}
console.log(
  "PASS VIDAA raw video probe: bare <video>, decoder released first, ordered marks, muted fallback, getter-read tracks, error/abort/timeout, audio switch, 10 source cycles, no link"
);
