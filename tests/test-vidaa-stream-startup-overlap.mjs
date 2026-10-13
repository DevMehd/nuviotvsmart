import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };
const {
  StreamScreen,
  Router,
  streamRepository,
  watchProgressRepository,
  StreamBadgeSettingsStore
} = await import("../js/ui/screens/stream/streamScreen.js");
const { Platform } = await import("../js/platform/index.js");
const { WebOsLunaService } = await import("../js/platform/webos/webosLunaService.js");
const { onWebOsImageProxyReady } = await import("../js/core/media/imageProxy.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../js/data/local/traktSettingsStore.js");
const { TraktAuthStore } = await import("../js/data/local/traktAuthStore.js");
const { SimklAuthStore } = await import("../js/data/local/simklAuthStore.js");
const { TraktAuthService } = await import("../js/data/repository/traktAuthService.js");
const { watchedItemsRepository } = await import("../js/data/repository/watchedItemsRepository.js");
const { WatchProgressStore } = await import("../js/data/local/watchProgressStore.js");

let methods = StreamScreen;
if (process.argv.includes("--baseline")) {
  const relativePath = "js/ui/screens/stream/streamScreenMethods-04-load-streams.js";
  const moduleUrl = new URL(`../${relativePath}`, import.meta.url);
  const source = execFileSync("git", ["show", `HEAD:${relativePath}`], {
    encoding: "utf8"
  }).replace(/from "(\.[^"]+)"/g, (_, path) => `from "${new URL(path, moduleUrl).href}"`);
  const baseline = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  methods = { ...StreamScreen, ...baseline.createStreamScreenMethods04() };
}

