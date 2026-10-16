import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.window = new EventTarget();
globalThis.document = { visibilityState: "visible", documentElement: {} };
globalThis.fetch = async () => {
  throw Error("Unexpected network request");
};

const { PlayerController } = await import("../js/core/player/playerController.js");
const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args);
const unsupported = () =>
  Object.assign(Error("Il formato selezionato non può essere riprodotto."), {
    name: "NotSupportedError"
  });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

function controller(play) {
  const calls = { native: [], hls: [], libraries: [], attempts: [], plays: 0, stops: 0 };
  let hlsReady = false;
  const video = {
    src: "",
    muted: false,
    defaultMuted: false,
    volume: 1,
    pause() {},
    load() {},
    querySelectorAll: () => [],
    removeAttribute(name) {
      if (name === "src") this.src = "";
    },
    canPlayType: () => "probably",
    play() {
      calls.plays++;
      return play();
    }
  };
  const owner = {
    ...PlayerController,
    video,
    playRequestToken: 0,
    stopWebOsDtsAudioTranscode() {},
    stopProgressSaving() {
      calls.stops++;
    },
    cancelProgressSyncAfterSeek() {},
    flushCurrentProgress: async () => false,
    stopWebOsServiceKeepAlive() {},
    clearWebOsTrackSelections() {},
    teardownAdaptiveInstances() {},
    teardownAvPlay() {},
    resetNativeMediaState() {},
    rememberPlaybackEngineAttempt(_url, engine) {
      calls.attempts.push(engine);
    },
    syncWebOsPlaybackKeepAwake() {},
    startProgressSaving() {},
    async ensureAdaptiveLibrariesForSource(_type, engine) {
      calls.libraries.push(engine);
      if (engine === "hls.js") hlsReady = true;
    },
    waitForNativeMediaId: async () => null,
    canUseAvPlay: () => false,
    applyNativeSource(url, _type, engine) {
      calls.native.push(url);
      this.video.src = url;
      this.playbackEngine = engine;
      return true;
    },
    playWithHlsJs(url) {
      if (!hlsReady) return false;
      calls.hls.push(url);
      this.playbackEngine = "hls.js";
      return true;
    },
    attemptVideoPlay(options) {
      this.pendingPlay = PlayerController.attemptVideoPlay.call(this, options);
      return this.pendingPlay;
    }
  };
  return { owner, video, calls };
}
const start = (owner, id = "source") =>
  owner.play(`https://fixture.invalid/${id}.m3u8`, {
    mediaSourceType: "application/vnd.apple.mpegurl",
    forceEngine: "native-hls"
  });

