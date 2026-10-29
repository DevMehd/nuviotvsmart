// Core of the new VIDAA player (lot P): the shared <video> with a direct src and an explicit
// play(). Never switches source by itself: a failure ends in state "error" and the user picks
// Sources, Retry or Back. No interface DOM, so it runs in node against a fake video.

const EVENTS = [
  "progress",
  "loadedmetadata",
  "playing",
  "waiting",
  "pause",
  "timeupdate",
  "ended",
  "error"
];

/** HTTP status of a failing link (Range 0-0, 3 s), or 0 when CORS or the network hides it. */
export async function probeHttpStatus(url, { root = globalThis, signal = null } = {}) {
  const controller = new root.AbortController();
  const timer = root.setTimeout(() => controller.abort(), 3000);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort);
  try {
    const response = await root.fetch(url, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      signal: controller.signal
    });
    try {
      await response.body?.cancel?.();
    } catch (_) {}
    return Number(response.status) || 0;
  } catch (_) {
    return 0;
  } finally {
    root.clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
}

export function createVideoSession(
  video,
  {
    root = globalThis,
    prepare = () => {},
    onChange = () => {},
    // Plan defaults, to calibrate with the P0 measures on the TV: no download progress for
    // stallMs (loading or buffering) fails; capMs bounds the wait for a first image.
    stallMs = 25000,
    capMs = 90000,
    retryDelayMs = 1000,
    // Freeze sentinel (C4): a playing video whose time or decoded frames stand still this long
    // is reloaded on the same link at the same position; calibrated on the TV evening (P3).
    freezeMs = 8000,
    freezeReloads = 2,
    probeStatus = probeHttpStatus,
    // Diagnostic counter by event name (freeze reloads); never a link.
    note = () => {}
  } = {}
) {
  const now = () => root.performance?.now?.() ?? Date.now();
  let token = 0;
  let url = "";
  let guard = null;
  let retryTimer = null;
  let probe = null;
  let progressMark = null;
  let base = null;
  let seekTarget = 0;
  let seeksLeft = 0;
  // Percent resume (no position saved): resolved once the real duration is known.
  let startPercent = 0;
  let watch = null;
  let still = null;
  const s = {
    state: "idle",
    error: null,
    firstFrame: false,
    // An image was shown for this source (kept across a same-link reload; reset by attach).
    played: false,
    mutedFallback: false,
    startedAt: 0,
    firstFrameMs: null,
    lastProgressAt: 0,
    position: 0,
    networkRetries: 0,
    freezeReloads: 0,
    attaches: 0
  };

  const set = (state) => {
    if (s.state === state) return;
    s.state = state;
    if (state === "playing") startWatch();
    else stopWatch();
    onChange(s);
  };

  // Only while playing (never paused, buffering or loading): one 2 s check.
  function startWatch() {
    if (watch !== null) return;
    still = null;
    watch = root.setInterval(checkFreeze, 2000);
  }
  function stopWatch() {
    if (watch !== null) root.clearInterval(watch);
    watch = null;
  }
  function decodedFrames() {
    try {
      const quality = video.getVideoPlaybackQuality?.();
      const frames = Number(quality?.totalVideoFrames ?? video.webkitDecodedFrameCount);
      return Number.isFinite(frames) ? frames : null;
    } catch (_) {
      return null;
    }
  }
  function checkFreeze() {
    const t = now();
    const time = Number(video.currentTime) || 0;
    const frames = decodedFrames();
    // A long seek on a large MKV stands still without a waiting event: not a freeze.
    if (root.document?.hidden || video.paused || video.seeking) {
      still = null;
      return;
    }
    if (!still) {
      still = { time, timeAt: t, frames, framesAt: t, framesMoved: false };
      return;
    }
    if (time !== still.time) Object.assign(still, { time, timeAt: t });
    if (frames !== still.frames) {
      // A counter that never moves (hardware plane) proves nothing: frames count once seen moving.
      still.framesMoved = still.frames !== null && frames !== null;
      Object.assign(still, { frames, framesAt: t });
    }
    const timeStuck = video.readyState >= 3 && t - still.timeAt >= freezeMs;
    const framesStuck = still.framesMoved && t - still.framesAt >= freezeMs;
    if (!timeStuck && !framesStuck) return;
    note(timeStuck ? "freezeTime" : "freezeFrames");
    if (s.freezeReloads >= freezeReloads) {
      fail({ kind: "stalled" });
      return;
    }
    s.freezeReloads += 1;
    note("freezeReload");
    load(url, s.position);
  }

  const stopGuard = () => {
    if (guard !== null) root.clearInterval(guard);
    guard = null;
  };
  const startGuard = () => {
    if (guard !== null) return;
    s.lastProgressAt = now();
    progressMark = null;
    guard = root.setInterval(checkGuard, 1000);
  };

  // Progress = any growth of the download, the ready state or the position.
  function progressSignature() {
    let buffered = 0;
    try {
      const ranges = video.buffered;
      if (ranges?.length) buffered = ranges.end(ranges.length - 1);
    } catch (_) {}
    return `${buffered}|${video.readyState}|${Number(video.currentTime) || 0}`;
  }
  function checkGuard() {
    const signature = progressSignature();
    const t = now();
    if (signature !== progressMark) {
      progressMark = signature;
      s.lastProgressAt = t;
    }
    if (video.networkState === 3) fail({ kind: "source", code: 4 });
    else if (!s.firstFrame && t - s.startedAt >= capMs) fail({ kind: "timeout" });
    else if (t - s.lastProgressAt >= stallMs) fail({ kind: "stalled" });
  }

  function fail(error) {
    stopGuard();
    stopWatch();
    s.error = { kind: error.kind, code: error.code || 0, httpStatus: error.httpStatus || 0 };
    if (s.state === "error") onChange(s);
    else set("error");
  }

  function reached() {
    if (s.firstFrame) return;
    s.firstFrame = true;
    s.played = true;
    s.firstFrameMs = Math.round(now() - s.startedAt);
    stopGuard();
    s.error = null;
    s.state = "";
    set(video.paused ? "paused" : "playing");
  }

  function play(current) {
    let pending;
    try {
      pending = video.play();
    } catch (error) {
      pending = Promise.reject(error);
    }
    Promise.resolve(pending).catch((error) => {
      if (current !== token || error?.name !== "NotAllowedError" || video.muted) return;
      // Autoplay with sound refused: start muted, the screen restores sound on the next key.
      video.muted = true;
      s.mutedFallback = true;
      onChange(s);
      play(current);
    });
  }

  function onEvent(event) {
    if (s.state === "idle") return;
    const type = event.type;
    if (type === "progress") {
      s.lastProgressAt = now();
      return;
    }
    if (type === "loadedmetadata") {
      const duration = Number(video.duration);
      const known = Number.isFinite(duration) && duration > 0;
      if (startPercent > 0 && known) {
        seekTarget = (duration * Math.min(100, startPercent)) / 100;
        seeksLeft = 1;
        startPercent = 0;
      }
      // Same bound as the old player: never resume in the last 3 s.
      if (seekTarget > 0 && known) seekTarget = Math.min(seekTarget, Math.max(0, duration - 3));
      if (seekTarget > 0) {
        try {
          video.currentTime = seekTarget;
        } catch (_) {}
      }
      const current = token;
      try {
        // rVFC may never fire on a hardware video plane: the time advance below is the fallback.
        video.requestVideoFrameCallback?.(
          () => current === token && s.state !== "idle" && reached()
        );
      } catch (_) {}
      return;
    }
    if (type === "timeupdate") {
      const time = Number(video.currentTime) || 0;
      if (time > 0) s.position = time;
      if (!s.firstFrame && base !== null && time - base > 0.05) reached();
      return;
    }
    if (type === "playing") {
      if (base === null) base = Number(video.currentTime) || 0;
      // The resume seek is checked once; a short landing gets a single second try.
      if (seekTarget > 0 && seeksLeft > 0) {
        seeksLeft -= 1;
        const tolerance = Math.max(1.5, Math.min(8, seekTarget * 0.03));
        if (base < seekTarget - tolerance) {
          try {
            video.currentTime = seekTarget;
          } catch (_) {}
        }
      }
      // A late start clears a stall or timeout error: the source was never detached.
      if (s.state === "error") {
        s.error = null;
        s.state = "loading";
        // fail() stopped the guard: without it a playing that never shows an image loads forever.
        if (!s.firstFrame) startGuard();
        onChange(s);
      }
      if (s.firstFrame) {
        stopGuard();
        set("playing");
      }
      return;
    }
    if (type === "waiting") {
      if (s.firstFrame && s.state !== "error") {
        set("buffering");
        startGuard();
      }
      return;
    }
    if (type === "pause") {
      if (s.firstFrame && s.state !== "error" && s.state !== "ended") {
        stopGuard();
        set("paused");
      }
      return;
    }
    if (type === "ended") {
      // An end before any image (empty or audio-only answer) would leave the loading screen up.
      if (!s.firstFrame) fail({ kind: "source" });
      else {
        stopGuard();
        set("ended");
      }
      return;
    }
    if (type === "error") onMediaError();
  }

  function onMediaError() {
    const code = Number(video.error?.code || 0);
    if (!code || code === 1) return;
    if (code === 2 && s.networkRetries < 1) {
      // One retry of the same link: from the start before the first image, else in place.
      s.networkRetries += 1;
      const position = s.firstFrame ? s.position : seekTarget;
      const current = token;
      stopGuard();
      retryTimer = root.setTimeout(
        () => {
          retryTimer = null;
          if (current === token) load(url, position);
        },
        s.firstFrame ? 0 : retryDelayMs
      );
      return;
    }
    if (code === 4 && url) {
      stopGuard();
      const current = token;
      probe?.abort();
      probe = new root.AbortController();
      void probeStatus(url, { root, signal: probe.signal }).then((httpStatus) => {
        if (current !== token) return;
        probe = null;
        fail({ kind: "source", code, httpStatus });
      });
      return;
    }
    fail({ kind: code === 3 ? "decode" : code === 2 ? "network" : "source", code });
  }

  // Frees the decoder synchronously, in this order, and never throws (NUV-089).
  function teardown() {
    token += 1;
    stopGuard();
    stopWatch();
    if (retryTimer !== null) root.clearTimeout(retryTimer);
    retryTimer = null;
    probe?.abort();
    probe = null;
    try {
      video.pause();
    } catch (_) {}
    try {
      video.removeAttribute("src");
    } catch (_) {}
    try {
      video.load();
    } catch (_) {}
  }

  function releaseOtherMedia() {
    for (const media of root.document?.querySelectorAll?.("video, audio") || []) {
      if (media === video || (!media.currentSrc && !media.getAttribute?.("src"))) continue;
      try {
        media.pause();
        media.removeAttribute("src");
        media.load();
      } catch (_) {}
    }
  }

  function load(nextUrl, startAt) {
    const hadSource = Boolean(video.getAttribute?.("src") || video.currentSrc);
    teardown();
    url = nextUrl;
    seekTarget = Math.max(0, Number(startAt) || 0);
    seeksLeft = seekTarget > 0 ? 1 : 0;
    base = null;
    s.firstFrame = false;
    s.firstFrameMs = null;
    s.error = null;
    s.position = seekTarget;
    s.startedAt = now();
    s.attaches += 1;
    s.state = "";
    set("loading");
    const current = token;
    const start = () => {
      retryTimer = null;
      if (current !== token) return;
      releaseOtherMedia();
      prepare(url);
      // Direct src only: never a <source> child (its errors skip the <video>), never src="".
      video.src = url;
      startGuard();
      play(current);
    };
    // One task between two sources lets the decoder release the previous one (assumption, P0).
    if (hadSource) retryTimer = root.setTimeout(start, 0);
    else start();
  }

  for (const type of EVENTS) video.addEventListener(type, onEvent);

  return {
    get state() {
      return s.state;
    },
    get error() {
      return s.error;
    },
    get firstFrame() {
      return s.firstFrame;
    },
    get firstFrameMs() {
      return s.firstFrameMs;
    },
    get mutedFallback() {
      return s.mutedFallback;
    },
    get startedAt() {
      return s.startedAt;
    },
    get attaches() {
      return s.attaches;
    },
    get url() {
      return url;
    },
    get played() {
      return s.played;
    },
    /** startPercent applies when no position is known (resumeProgressPercent). */
    attach(nextUrl, { startAt = 0, startPercent: percent = 0 } = {}) {
      s.networkRetries = 0;
      s.freezeReloads = 0;
      s.played = false;
      startPercent = Math.max(0, Number(percent) || 0);
      load(String(nextUrl || ""), startAt);
    },
    /** Same link, same position (Retry button). */
    retry() {
      if (!url) return;
      s.networkRetries = 0;
      s.freezeReloads = 0;
      load(url, s.firstFrame ? s.position : Math.max(seekTarget, s.position));
    },
    restoreSound() {
      if (!s.mutedFallback) return;
      s.mutedFallback = false;
      video.muted = false;
    },
    currentSeconds() {
      const time = Number(video.currentTime);
      return Number.isFinite(time) && s.state !== "loading" ? time : s.position;
    },
    durationSeconds() {
      const duration = Number(video.duration);
      return Number.isFinite(duration) ? duration : 0;
    },
    pause() {
      try {
        video.pause();
      } catch (_) {}
    },
    resume() {
      if (s.firstFrame && s.state !== "error") play(token);
    },
    teardown() {
      teardown();
      s.state = "idle";
    },
    destroy() {
      teardown();
      s.state = "idle";
      for (const type of EVENTS) video.removeEventListener(type, onEvent);
    }
  };
}