const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (callback) => {
  const id = ++timerId;
  timers.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.cancelAnimationFrame = () => {};
let now = 1800000000000;
Date.now = () => now;
let profileId = "1";
let source = WatchProgressSource.TRAKT;
ProfileManager.getActiveProfileId = () => profileId;
TraktSettingsStore.get = () => ({ watchProgressSource: source, continueWatchingDaysCap: 0 });
TraktAuthStore.isAuthenticated = () => true;
SimklAuthStore.isAuthenticated = () => true;
const navigations = [];
Router.getCurrent = () => "stream";
Router.navigate = (route, params) => navigations.push({ route, params });
streamRepository.setLocalPluginSearchPaused = () => {};
StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false });
const originalResume = watchProgressRepository.getResumeByContentId.bind(watchProgressRepository);
const resumeCalls = [];
function useRealResume() {
  watchProgressRepository.getResumeByContentId = (id, target) => {
    resumeCalls.push({ id, target });
    return originalResume(id, target);
  };
}
const groups = [
  {
    addonName: "Source A",
    addonOrderIndex: 0,
    streams: [{ name: "1080p", url: "https://fixture.invalid/video.mp4" }]
  }
];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}
function screen(params = {}) {
  return {
    ...methods,
    loadToken: 1,
    params: { itemId: "tt1000001", itemType: "movie", startFromBeginning: false, ...params },
    streams: [],
    sourceChips: [],
    addonLogoLookup: {},
    addonFilter: "all",
    focusState: { zone: "filter", index: 0 },
    hasRenderedStreamRouteShell: true,
    container: {
      style: {},
      querySelector: () => null,
      querySelectorAll: () => [],
      replaceChildren() {}
    },
    getFilteredStreams() {
      return this.streams;
    },
    getBackdropUrl: () => "",
    requestRender() {},
    scheduleDebridPreparation() {},
    scheduleErrorChipCleanup() {},
    maybeAutoResumeStream() {},
    maybeAutoPlayStream() {},
    cancelAutoPlayCountdown() {},
    cancelAutoPlaySelectionWait() {},
    cancelScheduledRender() {},
    stopStreamVirtualization() {}
  };
}
function providerSearch() {
  const pending = deferred();
  const calls = [];
  streamRepository.getStreamsFromAllAddons = (type, id, options) => {
    calls.push({ type, id, options });
    return pending.promise;
  };
  return { ...pending, calls, finish: () => pending.resolve({ status: "success", data: groups }) };
}
function traktRemote() {
  const playback = deferred();
  const calls = [];
  TraktAuthService.fetchWatchHistory = async () => {
    calls.push("history");
    return [];
  };
  TraktAuthService.fetchPlaybackState = () => {
    calls.push("playback");
    return playback.promise;
  };
  watchedItemsRepository.getRemoteTraktWatchedShows = async () => {
    calls.push("watched");
    return [];
  };
  return {
    calls,
    finish: (items = []) => playback.resolve(items),
    playback: (progressPercent, contentId = "tt1000001") => ({
      type: "movie",
      contentId,
      videoId: contentId,
      progressPercent,
      pausedAt: new Date(now - 1000).toISOString()
    })
  };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("remote resume and providers overlap; pending network is shared at play", async () => {
  const remote = traktRemote();
  const providers = providerSearch();
  const ui = screen();
  const loading = ui.loadStreams();
  let playing;
  try {
    await settle();
    assert.equal(providers.calls.length, 1);
    assert.deepEqual(remote.calls, ["history", "playback", "watched"]);
    assert.deepEqual(resumeCalls, [{ id: "tt1000001", target: {} }]);
    providers.finish();
    await loading;
    playing = ui.playStream(ui.streams[0].id);
    await settle();
    assert.equal(
      resumeCalls.length,
      2,
      "Play resolves fresh progress, sharing only the remote snapshot"
    );
    assert.equal(remote.calls.length, 3, "The same pending network requests are reused");
    assert.equal(navigations.length, 0, "A pending remote result still retains resume semantics");
    remote.finish([remote.playback(37.5)]);
    await playing;
    assert.equal(navigations.at(-1).params.resumePositionMs, 0);
    assert.equal(navigations.at(-1).params.resumeProgressPercent, 37.5);
    assert.equal(navigations.at(-1).params.resumeDurationMs, 0);
  } finally {
    providers.finish();
    remote.finish();
    await loading;
    await playing;
    await settle();
  }
});

test("completed remote warmup uses repository cache and includes newer local progress", async () => {
  const remote = traktRemote();
  const providers = providerSearch();
  const ui = screen();
  const loading = ui.loadStreams();
  try {
    await settle();
    assert.equal(remote.calls.length, 3);
    remote.finish([remote.playback(25)]);
    await settle();
    WatchProgressStore.upsert(
      {
        contentId: "tt1000001",
        contentType: "movie",
        source: "trakt_local",
        positionMs: 456789,
        durationMs: 1200000,
        updatedAt: now
      },
      profileId
    );
    providers.finish();
    await loading;
    await ui.playStream(ui.streams[0].id);
    assert.equal(resumeCalls.length, 2);
    assert.equal(remote.calls.length, 3);
    assert.equal(navigations.at(-1).params.resumePositionMs, 456789);
    assert.equal(navigations.at(-1).params.resumeDurationMs, 1200000);
    assert.equal(navigations.at(-1).params.resumeProgressPercent, 38.06575);
  } finally {
    providers.finish();
    remote.finish();
    await loading;
    await settle();
  }
});

test("local/cloud progress stays fresh at play and starts no resume warmup", async () => {
  source = WatchProgressSource.NUVIO_SYNC;
  const providers = providerSearch();
  const ui = screen();
  const loading = ui.loadStreams();
  await settle();
  assert.equal(resumeCalls.length, 0);
  WatchProgressStore.upsert(
    {
      contentId: "tt1000001",
      contentType: "movie",
      source: "nuvio_sync",
      positionMs: 123456,
      durationMs: 1200000,
      updatedAt: now
    },
    profileId
  );
  providers.finish();
  await loading;
  await ui.playStream(ui.streams[0].id);
  assert.equal(resumeCalls.length, 1);
  assert.equal(navigations.at(-1).params.resumePositionMs, 123456);
});

for (const [name, params, expected] of [
  ["startFromBeginning", { startFromBeginning: true }, { position: 0, percent: null, duration: 0 }],
  [
    "valid route position",
    { resumePositionMs: 234567, resumeDurationMs: 1200000, resumeProgressPercent: 19.5 },
    { position: 234567, percent: 19.5, duration: 1200000 }
  ],
  [
    "valid route percentage",
    { resumeProgressPercent: 32 },
    { position: 0, percent: 32, duration: 0 }
  ]
]) {
  test(`${name} bypasses remote lookup before search and at play`, async () => {
    const providers = providerSearch();
    const ui = screen(params);
    const loading = ui.loadStreams();
    assert.equal(resumeCalls.length, 0);
    providers.finish();
    await loading;
    await ui.playStream(ui.streams[0].id);
    assert.equal(resumeCalls.length, 0);
    assert.equal(navigations.at(-1).params.resumePositionMs, expected.position);
    assert.equal(navigations.at(-1).params.resumeProgressPercent, expected.percent);
    assert.equal(navigations.at(-1).params.resumeDurationMs, expected.duration);
  });
}

test("completed route progress triggers current validation and exact episode lookup", async () => {
  const calls = [];
  watchProgressRepository.getResumeByContentId = async (id, target) => {
    calls.push({ id, target });
    return { positionMs: 321000, durationMs: 1200000, progressPercent: 26.75 };
  };
  const providers = providerSearch();
  const ui = screen({
    itemType: "series",
    videoId: "tt1000001:2:4",
    season: 2,
    episode: 4,
    resumePositionMs: 1190000,
    resumeDurationMs: 1200000
  });
  const loading = ui.loadStreams();
  providers.finish();
  await loading;
  await ui.playStream(ui.streams[0].id);
  assert.deepEqual(
    calls,
    Array(2).fill({ id: "tt1000001", target: { videoId: "tt1000001:2:4", season: 2, episode: 4 } })
  );
  assert.equal(navigations.at(-1).params.resumePositionMs, 321000);
});

test("cleanup and a new title never navigate from an old warmup or pending play", async () => {
  const pending = deferred();
  watchProgressRepository.getResumeByContentId = (id) =>
    id === "tt1000001"
      ? pending.promise
      : Promise.resolve({ positionMs: 654000, durationMs: 1200000 });
  const providers = providerSearch();
  const ui = screen();
  const loading = ui.loadStreams();
  providers.finish();
  await loading;
  const oldPlay = ui.playStream(ui.streams[0].id);
  ui.cleanup();
  ui.params = { itemId: "tt1000002", itemType: "movie" };
  const nextProviders = providerSearch();
  const nextLoading = ui.loadStreams();
  nextProviders.finish();
  await nextLoading;
  pending.resolve({ positionMs: 111000, durationMs: 1200000 });
  await oldPlay;
  assert.equal(navigations.length, 0);
  await ui.playStream(ui.streams[0].id);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].params.itemId, "tt1000002");
  assert.equal(navigations[0].params.resumePositionMs, 654000);
});

