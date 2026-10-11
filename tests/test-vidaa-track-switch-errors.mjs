import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.window = new EventTarget();

const { PlayerController } = await import("../js/core/player/playerController.js");
const { Platform } = await import("../js/platform/index.js");
const { createPlayerSourceFallbackMethods } =
  await import("../js/ui/screens/player/playerSourceFallback.js");
const { createPlayerVideoEventHandlers } =
  await import("../js/ui/screens/player/playerVideoEventHandlers.js");
const { beginVidaaTrackSwitch } = await import("../js/ui/screens/player/vidaaTrackSwitchGuard.js");

const originalController = { ...PlayerController };
const originalPrepare = Platform.prepareVideoElement;
const originalDateNow = Date.now;
let now = 100000;
Date.now = () => now;
Platform.prepareVideoElement = () => {};

function fixture() {
  const video = new EventTarget();
  Object.assign(video, {
    src: "https://fixture.invalid/a.mp4",
    error: null,
    currentTime: 125,
    readyState: 4,
    paused: false
  });
  const calls = { stops: 0, sources: [], progressStops: 0, keepAwake: 0 };
  const candidates = ["a", "b"].map((id) => ({ id, url: `https://fixture.invalid/${id}.mp4` }));
  const ui = {
    ...createPlayerSourceFallbackMethods(),
    streamCandidates: candidates,
    currentStreamIndex: 0,
    activePlaybackUrl: video.src,
    failedPlaybackUrls: new Set(),
    failedPlaybackStreamIds: new Set(),
    sourcePlaybackAttemptToken: 1,
    playbackStartToken: 1,
    playerMountToken: 1,
    playerRouteActive: true,
    sourceFallbackPending: false,
    sourcePlaybackStarting: false,
    hasPresentedPlaybackFrame: true,
    paused: false,
    bufferingActive: true,
    seekLoading: true,
    lastPlaybackErrorAt: 0,
    isStartupErrorVisible: () => false,
    isExternalFrameMode: () => false,
    isActiveMountToken(token = null) {
      return this.playerRouteActive && (token === null || token === this.playerMountToken);
    },
    getCurrentStreamCandidate() {
      return this.streamCandidates[this.currentStreamIndex];
    },
    getStreamCandidateByUrl(url) {
      return this.streamCandidates.find((candidate) => candidate.url === url);
    },
    getPlaybackCurrentSeconds: () => video.currentTime,
    getPlaybackEventErrorDetail: () => "",
    markPlaybackSourceFailed(url, candidate = this.getCurrentStreamCandidate()) {
      this.failedPlaybackUrls.add(url);
      this.failedPlaybackStreamIds.add(candidate.id);
    },
    async playStreamCandidate(candidate) {
      calls.sources.push(candidate.id);
      this.activePlaybackUrl = candidate.url;
    },
    showStartupError() {
      throw new Error("An available next source should handle the failure");
    }
  };
  for (const method of [
    "clearPlaybackStallGuard",
    "releaseStartupAudioGate",
    "clearStartupError",
    "dismissPauseOverlay",
    "updateLoadingVisibility",
    "syncLoadingOverlayStatus"
  ])
    ui[method] = () => {};
  Object.assign(PlayerController, {
    video,
    playRequestToken: 1,
    playbackEngine: "native",
    isPlaying: true,
    viewportSyncHandler: {},
    lifecycleBound: true,
    refreshWebOsDeviceInfo() {},
    stopProgressSaving() {
      calls.progressStops++;
    },
    cancelProgressSyncAfterSeek() {},
    syncWebOsPlaybackKeepAwake() {
      calls.keepAwake++;
    },
    getLastPlaybackErrorCode: () => 0,
    stop() {
      calls.stops++;
      this.playRequestToken++;
      video.currentTime = 0;
      return Promise.resolve();
    }
  });
  document.getElementById = () => video;
  PlayerController.init();
  const { onError } = createPlayerVideoEventHandlers.call(ui, video, () => false);
  let eventPromise;
  video.addEventListener("error", (event) => {
    eventPromise = onError(event);
  });
  return {
    ui,
    video,
    calls,
    async emit(detail) {
      const event = new Event("error");
      if (detail !== undefined) Object.defineProperty(event, "detail", { value: detail });
      video.dispatchEvent(event);
      await eventPromise;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  };
}

function assertFallback(calls) {
  assert.equal(calls.stops, 1, "A real playback failure stops the failed source");
  assert.deepEqual(calls.sources, ["b"], "The production fallback starts the next source");
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("a bare error during a VIDAA track switch preserves playback and progress saving", async () => {
  const { ui, video, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  await emit();
  assert.equal(calls.stops, 0);
  assert.deepEqual(calls.sources, []);
  assert.equal(calls.progressStops, 0);
  assert.equal(calls.keepAwake, 0);
  assert.equal(PlayerController.isPlaying, true);
  assert.equal(video.currentTime, 125);
  assert.equal(ui.lastPlaybackErrorAt, 0);
  assert.equal(ui.bufferingActive, true);
  assert.equal(ui.seekLoading, true);
  assert.equal(ui.failedPlaybackUrls.size, 0);
});

test("the short grace interval catches the event after the native selector returns", async () => {
  const { ui, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  now += 1499;
  await emit({ mediaErrorCode: 0, playbackEngine: "native" });
  assert.equal(calls.stops, 0);
  assert.equal(PlayerController.isPlaying, true);
});

test("a zero-code error after 1500ms still invokes the production source fallback", async () => {
  const { ui, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  now += 1500;
  await emit();
  assertFallback(calls);
});

test("an ordinary zero-code stream error without a track switch still invokes fallback", async () => {
  const { calls, emit } = fixture();
  await emit();
  assertFallback(calls);
});

for (const code of [1, 2, 3, 4]) {
  test(`explicit media error ${code} remains fatal during a track switch`, async () => {
    const { ui, calls, emit } = fixture();
    beginVidaaTrackSwitch(ui);
    await emit({ mediaErrorCode: code });
    assertFallback(calls);
    assert.equal(calls.progressStops, 1);
    assert.equal(PlayerController.isPlaying, false);
  });
}

test("a terminal error on the media element overrides an empty event", async () => {
  const { ui, video, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  video.error = { code: 3 };
  await emit();
  assertFallback(calls);
});

test("a controller terminal error overrides an empty event", async () => {
  const { ui, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  PlayerController.getLastPlaybackErrorCode = () => 2;
  await emit();
  assertFallback(calls);
});

for (const detail of [
  { hlsResponseCode: 403 },
  { hlsErrorDetails: "fragLoadError" },
  { dashError: "network" },
  { avplayError: "connection_failed" }
]) {
  test(`explicit engine diagnostics ${Object.keys(detail)[0]} remain fatal with media code zero`, async () => {
    const { ui, calls, emit } = fixture();
    beginVidaaTrackSwitch(ui);
    await emit(detail);
    assertFallback(calls);
  });
}

for (const scope of ["source", "play token", "mount token", "video"]) {
  test(`a stale ${scope} cannot hide a subsequent stream error`, async () => {
    const { ui, video, calls, emit } = fixture();
    beginVidaaTrackSwitch(ui);
    if (scope === "source") video.src = "https://fixture.invalid/new.mp4";
    if (scope === "play token") PlayerController.playRequestToken++;
    if (scope === "mount token") ui.playerMountToken++;
    if (scope === "video") PlayerController.video = { ...video, src: video.src };
    await emit();
    assertFallback(calls);
  });
}

test("the VIDAA guard does not suppress errors on webOS", async () => {
  const { ui, calls, emit } = fixture();
  beginVidaaTrackSwitch(ui);
  globalThis.__NUVIO_PLATFORM__ = "webos";
  Platform.current = null;
  await emit();
  assertFallback(calls);
});

let failures = 0;
try {
  for (const { name, run } of tests) {
    now = 100000;
    Object.assign(PlayerController, originalController);
    globalThis.__NUVIO_PLATFORM__ = "vidaa";
    Platform.current = null;
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  Object.assign(PlayerController, originalController);
  Platform.prepareVideoElement = originalPrepare;
  Date.now = originalDateNow;
}
console.log(`${tests.length - failures}/${tests.length} VIDAA track-switch error fixtures passed.`);
if (failures) process.exitCode = 1;
