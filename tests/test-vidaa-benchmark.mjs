import assert from "node:assert/strict";
import { createVidaaFrameDiagnostics } from "../js/core/diagnostics/vidaaFrameDiagnostics.js";
import {
  createVidaaBenchmark,
  createTimingHistogram,
  describeTrigger,
  readBenchmarkEnvironment
} from "../js/core/diagnostics/vidaaBenchmark.js";
import {
  createExportId,
  renderBenchmarkPage,
  renderExportView
} from "../js/ui/screens/debug/vidaaBenchmarkPanel.js";

// App storage read by the environment (home layout preference).
const appStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (appStore.has(key) ? appStore.get(key) : null),
  setItem: (key, value) => appStore.set(key, String(value)),
  removeItem: (key) => appStore.delete(key)
};

function surface() {
  const listeners = new Map();
  return {
    addEventListener(k, fn) {
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k).add(fn);
    },
    removeEventListener(k, fn) {
      listeners.get(k)?.delete(fn);
    },
    emit(k, event = {}) {
      for (const fn of listeners.get(k) || [])
        fn(Object.defineProperty(event, "type", { value: k, configurable: true }));
    },
    count() {
      return [...listeners.values()].reduce((sum, list) => sum + list.size, 0);
    }
  };
}
function harness({ stored = new Map(), observer = true } = {}) {
  let time = 0,
    route = "debugConsole",
    next = 1;
  const timers = new Map(),
    raf = new Map(),
    observers = [],
    videos = [];
  const document = {
    ...surface(),
    hidden: false,
    visibilityState: "visible",
    images: [],
    scripts: [],
    getElementsByTagName: (name) => (name === "video" ? videos : Array(42)),
    body: null
  };
  const root = {
    ...surface(),
    document,
    innerWidth: 1920,
    innerHeight: 1080,
    navigator: { userAgent: "Chrome/100.2.3.4 private-token" },
    screen: { width: 1920, height: 1080 },
    performance: { now: () => time, getEntriesByType: () => [], memory: { usedJSHeapSize: 1234 } },
    localStorage: {
      getItem: (k) => stored.get(k),
      setItem: (k, v) => stored.set(k, v),
      removeItem: (k) => stored.delete(k)
    },
    setTimeout(fn, wait) {
      const id = next++;
      timers.set(id, { fn, at: time + wait });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      const id = next++;
      raf.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      raf.delete(id);
    }
  };
  if (observer)
    root.PerformanceObserver = class {
      static supportedEntryTypes = ["resource", "longtask"];
      constructor(fn) {
        this.fn = fn;
        this.disconnected = false;
        observers.push(this);
      }
      observe(options) {
        this.kind = options.entryTypes[0];
      }
      disconnect() {
        this.disconnected = true;
      }
    };
  const frames = createVidaaFrameDiagnostics(root),
    service = createVidaaBenchmark(root, frames);
  const advance = (ms) => {
    const target = time + ms;
    while (true) {
      const candidate = [...timers]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!candidate) break;
      time = candidate[1].at;
      timers.delete(candidate[0]);
      candidate[1].fn();
    }
    time = target;
  };
  const frame = (ms) => {
    advance(ms);
    const list = [...raf.values()];
    raf.clear();
    for (const fn of list) fn(time);
  };
  return {
    root,
    document,
    timers,
    raf,
    observers,
    videos,
    stored,
    frames,
    service,
    advance,
    frame,
    setRoute(value) {
      route = value;
    },
    enable() {
      service.initialize({ enabled: true, getRoute: () => route, version: "1.2.4" });
    }
  };
}
{
  const hist = createTimingHistogram();
  for (let i = 0; i < 5000; i++) hist.add(i < 4900 ? 16.7 : 100);
  const s = hist.snapshot();
  assert.equal(s.count, 5000);
  assert.equal(s.p95Ms, 17);
  assert.equal(s.maxMs, 100);
}
{
  const h = harness();
  assert.equal(h.service.start("idle"), false);
  h.enable();
  assert.equal(h.timers.size, 0);
  assert.equal(h.observers.length, 0);
  h.service.start("idle");
  h.frame(16);
  h.frame(100);
  assert.equal(h.service.getState().current.frame.count, 0, "Console excluded");
  h.setRoute("home");
  h.frame(16);
  h.frame(16);
  h.frame(80);
  const request = h.service.beginAddon();
  h.advance(20);
  h.service.endAddon(request, "success", "HIT");
  const poisonedEntry = {
    startTime: 120,
    duration: 200,
    transferSize: 0,
    initiatorType: "img",
    get name() {
      throw new Error("Do not inspect private URLs");
    }
  };
  h.observers.find((o) => o.kind === "resource").fn({ getEntries: () => [poisonedEntry] });
  h.document.emit("load", { target: { tagName: "IMG" } });
  h.document.emit("error", { target: { tagName: "IMG" } });
  h.advance(2500);
  h.service.stop();
  const state = h.service.getState(),
    step = state.report.steps[0];
  assert.equal(step.frame.count, 3);
  assert.equal(step.over50, 1);
  assert.equal(step.addon.hits, 1);
  assert.equal(step.network.img.restrictedOrUnknown, 1);
  assert.equal(step.images.errors, 1);
  assert.equal(step.surface.peakNodes, 42);
  assert.equal(step.surface.heapStartBytes, 1234);
  assert.equal(h.timers.size, 0);
  assert.equal(h.raf.size, 0);
  assert.equal(h.document.count() + h.root.count(), 0);
  assert.ok(h.observers.every((o) => o.disconnected));
  const json = JSON.stringify(state.report);
  assert.ok(!json.includes("private-token"));
  assert.ok(!json.includes("userAgent"));
  for (let page = 0; page < 6; page++) assert.match(renderBenchmarkPage(state, page), /<h2>/);
  const restored = harness({ stored: h.stored });
  restored.enable();
  assert.equal(restored.service.getState().report.steps.length, 1);
  h.service.start("horizontal");
  h.service.endAddon(request, "success", "HIT");
  assert.equal(h.service.getState().current.addon.hits, 0, "Late previous-step request ignored");
  h.service.stop();
}
{
  const h = harness({ observer: false });
  h.enable();
  h.setRoute("home");
  h.service.start("idle");
  h.frame(16);
  h.frame(16);
  h.document.hidden = true;
  h.document.emit("visibilitychange");
  h.advance(60000);
  assert.equal(h.service.getState().current.elapsedMs, 0);
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  h.frame(16);
  h.frame(16);
  h.advance(20400);
  const state = h.service.getState();
  assert.equal(state.active, false);
  assert.equal(state.report.steps[0].status, "complete");
  assert.ok(state.report.steps[0].elapsedMs < 21000);
  assert.equal(state.report.steps[0].resourceTimingSupported, false);
  assert.ok(state.report.steps[0].frame.maxMs < 100);
  assert.equal(h.timers.size, 0);
}
{
  const h = harness();
  h.enable();
  h.service.armStartup();
  const fresh = harness({ stored: h.stored });
  fresh.enable();
  assert.equal(fresh.service.getState().current.id, "startup");
  assert.equal(fresh.service.getState().startupArmed, false);
  fresh.setRoute("home");
  fresh.advance(10500);
  assert.equal(fresh.service.getState().active, false);
}
{
  const h = harness();
  h.enable();
  h.setRoute("player");
  let total = 1000,
    dropped = 40;
  const video = {
    tagName: "VIDEO",
    readyState: 4,
    paused: false,
    ended: false,
    videoWidth: 1920,
    videoHeight: 1080,
    buffered: { length: 0 },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
    get src() {
      throw new Error("Never inspect media URLs");
    }
  };
  h.videos.push(video);
  h.service.start("video");
  h.advance(250);
  total += 120;
  dropped += 2;
  h.advance(2000);
  h.document.emit("waiting", { target: video });
  h.advance(1000);
  h.document.emit("playing", { target: video });
  h.document.emit("seeking", { target: video });
  h.service.stop();
  const s = h.service.getState().report.steps[0].video;
  assert.equal(s.totalFrames, 120);
  assert.equal(s.droppedFrames, 2);
  assert.equal(s.waitingEvents, 1);
  assert.equal(s.waitingMs, 1000);
  assert.equal(s.seekEvents, 1);
}
{
  // VIDAA audio-name evidence: kept in the video step, categories and counts only.
  const h = harness();
  h.enable();
  h.setRoute("player");
  h.service.noteAudioNames({ result: "cors", nativeCount: 9 });
  h.service.start("video", { auto: true });
  assert.equal(h.service.getState().current.video.audioNames, null);
  h.service.noteAudioNames({
    result: "https://secret.invalid/token",
    probeStarted: true,
    headerCount: 0,
    nativeCount: 9,
    namedCount: 0,
    mapped: false,
    redirected: "yes",
    elapsedMs: 812.4,
    url: "https://secret.invalid/token"
  });
  assert.equal(h.service.getState().current.video.audioNames.result, "other");
  h.service.noteAudioNames({
    result: "range-refused",
    probeStarted: true,
    headerCount: 0,
    nativeCount: 9,
    namedCount: 0,
    mapped: false,
    redirected: false,
    elapsedMs: 812.4
  });
  h.service.stop();
  const step = h.service.getState().report.steps.find((item) => item.id === "video");
  assert.deepEqual(step.video.audioNames, {
    result: "range-refused",
    probeStarted: true,
    headerCount: 0,
    nativeCount: 9,
    namedCount: 0,
    mapped: false,
    redirected: false,
    elapsedMs: 812
  });
  assert.equal(JSON.stringify(h.service.getState().report).includes("secret"), false);
  const page = renderBenchmarkPage(h.service.getState(), 5, "video");
  assert.match(
    page,
    /Noms des pistes audio<\/span><strong>range-refused · 0\/9 nommées · en-tête 0 · 812 ms/
  );
}
{
  const env = readBenchmarkEnvironment(
    { navigator: { userAgent: "secret" }, Hisense_GetModelName: () => "serial/private-token" },
    "bad<>version"
  );
  assert.equal(env.detectedModel, null);
  assert.equal(env.chromium, null);
  assert.equal(env.version, "unknown");
  assert.equal(env.homeVariant, "off");
  assert.equal(env.homeEngine, "off");
  assert.equal(env.sourcesVariant, "off");
  assert.equal(env.homeLayout, "modern");
  const h = harness();
  h.enable();
  h.service.start("idle");
  h.document.emit("keydown", {
    get key() {
      throw new Error("No raw keys");
    }
  });
  h.root.emit("pagehide");
  assert.equal(h.service.getState().report.steps[0].status, "exit");
  assert.equal(h.timers.size, 0);
}
{
  // A manual navigation step arms itself and waits for the first real arrow key.
  const h = harness();
  h.enable();
  h.setRoute("home");
  h.service.start("horizontal");
  assert.equal(h.service.getState().current.waiting, true);
  h.frame(16);
  h.frame(16);
  h.advance(3000);
  assert.equal(h.service.getState().current.elapsedMs, 0);
  assert.equal(h.service.getState().current.frame.count, 0);
  h.root.emit("keydown", { keyCode: 39, isTrusted: false });
  assert.equal(h.service.getState().current.waiting, true, "synthetic keys never start it");
  h.root.emit("keydown", { keyCode: 13 });
  assert.equal(h.service.getState().current.waiting, true, "OK is not navigation");
  h.document.emit("keydown", { keyCode: 39 });
  assert.equal(h.service.getState().current.waiting, true, "document listeners are stopped");
  h.root.emit("keydown", { keyCode: 39 });
  assert.equal(h.service.getState().current.waiting, false);
  h.frame(16);
  h.frame(16);
  h.advance(1000);
  // Ticks run every 250 ms from the trigger, so just under a second is counted.
  assert.ok(h.service.getState().current.elapsedMs >= 900);
  assert.ok(h.service.getState().current.elapsedMs <= 1000);
  assert.ok(h.service.getState().current.frame.count >= 1);
  assert.ok(h.service.getState().current.waitedMs >= 3000);
  h.service.stop();
  assert.equal(h.document.count() + h.root.count(), 0, "trigger listener removed");
}
{
  // A screen step starts as soon as that screen begins to mount.
  const h = harness();
  h.enable();
  h.setRoute("home");
  h.service.start("details");
  assert.equal(h.service.getState().current.waiting, true);
  assert.equal(h.service.beginRoute("home"), null);
  h.advance(2000);
  assert.equal(h.service.getState().current.elapsedMs, 0);
  h.setRoute("detail");
  const token = h.service.beginRoute("detail");
  assert.ok(token, "the first detail mount is measured");
  h.advance(30);
  h.service.endRoute(token, "detail");
  assert.equal(h.service.getState().current.routeMount.count, 1);
  h.service.stop();
  const again = harness();
  again.enable();
  again.setRoute("home");
  again.service.start("sources");
  again.setRoute("stream");
  again.advance(250);
  assert.equal(again.service.getState().current.waiting, false, "tick notices the route");
  again.service.stop();
}
{
  // The automatic run starts at once and is flagged in the report.
  const h = harness();
  h.enable();
  h.setRoute("home");
  h.service.start("horizontal", { auto: true });
  assert.equal(h.service.getState().current.waiting, false);
  assert.equal(h.service.getState().current.auto, true);
  h.advance(1000);
  assert.ok(h.service.getState().current.elapsedMs >= 1000);
  h.service.stop("complete", false);
  assert.equal(h.service.getState().report.steps[0].auto, true);
  assert.equal(h.service.getState().report.steps[0].status, "complete");
  assert.equal(describeTrigger("navigation"), "dès votre première flèche sur l’accueil");
  assert.equal(describeTrigger("route:player"), "dès le lancement de la vidéo");
  assert.equal(describeTrigger("immediate"), "immédiatement");
  const page = renderBenchmarkPage(h.service.getState(), 0, null, {
    active: true,
    stepIndex: 2,
    total: 7,
    stepId: "horizontal"
  });
  assert.match(page, /Parcours automatique en cours · étape 2\/7/);
  assert.match(page, /terminée · automatique/);
  h.service.setDriverJournal([
    "0 s · parcours automatique : 7 étape(s)",
    "12 s · fiches ouvertes : 3"
  ]);
  const journalPage = renderBenchmarkPage(h.service.getState(), 6, null, {});
  assert.match(journalPage, /Journal du parcours/);
  assert.match(journalPage, /fiches ouvertes : 3/);
  h.service.start("details", { auto: true });
  h.service.stop("incomplete", false, "aucune fiche ouverte");
  const incomplete = renderBenchmarkPage(h.service.getState(), 0, null, {});
  assert.match(incomplete, /incomplète · automatique · aucune fiche ouverte/);
  assert.equal(
    h.service.getState().report.steps.find((step) => step.id === "details").status,
    "incomplete"
  );
  const exported = renderExportView({
    status: "ready",
    url: "https://nuvio.example/d/abcdefghijklmnop2345",
    durable: false
  });
  assert.match(exported, /<canvas/);
  assert.match(exported, /https:\/\/nuvio.example\/d\/abcdefghijklmnop2345/);
  assert.match(exported, /30 minutes/);
  assert.match(renderExportView({ status: "error", error: "http 503" }), /http 503/);
  assert.match(
    createExportId({ crypto: { getRandomValues: (bytes) => bytes.fill(7) } }),
    /^[a-z2-7]{20}$/
  );
  assert.match(createExportId({}), /^[a-z2-7]{20}$/);
}
{
  // Player startup ring (lot P, P0): observed from the document, kept outside any step.
  const h = harness();
  h.enable();
  h.setRoute("player");
  const video = {
    tagName: "VIDEO",
    currentSrc: "https://cdn.secret.invalid/a/Movie.2160p.MKV?token=private-token",
    currentTime: 0,
    readyState: 0,
    networkState: 2,
    videoWidth: 3840,
    videoHeight: 2160,
    audioTracks: { length: 2 },
    textTracks: { length: 1 },
    error: null
  };
  const at = (ms, type) => {
    h.advance(ms);
    h.document.emit(type, { target: video });
  };
  const token = h.service.beginRoute("player");
  assert.equal(h.service.lastStartup().outcome, "pending", "pending entry kept if the app dies");
  h.advance(40);
  h.service.endRoute(token, "player");
  at(60, "loadstart");
  at(200, "progress");
  at(600, "loadedmetadata");
  video.error = {
    code: 2,
    message:
      "PIPELINE_ERROR_NETWORK: https://cdn.secret.invalid/x?token=private-token at secret.invalid"
  };
  at(100, "error");
  video.currentSrc = "https://other.secret.invalid/b/Movie.1080p.mkv?token=private-token";
  at(200, "loadstart");
  at(800, "playing");
  video.currentTime = 0.02;
  at(250, "timeupdate");
  assert.equal(h.service.lastStartup().outcome, "pending", "a playing event alone is not an image");
  video.currentTime = 0.4;
  at(250, "timeupdate");
  const entry = h.service.lastStartup();
  assert.equal(entry.variant, "old");
  assert.equal(entry.outcome, "playing");
  assert.equal(entry.firstFrameMs, 2500);
  assert.equal(entry.marks.routeMounted, 40);
  assert.equal(entry.marks.loadstart, 100, "first occurrence kept");
  assert.equal(entry.marks.firstProgress, 300);
  assert.equal(entry.marks.firstTimeAdvance, 2500);
  assert.equal(entry.autoSourceSwitches, 1);
  assert.equal(entry.container, "mkv");
  assert.equal(entry.errorCode, 2);
  assert.equal(entry.errorMessage, "PIPELINE_ERROR_NETWORK: [lien] at [hôte]");
  assert.deepEqual([entry.audioTracks, entry.textTracks, entry.width], [2, 1, 3840]);
  assert.equal(h.document.count() + h.root.count(), 0, "recorder listeners removed at first image");
  assert.match(h.service.lastMediaSource(), /^https:\/\/other/, "in memory for the raw probe");
  h.service.noteAudioNames({ result: "ok", nativeCount: 2, namedCount: 2, headerCount: 2 });
  assert.equal(h.service.lastStartup().audioNames.namedCount, 2, "accepted outside a step");
  // Leaving the player before any image: abandoned; after a media error: error.
  h.service.beginRoute("player");
  h.setRoute("home");
  h.service.beginRoute("home");
  assert.equal(h.service.lastStartup().outcome, "abandoned");
  h.setRoute("player");
  h.service.beginRoute("player");
  video.currentSrc = "https://cdn.secret.invalid/c.mp4";
  at(10, "loadstart");
  video.error = { code: 4, message: "MEDIA_ELEMENT_ERROR: Format error" };
  at(10, "error");
  h.setRoute("stream");
  h.service.beginRoute("stream");
  assert.equal(h.service.lastStartup().outcome, "error");
  assert.equal(h.service.lastStartup().container, "mp4");
  assert.equal(h.document.count() + h.root.count(), 0);
  const json = JSON.stringify(h.service.getState().report) + [...h.stored.values()].join("");
  assert.ok(!/secret|private-token|https?:/.test(json), "no link, host or token in the report");
  assert.equal(h.service.getState().report.environment.playerVariant, "old");
  const page = renderBenchmarkPage(h.service.getState(), 7);
  assert.match(page, /Démarrages vidéo/);
  assert.match(
    page,
    /ancien lecteur · lecture · 1re image 2500 ms · 1 changement\(s\) auto · mkv · 3840×2160 · erreur 2/
  );
  assert.match(page, /ancien lecteur · quitté avant l’image/);
  h.service.reset();
  assert.equal(h.service.getState().report.startups.length, 3, "a new guided run keeps the ring");
  for (let i = 0; i < 12; i += 1)
    h.service.noteStartup({
      variant: "raw",
      outcome: "timeout",
      marks: { srcSet: i, "bad key": 1 }
    });
  const ring = h.service.getState().report.startups;
  assert.equal(ring.length, 10, "bounded to the last 10 startups");
  assert.deepEqual(ring[9].marks, { srcSet: 11 });
  h.service.noteStartup({
    variant: "raw",
    outcome: "playing",
    firstFrameMs: 1800,
    container: "mkv",
    errorMessage: "",
    marks: { srcSet: 0, loadstart: 30, playing: 1700, firstTimeAdvance: 1800 },
    probe: {
      variant: "audio-switch",
      headerCount: 0,
      muted: true,
      progressEvents: 4,
      waitingEvents: 1,
      stalledEvents: 0,
      playedSeconds: 27.5,
      bufferedAheadSeconds: 12,
      quality: { total: 660, dropped: 2 },
      audioTracksApi: true,
      audio: [{ language: "fre", label: null, enabled: true }],
      text: [],
      rvfcApi: true,
      rvfcFired: false,
      canPlay: { mkv: "maybe", truehd: "" },
      globals: ["Hisense_GetModelName"],
      audioSwitch: { skipped: "une-piste" },
      cycles: [{ firstFrameMs: 900 }, { firstFrameMs: null, errorCode: 2 }]
    }
  });
  const rawPage = renderBenchmarkPage(h.service.getState(), 7);
  assert.match(
    rawPage,
    /lecture brute · lecture · 1re image 1800 ms · 0 changement\(s\) auto · mkv/
  );
  assert.match(rawPage, /Dernière lecture brute \(audio-switch\)/);
  assert.match(rawPage, /srcSet 0 · loadstart 30 · playing 1700 · firstTimeAdvance 1800/);
  assert.match(rawPage, /oui \/ fre\|\?\*/);
  assert.match(rawPage, /jamais déclenché/);
  assert.match(rawPage, /mkv:maybe truehd:non/);
  assert.match(rawPage, /non tenté : une-piste/);
  assert.match(rawPage, /1\/2 avec image · médiane 900 ms · erreurs 1/);
  const probe = h.service.noteStartup({ variant: "raw", probe: { note: "see https://x.y" } });
  assert.deepEqual(probe.probe, { dropped: "taille-ou-lien" });
  const off = harness();
  off.service.initialize({ enabled: false, getRoute: () => "player" });
  off.service.beginRoute("player");
  assert.equal(off.document.count(), 0, "no recorder outside VIDAA");
  assert.equal(off.service.noteStartup({ variant: "raw" }), null);
}
console.log(
  "PASS guided VIDAA benchmark: session bounds, visibility, privacy, resources, video deltas, persistence, startup and report pages"
);