try {
  // Exercise the production native-HLS branch, including its actual fallback.
  const rejected = controller(() => Promise.reject(unsupported()));
  await start(rejected.owner);
  await rejected.owner.pendingPlay;
  assert.deepEqual(rejected.calls.hls, ["https://fixture.invalid/source.m3u8"]);
  assert.equal(rejected.owner.playbackEngine, "hls.js");
  assert.equal(rejected.owner.isPlaying, true);
  assert.deepEqual(
    rejected.calls.libraries,
    ["native-hls", "hls.js"],
    "Cold MSE is loaded only after native rejection"
  );
  assert.deepEqual(
    rejected.calls.attempts,
    ["native-hls", "hls.js"],
    "The fallback is recorded in the bounded engine ladder"
  );
  assert.equal(warnings.length, 0, "A handled native rejection is not reported as terminal");

  const thrown = controller(() => {
    throw unsupported();
  });
  await start(thrown.owner);
  await thrown.owner.pendingPlay;
  assert.equal(thrown.calls.hls.length, 1, "Synchronous firmware rejections also reach fallback");

  for (const result of [() => Promise.resolve(), () => undefined]) {
    const success = controller(result);
    await start(success.owner);
    await success.owner.pendingPlay;
    assert.equal(success.calls.hls.length, 0);
    assert.equal(success.owner.isPlaying, true);
    assert.deepEqual(
      success.calls.libraries,
      ["native-hls"],
      "Successful native playback keeps MSE unloaded"
    );
  }

  const aborted = controller(() =>
    Promise.reject(Object.assign(Error("Playback interrupted"), { name: "AbortError" }))
  );
  await start(aborted.owner);
  await aborted.owner.pendingPlay;
  assert.equal(aborted.calls.hls.length, 0);
  assert.deepEqual(aborted.calls.libraries, ["native-hls"]);
  assert.equal(warnings.length, 0, "Expected source interruption remains quiet");

  const oldPlay = deferred();
  let first = true;
  const replaced = controller(() => {
    if (first) {
      first = false;
      return oldPlay.promise;
    }
    return Promise.resolve();
  });
  await start(replaced.owner, "old");
  const obsolete = replaced.owner.pendingPlay;
  await flush();
  await start(replaced.owner, "new");
  await replaced.owner.pendingPlay;
  const stopsAfterReplacement = replaced.calls.stops;
  oldPlay.reject(unsupported());
  await obsolete;
  assert.equal(replaced.calls.hls.length, 0, "An obsolete source must not replace the new engine");
  assert.equal(replaced.calls.stops, stopsAfterReplacement);
  assert.equal(replaced.owner.isPlaying, true);
  assert.equal(replaced.video.src, "https://fixture.invalid/new.m3u8");

  const loadingLibrary = deferred();
  first = true;
  const libraryRace = controller(() => {
    if (first) {
      first = false;
      return Promise.reject(unsupported());
    }
    return Promise.resolve();
  });
  libraryRace.owner.ensureAdaptiveLibrariesForSource = async (_type, engine) => {
    libraryRace.calls.libraries.push(engine);
    if (engine === "hls.js") await loadingLibrary.promise;
  };
  await start(libraryRace.owner, "old-library");
  const obsoleteLibrary = libraryRace.owner.pendingPlay;
  await flush();
  assert.deepEqual(libraryRace.calls.libraries, ["native-hls", "hls.js"]);
  await start(libraryRace.owner, "new-library");
  await libraryRace.owner.pendingPlay;
  loadingLibrary.resolve();
  await obsoleteLibrary;
  assert.equal(libraryRace.calls.hls.length, 0, "A late library load cannot attach the old source");
  assert.equal(libraryRace.owner.isPlaying, true);
  assert.equal(libraryRace.video.src, "https://fixture.invalid/new-library.m3u8");

  const waiting = controller(() => Promise.resolve());
  const metadata = deferred();
  let fallbacks = 0;
  const waitingPlay = waiting.owner.attemptVideoPlay({
    beforePlay: () => metadata.promise,
    onRejected: () => {
      fallbacks++;
      return true;
    }
  });
  await flush();
  waiting.owner.playRequestToken++;
  metadata.resolve();
  await waitingPlay;
  assert.equal(waiting.calls.plays, 0, "A superseded metadata wait cannot start the old source");
  assert.equal(fallbacks, 0);
  assert.equal(warnings.length, 0);

  const terminal = controller(() => Promise.reject(unsupported()));
  terminal.owner.playWithHlsJs = () => false;
  await start(terminal.owner);
  await terminal.owner.pendingPlay;
  assert.equal(terminal.owner.isPlaying, false);
  assert.equal(warnings.length, 1, "An unavailable fallback reports the original failure once");
  assert.deepEqual(terminal.calls.attempts, ["native-hls", "hls.js"]);
  assert.equal(
    terminal.calls.plays,
    1,
    "A failed engine fallback cannot restart the same native attempt"
  );

  const network = controller(() =>
    Promise.reject(Object.assign(Error("Connection lost"), { name: "NetworkError" }))
  );
  await start(network.owner);
  await network.owner.pendingPlay;
  assert.deepEqual(
    network.calls.libraries,
    ["native-hls"],
    "Other failures do not load an alternate engine"
  );
  assert.equal(network.calls.hls.length, 0);
  assert.equal(network.owner.isPlaying, false);
  assert.equal(warnings.length, 2);
} finally {
  console.warn = originalWarn;
}

console.log(
  "PASS: native-HLS play rejection reaches HLS fallback; success, abort and obsolete sources stay isolated."
);
