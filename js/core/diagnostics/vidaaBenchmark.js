import {
  sessionNewHomeMode,
  homeEngine,
  homeEngineFallback,
  getWebglVariant,
  webglInfo
} from "../../ui/tv2/newHomeSetting.js";
import { sessionNewSourcesMode } from "../../ui/tv2/newSourcesSetting.js";
import { sessionNewPlayerMode } from "../../ui/tv2/newPlayerSetting.js";
import { VidaaFrameDiagnostics } from "./vidaaFrameDiagnostics.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";

export const BENCHMARK_STEPS = Object.freeze([
  {
    id: "idle",
    title: "Accueil au repos",
    seconds: 20,
    help: "Laissez l’accueil se stabiliser, sans toucher la télécommande.",
    route: "home",
    trigger: "immediate"
  },
  {
    id: "horizontal",
    title: "Navigation horizontale",
    seconds: 30,
    help: "Sur une ligne, alternez déplacements lents et appuis prolongés à droite et à gauche.",
    route: "home",
    trigger: "navigation"
  },
  {
    id: "vertical",
    title: "Navigation verticale",
    seconds: 30,
    help: "Descendez plusieurs lignes, puis remontez. Faites aussi quelques appuis prolongés.",
    route: "home",
    trigger: "navigation"
  },
  {
    id: "details",
    title: "Fiches et retours",
    seconds: 40,
    help: "Ouvrez plusieurs fiches de films ou séries, puis revenez à l’accueil.",
    route: "detail",
    trigger: "route:detail"
  },
  {
    id: "sources",
    title: "Sources et badges",
    seconds: 45,
    help: "Ouvrez une fiche, affichez les liens vidéo puis parcourez leurs badges.",
    route: "stream",
    trigger: "route:stream"
  },
  {
    id: "return",
    title: "Accueil après navigation",
    seconds: 25,
    help: "Parcourez à nouveau l’accueil pour comparer avec le début du parcours.",
    route: "home",
    trigger: "navigation"
  },
  {
    id: "video",
    title: "Lecture vidéo (facultative)",
    seconds: 120,
    help: "Lancez une vidéo habituelle. Laissez-la jouer, puis essayez une avance et les sous-titres. Revenez ici après le test.",
    route: "player",
    trigger: "route:player",
    optional: true
  }
]);
// What starts the stopwatch of a manual step: "immediate", the first arrow key
// pressed on the Home screen ("navigation") or the first visit of a route.
export function describeTrigger(trigger) {
  if (trigger === "navigation") return "dès votre première flèche sur l’accueil";
  if (trigger === "route:detail") return "dès l’ouverture d’une fiche";
  if (trigger === "route:stream") return "dès l’affichage des liens vidéo";
  if (trigger === "route:player") return "dès le lancement de la vidéo";
  return "immédiatement";
}
const REPORT_KEY = "nuvio.vidaa.benchmark.v1";
const ARM_KEY = "nuvio.vidaa.benchmark.boot";
const ROUTES = new Set([
  "home",
  "detail",
  "stream",
  "player",
  "search",
  "discover",
  "library",
  "settings",
  "debugConsole",
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "account"
]);
const safeRoute = (value) => (ROUTES.has(value) ? value : "other");
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
// Player of this app run ("Nouveau lecteur", lot P): "new" or "old".
const playerVariant = () => (sessionNewPlayerMode() === "on" ? "new" : "old");
const STARTUP_RING = 10;
const STARTUP_OUTCOMES = ["pending", "playing", "error", "abandoned", "timeout"];
const STARTUP_EVENTS = [
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
const CONTAINERS = ["mkv", "mp4", "m4v", "webm", "m3u8", "mpd", "ts", "avi", "mov"];
const count = (value, max = 999) =>
  Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : null;
// Media error texts may echo a link or a host: keep the wording, never the address.
// Local streaming servers and private addons are often reached by a bare IPv4.
export function scrubDiagnosticText(value, max = 200) {
  return String(value ?? "")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "[lien]")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/gi, "[hôte]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[hôte]")
    .slice(0, max);
}
// File extension only (never the address): "mkv", "mp4"…, "other" or "unknown".
export function mediaContainer(url) {
  const ext = String(url || "")
    .split(/[?#]/)[0]
    .match(/\.([a-z0-9]{2,4})$/i)?.[1]
    ?.toLowerCase();
  return CONTAINERS.includes(ext) ? ext : ext ? "other" : "unknown";
}
function cleanStartup(entry) {
  const marks = {};
  for (const [name, value] of Object.entries(entry.marks || {}).slice(0, 30))
    if (/^[a-zA-Z]{1,24}$/.test(name) && finite(value) !== null) marks[name] = Math.round(value);
  const clean = {
    at: new Date().toISOString(),
    variant: /^[a-z0-9-]{1,16}$/.test(entry.variant) ? entry.variant : "other",
    outcome: STARTUP_OUTCOMES.includes(entry.outcome) ? entry.outcome : "pending",
    marks,
    firstFrameMs: finite(entry.firstFrameMs) === null ? null : Math.round(entry.firstFrameMs),
    errorCode: count(entry.errorCode, 99),
    errorMessage: entry.errorMessage ? scrubDiagnosticText(entry.errorMessage) : null,
    networkState: count(entry.networkState, 9),
    readyState: count(entry.readyState, 9),
    autoSourceSwitches: count(entry.autoSourceSwitches) ?? 0,
    container:
      CONTAINERS.includes(entry.container) || entry.container === "other"
        ? entry.container
        : "unknown",
    audioTracks: count(entry.audioTracks),
    textTracks: count(entry.textTracks),
    width: count(entry.width, 99999),
    height: count(entry.height, 99999)
  };
  if (entry.probe && typeof entry.probe === "object") {
    const text = JSON.stringify(entry.probe);
    // The raw probe builds its own fields; this is the last guard against an address.
    clean.probe =
      text.length <= 8000 && !/:\/\//.test(text) ? JSON.parse(text) : { dropped: "taille-ou-lien" };
  }
  return clean;
}

// Fixed-size histograms retain the whole step, not just the last 30 seconds.
// Quantiles are upper bounds rounded to 1 ms; overflow uses the observed max.
export function createTimingHistogram() {
  const bins = new Uint32Array(2002);
  let count = 0,
    sum = 0,
    max = 0;
  return {
    add(value) {
      if (finite(value) === null) return;
      bins[Math.min(2001, Math.ceil(value))] += 1;
      count += 1;
      sum += value;
      max = Math.max(max, value);
    },
    snapshot() {
      const quantile = (fraction) => {
        if (!count) return null;
        let seen = 0;
        for (let i = 0; i < bins.length; i += 1) {
          seen += bins[i];
          if (seen >= Math.ceil(count * fraction)) return i === 2001 ? max : i;
        }
        return max;
      };
      return {
        count,
        meanMs: count ? sum / count : null,
        p50Ms: quantile(0.5),
        p95Ms: quantile(0.95),
        p99Ms: quantile(0.99),
        maxMs: count ? max : null
      };
    }
  };
}

export function readBenchmarkEnvironment(root, version = "unknown", mode = "auto") {
  const ua = String(root.navigator?.userAgent || "");
  const chromium = ua.match(/(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/i)?.[1] || null;
  const webkit = ua.match(/AppleWebKit\/(\d+(?:\.\d+){0,3})/i)?.[1] || null;
  let model = null;
  try {
    const candidate = String(root.Hisense_GetModelName?.() || "")
      .trim()
      .toUpperCase();
    // Never retain a raw device label, UA, serial or arbitrary SDK return value.
    if (/^\d{2,3}[A-Z][A-Z0-9]{2,12}$/.test(candidate)) model = candidate;
  } catch (_) {}
  const scripts = root.document?.scripts || [];
  let build = null;
  for (let i = 0; i < scripts.length; i += 1) {
    const match = String(scripts[i].src || "").match(/app\.bundle\.([a-f0-9]{16})\.js/);
    if (match) build = match[1];
  }
  let layout = null;
  try {
    layout = String(LayoutPreferences.get().homeLayout || "");
  } catch (_) {}
  return {
    declaredModel: "55U6NQ",
    declaredFirmware: "V0000.09.60A.Q0707",
    detectedModel: model,
    chromium,
    webkit,
    build,
    version: /^[\d.a-z-]{1,30}$/i.test(version) ? version : "unknown",
    performanceMode: ["auto", "full", "reduced"].includes(mode) ? mode : "auto",
    homeVariant: sessionNewHomeMode(),
    homeEngine: homeEngine(),
    homeEngineFallback: homeEngineFallback(),
    sourcesVariant: sessionNewSourcesMode(),
    webglVariant: getWebglVariant(),
    homeLayout: ["modern", "classic", "grid"].includes(layout) ? layout : null,
    playerVariant: playerVariant(),
    viewport: [finite(root.innerWidth), finite(root.innerHeight)],
    screen: [finite(root.screen?.width), finite(root.screen?.height)],
    pixelRatio: finite(root.devicePixelRatio),
    logicalCoresReported: finite(root.navigator?.hardwareConcurrency),
    approximateDeviceMemoryGiB: finite(root.navigator?.deviceMemory),
    connectionType: ["slow-2g", "2g", "3g", "4g"].includes(
      root.navigator?.connection?.effectiveType
    )
      ? root.navigator.connection.effectiveType
      : null,
    capabilities: {
      worker: typeof root.Worker === "function",
      wasm: typeof root.WebAssembly === "object",
      webAnimations: typeof root.Element?.prototype?.animate === "function",
      imageDecode: typeof root.HTMLImageElement?.prototype?.decode === "function",
      reducedMotion: Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
    }
  };
}

export function readStartupTimings(root) {
  const result = {
    documentMs: null,
    domInteractiveMs: null,
    domContentLoadedMs: null,
    loadMs: null,
    firstPaintMs: null,
    firstContentfulPaintMs: null
  };
  try {
    const nav = root.performance?.getEntriesByType?.("navigation")?.[0];
    if (nav) {
      result.documentMs = finite(nav.responseEnd);
      result.domInteractiveMs = finite(nav.domInteractive);
      result.domContentLoadedMs =
        nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : null;
      result.loadMs = nav.loadEventEnd > 0 ? nav.loadEventEnd : null;
    }
    for (const entry of root.performance?.getEntriesByType?.("paint") || []) {
      if (entry.name === "first-paint") result.firstPaintMs = finite(entry.startTime);
      if (entry.name === "first-contentful-paint")
        result.firstContentfulPaintMs = finite(entry.startTime);
    }
  } catch (_) {}
  return result;
}

export function createVidaaBenchmark(root = globalThis, frames = VidaaFrameDiagnostics) {
  const now = () => root.performance?.now?.() ?? Date.now();
  let enabled = false,
    getRoute = () => "other",
    version = "unknown",
    mode = "auto";
  let report = null,
    running = null,
    timer = null,
    resourceObserver = null,
    hud = null;
  let epoch = 0,
    lastTick = 0,
    observedAfter = 0,
    nextSample = 0,
    lastNotice = 0;
  const listeners = new Set();
  let videoStates = new WeakMap();
  let storageAvailable = true;
  let firstHomeMountedMs = null;
  // Startup recorder of the player route; its last link stays in memory for the raw probe only.
  let startup = null,
    lastMediaSource = "";
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (_) {}
    }
  };
  const visible = () =>
    root.document?.hidden !== true &&
    root.document?.visibilityState !== "hidden" &&
    root.document?.webkitHidden !== true;
  const route = () => safeRoute(getRoute());
  const measuring = () =>
    Boolean(running) && !running.waiting && visible() && route() !== "debugConsole";
  const writeStorage = (key, value) => {
    try {
      if (!root.localStorage) throw new Error("storage unavailable");
      root.localStorage.setItem(key, value);
    } catch (_) {
      storageAvailable = false;
    }
  };
  const removeStorage = (key) => {
    try {
      root.localStorage?.removeItem(key);
    } catch (_) {}
  };
  const readStorage = (key) => {
    try {
      return root.localStorage?.getItem(key);
    } catch (_) {
      return null;
    }
  };
  const save = () => {
    if (report) {
      const text = JSON.stringify(report);
      if (text.length <= 120000) writeStorage(REPORT_KEY, text);
    }
  };
  const getStep = (id) =>
    BENCHMARK_STEPS.find((step) => step.id === id) || {
      id: "startup",
      title: "Démarrage instrumenté",
      help: "Ouvrez votre profil et validez le changelog. Les attentes manuelles font partie du total.",
      seconds: 120,
      route: "home",
      trigger: "immediate"
    };

  function currentReport() {
    if (!report) report = makeReport();
    else if (report.environment.build !== readBenchmarkEnvironment(root, version, mode).build) {
      // A new build is a new comparison: earlier steps belong to the old one.
      report = makeReport();
      save();
    }
    return report;
  }

  function makeReport() {
    return {
      schema: 1,
      protocol: "vidaa-guided-1",
      createdAt: new Date().toISOString(),
      environment: readBenchmarkEnvironment(root, version, mode),
      startup: { ...readStartupTimings(root), firstHomeMountedMs },
      steps: [],
      limitations: [
        "rAF et touche→rAF ne mesurent pas les images réellement affichées",
        "Quantiles arrondis à 1 ms, débordement >2 s résumé par le maximum",
        "Mémoire JS indicative : ni RAM totale ni mémoire GPU",
        "Tailles réseau partielles selon les autorisations des serveurs",
        "Comparaison valide à parcours, contenus et conditions réseau similaires"
      ]
    };
  }

  function updateHud(done = false) {
    if (!root.document?.body) return;
    if (!running && !done) {
      hud?.remove();
      hud = null;
      return;
    }
    if (!hud) {
      hud = root.document.createElement("div");
      hud.className = "vidaa-benchmark-hud";
      root.document.body.appendChild(hud);
    }
    hud.hidden = route() === "debugConsole";
    const step = running ? getStep(running.id) : null;
    const remaining = running ? Math.max(0, Math.ceil(step.seconds - running.elapsedMs / 1000)) : 0;
    hud.textContent = done
      ? typeof done === "string"
        ? done
        : "Mesure terminée · Bilan : Paramètres → À propos → Console debug"
      : running.auto
        ? `Parcours automatique · ${step.title} · ${remaining} s\nNe touchez pas la télécommande : une touche interrompt le parcours.`
        : running.waiting
          ? `${step.title} · prêt\nLe chrono démarre ${describeTrigger(step.trigger)}. ${step.help}`
          : `${step.title} · ${remaining} s\n${step.help}`;
  }

  function resolveTrigger() {
    if (!running?.waiting) return;
    running.waiting = false;
    running.waitedMs = Math.max(0, now() - running.wallStart);
    lastTick = now();
    observedAfter = lastTick;
    nextSample = lastTick;
    updateHud();
    notify();
  }

  function onTriggerKey(event) {
    if (!running?.waiting || getStep(running.id).trigger !== "navigation") return;
    // Only a real remote press starts the stopwatch; synthetic keys never do.
    if (event?.isTrusted === false) return;
    let code = 0;
    try {
      code = Number(event?.keyCode || event?.which || 0);
      if (!code) {
        const key = String(event?.key || "");
        code = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] || 0;
      }
    } catch (_) {
      return;
    }
    if (code >= 37 && code <= 40 && route() === "home") resolveTrigger();
  }

  function collectResource(entry) {
    if (!measuring() || entry.startTime < observedAfter || finite(entry.duration) === null) return;
    const kind = ["img", "css", "script", "fetch", "xmlhttprequest", "video"].includes(
      entry.initiatorType
    )
      ? entry.initiatorType
      : "other";
    const bucket =
      running.network[kind] ||
      (running.network[kind] = {
        timing: createTimingHistogram(),
        count: 0,
        knownBytes: 0,
        restrictedOrUnknown: 0
      });
    bucket.count += 1;
    bucket.timing.add(entry.duration);
    if (entry.transferSize > 0) bucket.knownBytes += entry.transferSize;
    else bucket.restrictedOrUnknown += 1;
    // Deliberately never read entry.name: it may contain a private addon token.
  }

  function observeResources() {
    try {
      const Observer = root.PerformanceObserver;
      if (
        !Observer ||
        (Observer.supportedEntryTypes && !Observer.supportedEntryTypes.includes("resource"))
      )
        return;
      const token = epoch;
      resourceObserver = new Observer((list) => {
        if (token !== epoch) return;
        for (const entry of list.getEntries()) collectResource(entry);
      });
      resourceObserver.observe({ entryTypes: ["resource"] });
      running.resourceTimingSupported = true;
    } catch (_) {
      resourceObserver = null;
    }
  }

  function sampleVideo(video, t) {
    if (!video || !running) return;
    let state = videoStates.get(video);
    if (!state) {
      state = {
        time: t,
        waiting: false,
        waitStart: null,
        total: null,
        dropped: null,
        seenPlay: false
      };
      videoStates.set(video, state);
      running.video.elements += 1;
    }
    const metric = running.video;
    let total = null,
      dropped = null;
    try {
      const quality = video.getVideoPlaybackQuality?.();
      total = finite(quality?.totalVideoFrames ?? video.webkitDecodedFrameCount);
      dropped = finite(quality?.droppedVideoFrames ?? video.webkitDroppedFrameCount);
    } catch (_) {}
    if (total !== null && dropped !== null) {
      metric.qualitySupported = true;
      if (state.total !== null && total >= state.total && dropped >= state.dropped) {
        metric.totalFrames += total - state.total;
        metric.droppedFrames += dropped - state.dropped;
      }
      state.total = total;
      state.dropped = dropped;
    }
    if (!video.paused && !video.ended && video.readyState >= 2) {
      metric.playingSampleMs += Math.min(2500, t - state.time);
      state.seenPlay = true;
      if (metric.firstPlayingMs === null) metric.firstPlayingMs = running.elapsedMs;
    }
    state.time = t;
    metric.width = finite(video.videoWidth);
    metric.height = finite(video.videoHeight);
    try {
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (
          video.currentTime >= video.buffered.start(i) &&
          video.currentTime <= video.buffered.end(i)
        )
          metric.bufferAheadSeconds = video.buffered.end(i) - video.currentTime;
      }
    } catch (_) {}
    if (state.waiting && state.waitStart !== null) {
      metric.waitingMs += Math.max(0, t - state.waitStart);
      state.waitStart = t;
    }
  }

  function onMedia(event) {
    if (!measuring() || event.target?.tagName !== "VIDEO") return;
    const video = event.target,
      t = now();
    sampleVideo(video, t);
    const state = videoStates.get(video);
    if (event.type === "waiting") {
      if (!state.waiting) running.video.waitingEvents += 1;
      state.waiting = true;
      state.waitStart = t;
    }
    if (["playing", "pause", "ended", "emptied", "error"].includes(event.type)) {
      state.waiting = false;
      state.waitStart = null;
    }
    if (event.type === "seeking") running.video.seekEvents += 1;
    if (event.type === "error") running.video.errors += 1;
  }
  const mediaEvents = ["waiting", "playing", "pause", "ended", "emptied", "error", "seeking"];
  function onImage(event) {
    if (measuring() && event.target?.tagName === "IMG")
      running.images[event.type === "error" ? "errors" : "loads"] += 1;
  }

  function sampleSurface(t) {
    if (!measuring()) return;
    const started = now(),
      doc = root.document;
    const count = doc?.getElementsByTagName?.("*")?.length;
    running.surface.samples += 1;
    if (Number.isFinite(count))
      running.surface.peakNodes = Math.max(running.surface.peakNodes || 0, count);
    const images = doc?.images || [];
    let loaded = 0,
      pixels = 0;
    for (let i = 0; i < images.length; i += 1) {
      if (images[i].complete && images[i].naturalWidth > 0) {
        loaded += 1;
        pixels += images[i].naturalWidth * images[i].naturalHeight;
      }
    }
    running.images.peakElements = Math.max(running.images.peakElements, images.length);
    running.images.peakLoaded = Math.max(running.images.peakLoaded, loaded);
    running.images.peakNaturalPixels = Math.max(running.images.peakNaturalPixels, pixels);
    const memory = finite(root.performance?.memory?.usedJSHeapSize);
    if (memory !== null) {
      if (running.surface.heapStartBytes === null) running.surface.heapStartBytes = memory;
      running.surface.heapEndBytes = memory;
      running.surface.heapPeakBytes = Math.max(running.surface.heapPeakBytes || 0, memory);
    }
    const videos = doc?.getElementsByTagName?.("video") || [];
    for (let i = 0; i < videos.length; i += 1) sampleVideo(videos[i], t);
    running.overhead.add(Math.max(0, now() - started));
  }

  function onScriptError() {
    if (measuring()) running.scriptErrors += 1;
  }

  function onVisibility() {
    if (!running) return;
    if (!visible()) {
      running.hiddenCount += 1;
      videoStates = new WeakMap();
    }
    lastTick = now();
    observedAfter = lastTick;
  }

  function pushStartup(entry) {
    const report = currentReport();
    const clean = cleanStartup(entry);
    report.startups = (report.startups || []).concat(clean).slice(-STARTUP_RING);
    save();
    notify();
    return clean;
  }

  // Observes the player's own <video> from the document, without touching the player.
  function startStartup() {
    finishStartup("abandoned");
    startup = {
      entry: pushStartup({ variant: playerVariant(), outcome: "pending" }),
      t0: now(),
      src: "",
      base: null
    };
    for (const type of STARTUP_EVENTS)
      root.document?.addEventListener?.(type, onStartupMedia, true);
  }

  function finishStartup(outcome, video = null) {
    if (!startup) return;
    const { entry } = startup;
    startup = null;
    for (const type of STARTUP_EVENTS)
      root.document?.removeEventListener?.(type, onStartupMedia, true);
    if (entry.outcome === "pending")
      entry.outcome = outcome === "abandoned" && entry.errorCode !== null ? "error" : outcome;
    if (video) {
      entry.networkState = count(video.networkState, 9);
      entry.readyState = count(video.readyState, 9);
    }
    save();
    notify();
  }

  function onStartupMedia(event) {
    const video = event.target;
    if (!startup || video?.tagName !== "VIDEO") return;
    if (route() !== "player") {
      finishStartup("abandoned");
      return;
    }
    const current = startup,
      entry = current.entry,
      type = event.type,
      t = Math.round(now() - current.t0);
    const mark = (name) => {
      if (entry.marks[name] === undefined) entry.marks[name] = t;
    };
    const reached = (name) => {
      mark(name);
      entry.firstFrameMs = t;
      finishStartup("playing", video);
    };
    if (type === "timeupdate") {
      if (current.base !== null && Number(video.currentTime) - current.base > 0.05)
        reached("firstTimeAdvance");
      return;
    }
    if (type === "loadstart") {
      const src = String(video.currentSrc || video.src || "");
      if (current.src && src !== current.src) entry.autoSourceSwitches += 1;
      current.src = src;
      current.base = null;
      // hls.js plays from a blob: the raw probe can only replay a direct http link.
      if (/^https?:/i.test(src)) lastMediaSource = src;
      entry.container = mediaContainer(src);
    }
    if (type === "playing" && current.base === null) current.base = Number(video.currentTime) || 0;
    mark(type === "progress" ? "firstProgress" : type);
    if (type === "loadedmetadata") {
      entry.audioTracks = count(video.audioTracks?.length);
      entry.textTracks = count(video.textTracks?.length);
      entry.width = count(video.videoWidth, 99999);
      entry.height = count(video.videoHeight, 99999);
      try {
        // rVFC may never fire on a hardware video plane; time advance is the fallback.
        video.requestVideoFrameCallback?.(() => {
          if (startup === current) reached("firstFrame");
        });
      } catch (_) {}
    }
    if (type === "error") {
      entry.errorCode = count(video.error?.code, 99);
      entry.errorMessage = video.error?.message ? scrubDiagnosticText(video.error.message) : null;
      entry.networkState = count(video.networkState, 9);
      entry.readyState = count(video.readyState, 9);
      save();
    }
  }

  function cleanup() {
    if (timer !== null) root.clearTimeout?.(timer);
    timer = null;
    resourceObserver?.disconnect();
    resourceObserver = null;
    for (const event of mediaEvents) root.document?.removeEventListener?.(event, onMedia, true);
    root.document?.removeEventListener?.("load", onImage, true);
    root.document?.removeEventListener?.("error", onImage, true);
    root.document?.removeEventListener?.("visibilitychange", onVisibility);
    root.document?.removeEventListener?.("webkitvisibilitychange", onVisibility);
    root.removeEventListener?.("keydown", onTriggerKey, true);
    root.removeEventListener?.("pagehide", onExit);
    root.removeEventListener?.("error", onScriptError);
    root.removeEventListener?.("unhandledrejection", onScriptError);
    frames.stop();
    epoch += 1;
  }

  function snapshotStep() {
    if (!running) return null;
    const result = {};
    for (const key of [
      "id",
      "elapsedMs",
      "hiddenCount",
      "over17",
      "over34",
      "over50",
      "over100",
      "longTaskCount",
      "longTaskMs",
      "blockingMs",
      "resourceTimingSupported",
      "surface",
      "images",
      "video",
      "routes",
      "addon",
      "startedAt",
      "scriptErrors",
      "auto",
      "waiting",
      "waitedMs"
    ])
      result[key] = running[key];
    for (const key of ["frame", "input", "eventLoop", "longtask", "overhead", "routeMount"])
      result[key] = running[key].snapshot();
    result.longTasksSupported = frames.getSnapshot().longTasks.supported;
    result.network = {};
    for (const [key, value] of Object.entries(running.network))
      result.network[key] = {
        count: value.count,
        knownBytes: value.knownBytes,
        restrictedOrUnknown: value.restrictedOrUnknown,
        duration: value.timing.snapshot()
      };
    result.coverage = (running.routes[getStep(running.id).route] || 0) > 2000;
    // Return detached data; callers cannot mutate the active collector.
    return JSON.parse(JSON.stringify(result));
  }

  function stop(reason = "manual", hudMessage = true, note = "") {
    if (!running) return;
    sampleSurface(now());
    const result = snapshotStep();
    result.status = ["complete", "manual", "exit", "incomplete"].includes(reason)
      ? reason
      : "manual";
    if (note) result.note = String(note).slice(0, 160);
    cleanup();
    running = null;
    report.steps = report.steps
      .filter((step) => step.id !== result.id)
      .concat(result)
      .slice(-8);
    report.startup = { ...readStartupTimings(root), firstHomeMountedMs };
    // Latest WebGL facts of the run (lot W1a); kept when this run never drew in WebGL.
    report.webgl = webglInfo() || report.webgl || null;
    save();
    updateHud(hudMessage === false ? false : hudMessage);
    notify();
  }
  function onExit() {
    stop("exit");
  }

  function tick() {
    if (!running) return;
    const t = now(),
      delta = Math.max(0, t - lastTick);
    lastTick = t;
    if (t - running.wallStart > 15 * 60 * 1000) {
      stop("manual");
      return;
    }
    if (running.waiting && getStep(running.id).trigger === `route:${route()}`) resolveTrigger();
    if (measuring()) {
      running.elapsedMs += delta;
      running.routes[route()] = (running.routes[route()] || 0) + delta;
      running.eventLoop.add(Math.max(0, delta - 250));
      if (t >= nextSample) {
        sampleSurface(t);
        nextSample = t + 2000;
      }
    }
    if (running.id === "startup" && (running.routes.home || 0) >= 10000) {
      stop("complete");
      return;
    }
    if (running.elapsedMs >= getStep(running.id).seconds * 1000) {
      stop("complete");
      return;
    }
    if (t - lastNotice >= 1000) {
      updateHud();
      notify();
      lastNotice = t;
    }
    timer = root.setTimeout(tick, 250);
  }

  function start(id, options = {}) {
    if (
      !enabled ||
      !frames.getSnapshot().available ||
      ![...BENCHMARK_STEPS.map((step) => step.id), "startup"].includes(id)
    )
      return false;
    if (running) stop();
    currentReport();
    const auto = options.auto === true;
    running = {
      id,
      auto,
      waiting: !auto && getStep(id).trigger !== "immediate",
      waitedMs: 0,
      wallStart: now(),
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      hiddenCount: 0,
      scriptErrors: 0,
      over17: 0,
      over34: 0,
      over50: 0,
      over100: 0,
      longTaskCount: 0,
      longTaskMs: 0,
      blockingMs: 0,
      surface: {
        samples: 0,
        peakNodes: null,
        heapStartBytes: null,
        heapEndBytes: null,
        heapPeakBytes: null
      },
      images: { loads: 0, errors: 0, peakElements: 0, peakLoaded: 0, peakNaturalPixels: 0 },
      video: {
        elements: 0,
        qualitySupported: false,
        totalFrames: 0,
        droppedFrames: 0,
        playingSampleMs: 0,
        firstPlayingMs: null,
        waitingEvents: 0,
        waitingMs: 0,
        seekEvents: 0,
        errors: 0,
        width: null,
        height: null,
        bufferAheadSeconds: null,
        audioNames: null
      },
      routes: {},
      network: {},
      resourceTimingSupported: false,
      addon: {
        requests: 0,
        success: 0,
        failed: 0,
        aborted: 0,
        hits: 0,
        misses: 0,
        shared: 0,
        durationMs: 0
      }
    };
    for (const key of ["frame", "input", "eventLoop", "longtask", "overhead", "routeMount"])
      running[key] = createTimingHistogram();
    videoStates = new WeakMap();
    frames.reset();
    frames.start();
    lastTick = now();
    observedAfter = lastTick;
    nextSample = lastTick;
    lastNotice = 0;
    observeResources();
    for (const event of mediaEvents) root.document?.addEventListener?.(event, onMedia, true);
    root.document?.addEventListener?.("load", onImage, true);
    root.document?.addEventListener?.("error", onImage, true);
    root.document?.addEventListener?.("visibilitychange", onVisibility);
    root.document?.addEventListener?.("webkitvisibilitychange", onVisibility);
    // Window capture: FocusEngine stops arrows and OK at the document level.
    if (running.waiting) root.addEventListener?.("keydown", onTriggerKey, true);
    root.addEventListener?.("pagehide", onExit);
    root.addEventListener?.("error", onScriptError);
    root.addEventListener?.("unhandledrejection", onScriptError);
    updateHud();
    notify();
    timer = root.setTimeout(tick, 250);
    return true;
  }

  const api = {
    initialize(config = {}) {
      enabled = config.enabled === true;
      getRoute = config.getRoute || getRoute;
      version = config.version || version;
      mode = config.mode || mode;
      frames.initialize({ enabled });
      frames.setSampleListener((kind, value) => {
        if (!measuring()) return;
        running[kind === "frame" ? "frame" : kind === "input" ? "input" : "longtask"].add(value);
        if (kind === "frame") {
          if (value > 1000 / 60 + 1) running.over17 += 1;
          if (value > 1000 / 30 + 1) running.over34 += 1;
          if (value > 50) running.over50 += 1;
          if (value > 100) running.over100 += 1;
        }
        if (kind === "longtask") {
          running.longTaskCount += 1;
          running.longTaskMs += value;
          running.blockingMs += Math.max(0, value - 50);
        }
      });
      if (!enabled) return;
      try {
        const saved = readStorage(REPORT_KEY);
        if (saved && saved.length <= 120000) {
          const parsed = JSON.parse(saved);
          if (
            parsed.schema === 1 &&
            parsed.protocol === "vidaa-guided-1" &&
            Array.isArray(parsed.steps) &&
            parsed.steps.length <= 8 &&
            parsed.environment
          )
            report = parsed;
        }
      } catch (_) {}
      if (readStorage(ARM_KEY) === "1") {
        removeStorage(ARM_KEY);
        start("startup");
      }
    },
    start,
    stop,
    reset() {
      if (running) stop();
      // The startup ring survives a new guided run of the same build.
      const startups = report?.startups;
      report = makeReport();
      if (startups) report.startups = startups;
      removeStorage(REPORT_KEY);
      removeStorage(ARM_KEY);
      updateHud();
      notify();
    },
    armStartup() {
      if (enabled) {
        writeStorage(ARM_KEY, "1");
        notify();
      }
    },
    skipVideo() {
      if (running && running.id !== "video") return;
      if (running) stop();
      currentReport();
      report.steps = report.steps.filter((step) => step.id !== "video");
      report.steps.push({ id: "video", status: "skipped" });
      save();
      notify();
    },
    // VIDAA audio-name evidence: categories and counts only, no URL. Kept in the video
    // step and, outside any step, on the latest startup of the ring.
    noteAudioNames(status) {
      if (!enabled || !status) return;
      const names = {
        result: /^[a-z0-9-]{1,32}$/.test(status.result) ? status.result : "other",
        probeStarted: status.probeStarted === true,
        headerCount: count(status.headerCount) ?? 0,
        nativeCount: count(status.nativeCount) ?? 0,
        namedCount: count(status.namedCount) ?? 0,
        mapped: status.mapped === true,
        redirected: status.redirected === true,
        elapsedMs: Number.isFinite(status.elapsedMs) ? Math.round(status.elapsedMs) : null
      };
      if (running?.id === "video") running.video.audioNames = names;
      const last = report?.startups?.[report.startups.length - 1];
      if (last && JSON.stringify(last.audioNames) !== JSON.stringify(names)) {
        last.audioNames = names;
        save();
      }
    },
    // New player events by name (freeze reloads, first use of each media key code): counts
    // only, never a link. Bounded to 24 names.
    notePlayerEvent(name) {
      if (!enabled || !/^[a-zA-Z0-9_-]{1,32}$/.test(String(name))) return;
      const events = (currentReport().playerEvents ||= {});
      if (!(name in events) && Object.keys(events).length >= 24) return;
      events[name] = (events[name] || 0) + 1;
      save();
      notify();
    },
    // One player startup (variant, marks relative to the player opening, outcome).
    noteStartup(entry) {
      return enabled && entry ? pushStartup(entry) : null;
    },
    lastStartup() {
      return startup?.entry || report?.startups?.[report.startups.length - 1] || null;
    },
    // In memory only, for "Lecture brute de la dernière source"; never written to the report.
    lastMediaSource: () => lastMediaSource,
    isRunning(id) {
      return Boolean(running) && (id === undefined || running.id === id);
    },
    setDriverJournal(entries) {
      if (!Array.isArray(entries)) return;
      currentReport().driverJournal = entries
        .slice(-80)
        .map((entry) => String(entry).slice(0, 160));
      save();
    },
    getState() {
      return {
        enabled,
        active: Boolean(running),
        current: snapshotStep(),
        report: currentReport(),
        storageAvailable,
        startupArmed: readStorage(ARM_KEY) === "1"
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clearHud() {
      if (!running) {
        hud?.remove();
        hud = null;
      }
    },
    showHudMessage(message) {
      if (!running && typeof message === "string" && message) updateHud(message);
    },
    beginRoute(routeName = "") {
      if (enabled && routeName === "player") startStartup();
      else if (startup) finishStartup("abandoned");
      if (running?.waiting && getStep(running.id).trigger === `route:${routeName}`)
        resolveTrigger();
      return measuring() ? { epoch, time: now() } : null;
    },
    endRoute(token, routeName) {
      if (enabled && routeName === "home" && firstHomeMountedMs === null)
        firstHomeMountedMs = now();
      if (routeName === "player" && startup && startup.entry.marks.routeMounted === undefined)
        startup.entry.marks.routeMounted = Math.round(now() - startup.t0);
      if (token?.epoch === epoch && measuring())
        running.routeMount.add(Math.max(0, now() - token.time));
    },
    beginAddon() {
      return measuring() ? { epoch, time: now() } : null;
    },
    endAddon(token, status, cache) {
      if (token?.epoch !== epoch || !measuring()) return;
      const item = running.addon;
      item.requests += 1;
      item.durationMs += Math.max(0, now() - token.time);
      item[status === "success" ? "success" : status === "aborted" ? "aborted" : "failed"] += 1;
      if (cache === "HIT") item.hits += 1;
      if (cache === "MISS") item.misses += 1;
      if (cache === "SHARED") item.shared += 1;
    }
  };
  return api;
}

export const VidaaBenchmark = createVidaaBenchmark();
