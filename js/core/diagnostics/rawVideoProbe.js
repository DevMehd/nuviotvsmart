import { mediaContainer, scrubDiagnosticText } from "./vidaaBenchmark.js";

// "Lecture brute" of the guided Diagnostic (lot P, P0): the last source on a bare
// <video>, without any player layer, to separate "the TV cannot read this file" from
// "our player breaks the start". The result keeps timings, media states, track fields
// and capabilities; never the link, a host or a token.
const EVENTS = [
  "loadstart",
  "progress",
  "loadedmetadata",
  "canplay",
  "playing",
  "timeupdate",
  "waiting",
  "stalled",
  "suspend",
  "error"
];
const CAN_PLAY = {
  mkv: "video/x-matroska",
  hevc: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
  dolbyVision: 'video/mp4; codecs="dvh1.08.06"',
  eac3: 'audio/mp4; codecs="ec-3"',
  truehd: 'audio/mp4; codecs="mlpa"'
};
export const RAW_PROBE_VARIANTS = Object.freeze(["basic", "audio-switch", "source-cycles"]);
const SOURCE_CYCLES = 10;
const short = (value, max = 40) =>
  value === undefined || value === null || value === "" ? null : scrubDiagnosticText(value, max);
const tenths = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const state = (value) => (Number.isInteger(value) && value >= 0 && value <= 9 ? value : null);

// Native track objects expose their fields as prototype getters: read each one explicitly.
export function readTrackFields(list, fields) {
  const tracks = [];
  try {
    for (let i = 0; i < Math.min(16, Number(list?.length) || 0); i += 1) {
      const item = {};
      for (const field of fields) {
        const value = list[i]?.[field];
        item[field] = typeof value === "boolean" ? value : short(value);
      }
      tracks.push(item);
    }
  } catch (_) {}
  return tracks;
}

function release(media) {
  try {
    media.pause();
    media.removeAttribute("src");
    media.load();
  } catch (_) {}
}

