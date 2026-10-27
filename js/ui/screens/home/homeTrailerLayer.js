import { MODERN_HOME_CONSTANTS } from "./modernHomeLayout.js";

// Trailer media of the Home hero and poster cards: a YouTube proxy iframe or a looping <video>
// in a layer, revealed on its first frame. Shared by the current Home (methods-12/13) and the
// new TV Home (nuv-091).

// Message listener and reveal timers of each mounted iframe.
const frameCleanups = new WeakMap();

function pauseFrame(frame) {
  frame.dataset.ambientTrailerPlaying = "false";
  try {
    frame.contentWindow?.postMessage(
      {
        source: "nuvio-detail-trailer",
        type: "command",
        command: "pause",
        payload: {}
      },
      "*"
    );
  } catch (_) {}
}

function pauseVideo(video) {
  try {
    video.pause();
  } catch (_) {}
}

function releaseFrame(frame) {
  frameCleanups.get(frame)?.();
  frameCleanups.delete(frame);
  try {
    frame.src = "about:blank";
  } catch (_) {}
  try {
    frame.removeAttribute("src");
  } catch (_) {}
}

function releaseVideo(video) {
  try {
    video.removeAttribute("src");
    video.load?.();
  } catch (_) {}
}

export function pauseTrailerMedia(container) {
  const activeFrame = container.querySelector("iframe");
  if (activeFrame) pauseFrame(activeFrame);
  const activeVideo = container.querySelector("video");
  if (activeVideo) pauseVideo(activeVideo);
}

/** Unloads the layer's media and empties it; pause it first (pauseTrailerMedia). */
export function releaseTrailerMedia(container) {
  const activeFrame = container.querySelector("iframe");
  if (activeFrame) releaseFrame(activeFrame);
  const activeVideo = container.querySelector("video");
  if (activeVideo) releaseVideo(activeVideo);
  container.innerHTML = "";
  container.classList.remove("is-active");
}

/**
 * Appends the trailer to `container` (current Home mountTrailerLayer): `onReady` once it shows,
 * `onError` when the video fails. Returns `stop({deferred})` for this media only, or null when
 * the source has nothing to play. A deferred stop pauses at once and unloads once the TV is idle
 * (current Home scheduleTrailerLayerCleanup). Nothing is called back after stop.
 */
export function mountTrailerMedia(container, source, onReady = null, onError = null) {
  let stopped = false;
  const ready = () => !stopped && onReady?.();
  const fail = () => !stopped && onError?.();
  const stopper = (node, pause, release) => {
    const unload = () => {
      release(node);
      node.remove?.();
    };
    return ({ deferred = false } = {}) => {
      if (stopped) return;
      stopped = true;
      frameCleanups.get(node)?.();
      pause(node);
      if (node.parentElement === container) container.classList.remove("is-active");
      if (!deferred) {
        unload();
        return;
      }
      setTimeout(() => {
        if (typeof globalThis.requestIdleCallback === "function")
          globalThis.requestIdleCallback(unload, { timeout: 120 });
        else unload();
      }, MODERN_HOME_CONSTANTS.smartTvTrailerCleanupDelayMs);
    };
  };
  if (source.kind === "youtube" && source.embedUrl) {
    const frame = document.createElement("iframe");
    frame.className = "home-inline-trailer-frame";
    frame.src = source.embedUrl;
    frame.title = "Trailer preview";
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    let revealTimer = 0;
    let fallbackTimer = 0;
    let revealed = false;
    const reveal = (delayMs = 0) => {
      if (revealed || revealTimer) {
        return;
      }
      revealTimer = setTimeout(() => {
        revealTimer = 0;
        if (revealed || !frame.isConnected || frame.parentElement !== container) {
          return;
        }
        revealed = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = 0;
        }
        container.classList.add("is-active");
        ready();
      }, delayMs);
    };
    const handleProxyMessage = (event) => {
      if (event?.source !== frame.contentWindow) {
        return;
      }
      const data = event?.data;
      if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
        return;
      }
      if (data.type === "ended" || data.type === "error") {
        frame.dataset.ambientTrailerPlaying = "false";
      }
      if (data.type === "firstFrame") {
        frame.dataset.ambientTrailerPlaying = "true";
        reveal(150);
        return;
      }
      const state =
        data.type === "state" && data.state && typeof data.state === "object" ? data.state : null;
      if (state) {
        frame.dataset.ambientTrailerPlaying = String(
          state.paused === false && state.loading === false
        );
      }
      if (state && Number(state.currentTime || 0) > 0 && state.paused === false) {
        reveal(150);
      } else if (state && state.controllable === false && state.loading === false) {
        reveal(1200);
      }
    };
    const cleanup = () => {
      window.removeEventListener("message", handleProxyMessage);
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = 0;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = 0;
      }
    };
    frameCleanups.set(frame, cleanup);
    window.addEventListener("message", handleProxyMessage);
    frame.addEventListener(
      "load",
      () => {
        if (!revealed) {
          fallbackTimer = setTimeout(() => reveal(), 7000);
        }
      },
      { once: true }
    );
    container.appendChild(frame);
    return stopper(frame, pauseFrame, releaseFrame);
  }
  if (source.kind === "video" && source.url) {
    const shouldMute = source.muted !== false;
    const video = document.createElement("video");
    video.className = "home-inline-trailer-video";
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.defaultMuted = shouldMute;
    video.muted = shouldMute;
    video.preload = "auto";
    video.setAttribute("autoplay", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    if (shouldMute) {
      video.setAttribute("muted", "");
    } else {
      video.removeAttribute("muted");
    }
    try {
      video.volume = shouldMute ? 0 : 1;
    } catch (_) {}
    try {
      video.disableRemotePlayback = true;
    } catch (_) {}

    let didActivate = false;
    const activate = () => {
      if (
        didActivate ||
        !video.isConnected ||
        video.parentElement !== container ||
        video.paused ||
        Number(video.readyState || 0) < 2
      ) {
        return;
      }
      didActivate = true;
      container.classList.add("is-active");
      ready();
    };
    ["playing", "timeupdate"].forEach((eventName) => {
      video.addEventListener(eventName, activate, { once: true });
    });
    video.addEventListener(
      "error",
      () => {
        if (!video.isConnected || video.parentElement !== container) return;
        fail();
      },
      { once: true }
    );
    container.appendChild(video);
    video.setAttribute("src", String(source.url || ""));
    try {
      video.load?.();
    } catch (_) {}
    const playAttempt = video.play?.();
    if (playAttempt?.then) {
      playAttempt.then(activate).catch(() => {
        if (!video.isConnected || video.parentElement !== container) return;
        fail();
      });
    } else {
      setTimeout(() => {
        if (video.isConnected && !didActivate && Number(video.readyState || 0) >= 2) {
          activate();
        }
      }, 500);
    }
    return stopper(video, pauseVideo, releaseVideo);
  }
  return null;
}