test("a failed warmup is handled and a later play performs a fresh lookup", async () => {
  let calls = 0;
  watchProgressRepository.getResumeByContentId = async () => {
    if (++calls === 1) throw new Error("temporary resume failure");
    return { positionMs: 456000, durationMs: 1200000 };
  };
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const providers = providerSearch();
    const ui = screen();
    const loading = ui.loadStreams();
    providers.finish();
    await loading;
    await settle();
    await ui.playStream(ui.streams[0].id);
    assert.equal(calls, 2);
    assert.equal(warnings.length, 1);
    assert.equal(navigations.at(-1).params.resumePositionMs, 456000);
  } finally {
    console.warn = previousWarn;
  }
});

test("webOS logo service readiness never delays provider search and still refreshes logos", async () => {
  Platform.current = { name: "webos" };
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: true });
  const status = deferred();
  WebOsLunaService.isAvailable = () => true;
  WebOsLunaService.request = () => status.promise;
  const providers = providerSearch();
  const ui = screen({ startFromBeginning: true });
  let refreshes = 0;
  const release = onWebOsImageProxyReady(() => {
    refreshes++;
  });
  const loading = ui.loadStreams();
  try {
    await settle();
    assert.equal(providers.calls.length, 1, "Providers begin while logo proxy status is pending");
    providers.finish();
    await loading;
    assert.equal(ui.streams.length, 1, "Usable stream is available before logo readiness");
    assert.equal(refreshes, 0);
    status.resolve({ url: "http://127.0.0.1:2710" });
    await settle();
    assert.equal(refreshes, 1, "Existing readiness listeners still receive the refresh");
  } finally {
    status.resolve({ url: "http://127.0.0.1:2710" });
    providers.finish();
    await loading;
    await settle();
    release();
  }
});

test("refresh supersedes in-flight source chunks even without AbortController", async () => {
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = undefined;
  try {
    const old = providerSearch();
    const ui = screen({ startFromBeginning: true });
    const oldLoad = ui.loadStreams();
    await settle();
    const fresh = providerSearch();
    const newLoad = ui.loadStreams({ forceRefresh: true });
    await settle();
    assert.equal(fresh.calls[0].options.forceRefresh, true);
    fresh.finish();
    await newLoad;
    const expectedStreams = ui.streams.slice();
    old.calls[0].options.onChunk({
      addonName: "obsolete",
      streams: [{ url: "https://fixture.invalid/obsolete.mp4" }]
    });
    old.resolve({
      status: "success",
      data: [{ addonName: "obsolete", streams: [{ url: "https://fixture.invalid/obsolete.mp4" }] }]
    });
    await oldLoad;
    assert.deepEqual(ui.streams, expectedStreams);
    assert.ok(ui.sourceChips.every((chip) => chip.name !== "obsolete"));
  } finally {
    globalThis.AbortController = originalAbort;
  }
});

test("progressive source results preserve a filter the user selected while loading", async () => {
  const providers = providerSearch();
  const ui = screen({ startFromBeginning: true });
  const loading = ui.loadStreams();
  await settle();
  ui.streamUserMovedFocus = true;
  ui.focusState = { zone: "filter", index: 2 };
  providers.calls[0].options.onChunk(groups[0]);
  await settle();
  assert.deepEqual(ui.focusState, { zone: "filter", index: 2 });
  providers.finish();
  await loading;
  assert.deepEqual(ui.focusState, { zone: "filter", index: 2 });
  assert.equal(ui.streams.length, 1);
});

let failures = 0;
for (const [index, { name, run }] of tests.entries()) {
  profileId = String(index + 1);
  source = WatchProgressSource.TRAKT;
  Platform.current = { name: "vidaa" };
  StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: false });
  WatchProgressStore.replaceForProfile(profileId, []);
  resumeCalls.length = 0;
  navigations.length = 0;
  timers.clear();
  now += 60000;
  useRealResume();
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}
assert.equal(failures, 0);
console.log(`${tests.length}/${tests.length} stream startup overlap cases passed.`);