export async function runRawVideoProbe({
  root = globalThis,
  url,
  variant = "basic",
  prepare = () => {},
  signal = null,
  observeMs = 30000,
  cycleMs = 15000,
  headerCount = 0
} = {}) {
  const doc = root.document;
  const now = () => root.performance?.now?.() ?? Date.now();
  const sleep = (ms) => new Promise((resolve) => root.setTimeout(resolve, ms));
  const aborted = () => signal?.aborted === true;
  const waitUntil = async (predicate, ms) => {
    const until = now() + ms;
    while (!aborted() && !predicate() && now() < until) await sleep(100);
  };
  // Free the decoder first: the app's #videoPlayer and any trailer still holding a source.
  let released = 0;
  for (const media of doc.querySelectorAll?.("video, audio") || []) {
    if (!media.currentSrc && !media.getAttribute?.("src")) continue;
    release(media);
    released += 1;
  }
  await sleep(0);
  const video = doc.createElement("video");
  video.setAttribute("playsinline", "");
  video.className = "vidaa-raw-probe-video";
  video.style.cssText =
    "position:fixed;right:48px;top:48px;width:960px;height:540px;z-index:2147483000;background:#000";
  doc.body.appendChild(video);
  const run = {
    t0: now(),
    marks: {},
    base: null,
    firstFrameMs: null,
    progress: 0,
    waiting: 0,
    stalled: 0,
    playError: null
  };
  const mark = (name) => {
    if (run.marks[name] === undefined) run.marks[name] = Math.round(now() - run.t0);
  };
  const reached = (name) => {
    mark(name);
    if (run.firstFrameMs === null) run.firstFrameMs = run.marks[name];
  };
  const onEvent = (event) => {
    const type = event.type;
    if (type === "timeupdate") {
      if (run.base !== null && Number(video.currentTime) - run.base > 0.05)
        reached("firstTimeAdvance");
      return;
    }
    if (type === "progress") run.progress += 1;
    if (type === "waiting") run.waiting += 1;
    if (type === "stalled") run.stalled += 1;
    if (type === "playing" && run.base === null) run.base = Number(video.currentTime) || 0;
    mark(type === "progress" ? "firstProgress" : type);
    if (type === "loadedmetadata") {
      const current = run;
      try {
        // rVFC may never fire on a hardware video plane; time advance is the fallback.
        video.requestVideoFrameCallback?.(() => {
          if (current === run) reached("firstFrame");
        });
      } catch (_) {}
    }
  };
  for (const type of EVENTS) video.addEventListener(type, onEvent);
  const play = () => {
    mark("playCalled");
    let pending;
    try {
      pending = video.play();
    } catch (error) {
      pending = Promise.reject(error);
    }
    Promise.resolve(pending).catch((error) => {
      if (error?.name === "NotAllowedError" && !video.muted) {
        video.muted = true;
        mark("mutedFallback");
        play();
      } else run.playError = short(error?.name, 24);
    });
  };
  const attach = () => {
    Object.assign(run, { t0: now(), marks: {}, base: null, firstFrameMs: null });
    prepare(url);
    // Direct src: never a <source> child, which hides network errors from the element.
    video.src = url;
    mark("srcSet");
    play();
  };
  const started = () => run.firstFrameMs !== null || Boolean(video.error);
  let result = null;
  try {
    attach();
    await waitUntil(started, observeMs);
    const firstFrameAt = now();
    // Keep observing the same source for the rest of the window (progress, buffer, frames).
    if (!video.error)
      await waitUntil(() => Boolean(video.error), observeMs - (firstFrameAt - run.t0));
    let quality = null;
    try {
      const sample = video.getVideoPlaybackQuality?.();
      if (sample)
        quality = {
          total: Number(sample.totalVideoFrames) || 0,
          dropped: Number(sample.droppedVideoFrames) || 0
        };
    } catch (_) {}
    let bufferedAhead = null;
    try {
      for (let i = 0; i < video.buffered.length; i += 1)
        if (
          video.buffered.start(i) <= video.currentTime &&
          video.currentTime <= video.buffered.end(i)
        )
          bufferedAhead = tenths(video.buffered.end(i) - video.currentTime);
    } catch (_) {}
    const canPlay = {};
    for (const [name, type] of Object.entries(CAN_PLAY)) {
      let answer = "";
      try {
        answer = String(video.canPlayType(type) || "");
      } catch (_) {}
      canPlay[name] = ["maybe", "probably"].includes(answer) ? answer : "";
    }
    let globals = [];
    try {
      globals = Object.getOwnPropertyNames(root)
        .filter((name) => /^(hisense|vidaa|omi|oipf)/i.test(name))
        .slice(0, 40)
        .map((name) => short(name, 48));
    } catch (_) {}
    const errorCode = Number.isInteger(video.error?.code) ? video.error.code : null;
    result = {
      variant: "raw",
      outcome:
        run.firstFrameMs !== null
          ? "playing"
          : errorCode !== null
            ? "error"
            : aborted()
              ? "abandoned"
              : "timeout",
      marks: { ...run.marks },
      firstFrameMs: run.firstFrameMs,
      errorCode,
      errorMessage: short(video.error?.message, 200),
      networkState: state(video.networkState),
      readyState: state(video.readyState),
      autoSourceSwitches: 0,
      container: mediaContainer(url),
      audioTracks: video.audioTracks ? Number(video.audioTracks.length) || 0 : null,
      textTracks: video.textTracks ? Number(video.textTracks.length) || 0 : null,
      width: Number(video.videoWidth) || null,
      height: Number(video.videoHeight) || null,
      probe: {
        variant,
        released,
        headerCount: Number.isInteger(headerCount) ? Math.min(headerCount, 99) : 0,
        playError: run.playError,
        muted: video.muted === true,
        progressEvents: run.progress,
        waitingEvents: run.waiting,
        stalledEvents: run.stalled,
        playedSeconds: run.base === null ? null : tenths(Number(video.currentTime) - run.base),
        bufferedAheadSeconds: bufferedAhead,
        quality,
        audioTracksApi: "audioTracks" in (root.HTMLMediaElement?.prototype || {}),
        audio: readTrackFields(video.audioTracks, ["id", "kind", "label", "language", "enabled"]),
        text: readTrackFields(video.textTracks, ["id", "kind", "label", "language", "mode"]),
        rvfcApi: typeof video.requestVideoFrameCallback === "function",
        rvfcFired: run.marks.firstFrame !== undefined,
        canPlay,
        globals
      }
    };
    if (variant === "audio-switch") {
      const tracks = video.audioTracks;
      const length = Number(tracks?.length) || 0;
      if (run.firstFrameMs === null || errorCode !== null)
        result.probe.audioSwitch = { skipped: "pas-d-image" };
      else if (length < 2)
        result.probe.audioSwitch = { skipped: tracks ? "une-piste" : "api-absente" };
      else {
        let from = 0;
        for (let i = 0; i < length; i += 1) if (tracks[i].enabled) from = i;
        const to = from === 0 ? 1 : 0;
        const time = Number(video.currentTime);
        const waiting = run.waiting;
        tracks[to].enabled = true;
        tracks[from].enabled = false;
        await waitUntil(() => Boolean(video.error), 5000);
        const enabled = [];
        for (let i = 0; i < Math.min(16, length); i += 1) enabled.push(tracks[i].enabled === true);
        result.probe.audioSwitch = {
          from,
          to,
          enabled,
          errorCode: Number.isInteger(video.error?.code) ? video.error.code : null,
          advancedSeconds: tenths(Number(video.currentTime) - time),
          waitingEvents: run.waiting - waiting
        };
      }
    }
    if (variant === "source-cycles") {
      const cycles = [];
      for (let i = 0; i < SOURCE_CYCLES && !aborted(); i += 1) {
        release(video);
        // One task between teardown and the next src (decoder release hypothesis, lot P §3.4).
        await sleep(0);
        attach();
        await waitUntil(started, cycleMs);
        cycles.push({
          firstFrameMs: run.firstFrameMs,
          errorCode: Number.isInteger(video.error?.code) ? video.error.code : null,
          readyState: state(video.readyState)
        });
      }
      result.probe.cycles = cycles;
    }
  } finally {
    for (const type of EVENTS) video.removeEventListener(type, onEvent);
    release(video);
    video.remove();
  }
  return result;
}
