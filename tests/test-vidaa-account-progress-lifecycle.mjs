import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.fetch = async () => {
  throw new Error("Unexpected network request in lifecycle fixture");
};

const {
  StartupSyncService,
  AuthManager,
  ProfileManager,
  ProfileSyncService,
  ProfileSettingsSyncService,
  ProviderCredentialSyncService,
  SimklSyncService,
  PluginSyncService,
  CollectionSyncService,
  HomeCatalogSettingsSyncService,
  LibrarySyncService,
  SavedLibrarySyncService,
  WatchedItemsSyncService,
  WatchProgressSyncService,
  addonRepository,
  LocalStore,
  SessionStore,
  notifySyncPullCompleted
} = await import("../js/core/profile/startupSyncService.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { SupabaseApi } = await import("../js/data/remote/supabase/supabaseApi.js");
const { WatchProgressStore } = await import("../js/data/local/watchProgressStore.js");
const { Router } = await import("../js/ui/navigation/routerState.js");
const { createHomeScreenMethods04 } =
  await import("../js/ui/screens/home/homeScreenMethods-04-get-hero-focus-delay.js");

AuthManager.state = AuthState.AUTHENTICATED;
SessionStore.accessToken = `x.${Buffer.from(JSON.stringify({ sub: "lifecycle-fixture", exp: Date.now() / 1000 + 3600 })).toString("base64url")}.x`;
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) =>
  nativeSetTimeout(callback, delay === 3000 ? 0 : delay, ...args);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const service = () => ({
  ...StartupSyncService,
  started: true,
  profileScopedSyncEnabled: true,
  runGeneration: StartupSyncService.runGeneration + 1
});

// Both profiles must reach the server when their playback saves overlap.
const originalRpc = SupabaseApi.rpc;
const originalProgressPush = WatchProgressSyncService.push;
const firstPush = deferred();
const pushedProfiles = [];
SupabaseApi.rpc = async (name, payload) => {
  assert.equal(name, "sync_push_watch_progress");
  pushedProfiles.push(payload.p_profile_id);
  if (payload.p_profile_id === 1) await firstPush.promise;
  return [];
};
for (const id of [1, 2]) {
  WatchProgressStore.replaceForProfile(id, [
    { contentId: `tt-profile-${id}`, positionMs: 60000, durationMs: 600000, updatedAt: Date.now() }
  ]);
}
const push1 = WatchProgressSyncService.push(1);
await flush();
const push2 = WatchProgressSyncService.push(2);
await flush();
assert.deepEqual(
  pushedProfiles,
  [1, 2],
  "An in-flight profile 1 push must not swallow profile 2's save"
);
firstPush.resolve();
assert.deepEqual(await Promise.all([push1, push2]), [true, true]);
SupabaseApi.rpc = originalRpc;

// Authentication must read the account's real profiles before skipping its picker.
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const selectionSource = app.slice(
  app.indexOf("async function shouldShowProfileSelection()"),
  app.indexOf("async function enterWithLastProfile")
);
let remoteProfilesRead = false;
const selectionManager = {
  getProfiles: async () => (remoteProfilesRead ? [{ id: "1" }, { id: "2" }] : [{ id: "1" }]),
  getActiveProfileId: () => "1",
  isRememberLastProfileEnabled: () => false
};
const chooseProfiles = new Function(
  "ProfileManager",
  "ProfileSyncService",
  "hasSelectedProfileThisSession",
  `return (${selectionSource.trim()});`
)(
  selectionManager,
  {
    pull: async () => {
      remoteProfilesRead = true;
    },
    pullProfileLockStates: async () => ({})
  },
  false
);
assert.equal(
  (await chooseProfiles()).show,
  true,
  "A first login with two remote profiles must show the picker"
);

await ProfileManager.setActiveProfile("1");
LocalStore.set("startupSyncState", {
  "lifecycle-fixture:p1": {
    lastFullPullAtMs: Date.now(),
    lastFullPullIncludedProfileSettings: true
  }
});
const warm = service();
const warmPull = deferred();
warm.syncPull = () => warmPull.promise;
const warmRequest = warm.requestSyncNow({ force: false });
await flush();
assert.ok(
  warm.getCurrentProfilePullPromise(),
  "A warm restart exposes its pull to Home's Continue Watching loader"
);
warmPull.resolve(true);
assert.equal(await warmRequest, true);
assert.equal(warm.lastPullCompleted, true);

let retriedPulls = 0;
const retryChanges = service();
retryChanges.syncPull = async () => {
  retryChanges.lastPullChangedHomeInputs = ++retriedPulls === 1;
  return retriedPulls > 1;
};
assert.equal(await retryChanges.requestSyncNow(), true);
assert.equal(
  retryChanges.lastPullChangedHomeInputs,
  true,
  "A retry must preserve Home changes already applied by an earlier attempt"
);

const failedChanges = service();
failedChanges.syncPull = async () => {
  failedChanges.lastPullChangedHomeInputs = true;
  return false;
};
const failureNotifications = [];
const unsubscribeFailure = StartupSyncService.subscribeToPullCompleted((event) =>
  failureNotifications.push(event)
);
assert.equal(await failedChanges.requestSyncNow({ notifyPullCompleted: true }), false);
unsubscribeFailure();
assert.equal(failureNotifications.length, 1);
assert.equal(
  failureNotifications[0].changedHomeInputs,
  true,
  "A failed write still publishes data already applied by the pull"
);
assert.equal(failureNotifications[0].succeeded, false);

// Changing profile during a pull waits for a pull of the selected profile,
// rather than completing Home with the previous profile's promise.
const switching = service();
const oldProfilePull = deferred();
const pulledProfiles = [];
switching.syncPull = async ({ profileId }) => {
  pulledProfiles.push(profileId);
  if (profileId === "1") await oldProfilePull.promise;
  return true;
};
const oldRequest = switching.requestSyncNow({ force: false });
await flush();
await ProfileManager.setActiveProfile("2");
const newRequest = switching.requestSyncNow();
await flush();
assert.deepEqual(pulledProfiles, ["1"]);
oldProfilePull.resolve();
assert.deepEqual(await Promise.all([oldRequest, newRequest]), [false, true]);
assert.deepEqual(pulledProfiles, ["1", "2"]);
assert.equal(switching.lastPulledKey, "lifecycle-fixture:p2");

// An expired session's late completion cannot reset the replacement run.
const restarting = service();
const obsoletePull = deferred();
restarting.syncPull = () => obsoletePull.promise;
const obsoleteRequest = restarting.requestSyncNow();
await flush();
await restarting.stop();
restarting.started = true;
restarting.profileScopedSyncEnabled = true;
restarting.runGeneration++;
restarting.lastPullCompleted = true;
restarting.inFlight = true;
const replacementRequest = Promise.resolve(true);
restarting.inFlightPromise = replacementRequest;
obsoletePull.resolve(true);
assert.equal(await obsoleteRequest, false);
assert.equal(restarting.lastPullCompleted, true);
assert.equal(restarting.inFlightPromise, replacementRequest);
assert.equal(restarting.inFlight, true);

const cancelledBeforeStart = service();
let cancelledPulls = 0;
cancelledBeforeStart.syncPull = async () => {
  cancelledPulls++;
  return true;
};
const cancelledRequest = cancelledBeforeStart.requestSyncNow();
void cancelledBeforeStart.stop();
cancelledBeforeStart.started = true;
cancelledBeforeStart.runGeneration++;
cancelledBeforeStart.lastPullCompleted = true;
assert.equal(await cancelledRequest, false);
assert.equal(
  cancelledBeforeStart.lastPullCompleted,
  true,
  "A cancelled queued microtask cannot reset the replacement run"
);
assert.equal(cancelledPulls, 0);

const originals = [];
function replace(owner, name, value) {
  originals.push([owner, name, owner[name]]);
  owner[name] = value;
}
replace(ProfileSyncService, "pull", async () => []);
replace(ProfileSyncService, "getLastPullStatus", () => "ok");
replace(ProfileSettingsSyncService, "pull", async () => false);
replace(ProfileSettingsSyncService, "getHomeInputSignature", () => "fixture-settings");
replace(ProviderCredentialSyncService, "syncFromRemote", async () => false);
replace(SimklSyncService, "refresh", async () => false);
replace(PluginSyncService, "pull", async () => false);
replace(CollectionSyncService, "pull", async () => false);
replace(CollectionSyncService, "getLastPullFailed", () => false);
replace(HomeCatalogSettingsSyncService, "pull", async () => false);
replace(HomeCatalogSettingsSyncService, "getLastPullFailed", () => false);
replace(LibrarySyncService, "pull", async () => false);
replace(LibrarySyncService, "getLastPullStatus", () => ({ state: "ok" }));
replace(SavedLibrarySyncService, "pull", async () => false);
replace(addonRepository, "getInstalledAddonUrls", () => []);
let watchedStatus = "ok";
let progressStatus = "error";
let progressReads = 0;
replace(WatchedItemsSyncService, "pull", async () => []);
replace(WatchedItemsSyncService, "getLastPullStatus", () => watchedStatus);
replace(WatchedItemsSyncService, "getLastPullHadUnsynced", () => false);
replace(WatchProgressSyncService, "pull", async () => {
  progressReads++;
  return [];
});
replace(WatchProgressSyncService, "getLastPullStatus", () => progressStatus);
replace(WatchProgressSyncService, "getLastPullHadUnsynced", () => false);
const failing = service();
assert.equal(
  await failing.requestSyncNow(),
  false,
  "An absorbed progress error must not become a successful startup"
);
assert.equal(progressReads, 3, "Transient progress failures receive the bounded startup retries");
assert.equal(failing.lastPullCompleted, false);
assert.equal(
  await service().requestWatchStateSyncNow(),
  false,
  "Foreground sync must also report an absorbed error"
);
watchedStatus = "error";
progressStatus = "ok";
progressReads = 0;
assert.equal(await service().requestWatchStateSyncNow(), false);
assert.equal(progressReads, 1, "A history failure must not suppress an independent progress read");
watchedStatus = "skipped";
progressStatus = "skipped";
assert.equal(
  await service().requestWatchStateSyncNow(),
  true,
  "Trakt-owned history may intentionally skip account progress sync"
);

const restoredWrites = [];
watchedStatus = "ok";
progressStatus = "ok";
replace(WatchedItemsSyncService, "getLastPullHadUnsynced", () => true);
replace(WatchProgressSyncService, "getLastPullHadUnsynced", () => true);
replace(WatchedItemsSyncService, "push", async (id) => {
  restoredWrites.push(["history", id]);
  return true;
});
replace(WatchProgressSyncService, "push", async (id) => {
  restoredWrites.push(["progress", id]);
  return true;
});
assert.equal(await service().requestSyncNow(), true);
assert.deepEqual(
  restoredWrites,
  [
    ["history", "2"],
    ["progress", "2"]
  ],
  "A restart immediately retries local writes identified by the successful pull"
);
restoredWrites.length = 0;
watchedStatus = "skipped";
progressStatus = "skipped";
assert.equal(await service().requestSyncNow(), true);
assert.deepEqual(
  restoredWrites,
  [],
  "A provider-owned skipped pull cannot push an account snapshot"
);
replace(WatchProgressSyncService, "getLastPullHadUnsynced", () => false);

// A delayed old-profile foreground pull must not push or refresh the new one.
await ProfileManager.setActiveProfile("1");
const staleWatchedPull = deferred();
const watchCalls = [];
replace(WatchedItemsSyncService, "pull", async (id) => {
  watchCalls.push(["history", id]);
  if (id === "1") await staleWatchedPull.promise;
});
replace(WatchedItemsSyncService, "getLastPullStatus", () => "ok");
replace(WatchedItemsSyncService, "getLastPullHadUnsynced", () => true);
replace(WatchedItemsSyncService, "push", async (id) => {
  watchCalls.push(["push", id]);
  return true;
});
replace(WatchProgressSyncService, "pull", async (id) => {
  watchCalls.push(["progress", id]);
});
replace(WatchProgressSyncService, "getLastPullStatus", () => "ok");
const watching = service();
const oldWatch = watching.requestWatchStateSyncNow();
await flush();
await ProfileManager.setActiveProfile("2");
const newWatch = watching.requestWatchStateSyncNow();
staleWatchedPull.resolve();
assert.deepEqual(await Promise.all([oldWatch, newWatch]), [false, true]);
assert.deepEqual(watchCalls, [
  ["history", "1"],
  ["history", "2"],
  ["push", "2"],
  ["progress", "2"]
]);

// Use the real progress writer to prove that a 503 is reported as incomplete,
// preserves the persisted snapshot and remains retryable after its cooldown.
replace(WatchedItemsSyncService, "getLastPullHadUnsynced", () => false);
replace(WatchProgressSyncService, "getLastPullHadUnsynced", () => true);
replace(WatchProgressSyncService, "push", originalProgressPush);
WatchProgressStore.replaceForProfile("2", [
  { contentId: "tt-retry-503", positionMs: 120000, durationMs: 600000, updatedAt: Date.now() }
]);
const beforeFailure = WatchProgressStore.listForProfile("2");
let failedWrites = 0;
SupabaseApi.rpc = async () => {
  failedWrites++;
  throw Object.assign(new Error("Fixture unavailable"), { status: 503 });
};
const originalWarn = console.warn;
console.warn = () => {};
try {
  assert.equal(
    await service().requestWatchStateSyncNow(),
    false,
    "Foreground sync cannot report success after a 503 write"
  );
} finally {
  console.warn = originalWarn;
}
assert.equal(failedWrites, 1);
assert.deepEqual(WatchProgressStore.listForProfile("2"), beforeFailure);
const nativeNow = Date.now;
Date.now = () => nativeNow() + 120001;
SupabaseApi.rpc = async () => [];
try {
  assert.equal(
    await service().requestWatchStateSyncNow(),
    true,
    "The preserved write succeeds on the next eligible retry"
  );
} finally {
  Date.now = nativeNow;
  SupabaseApi.rpc = originalRpc;
}

// Home consumes actual sync notifications only for the visible profile.
let currentRoute = "home";
replace(Router, "getCurrent", () => currentRoute);
const refreshed = [];
const home = {
  ...createHomeScreenMethods04(),
  refreshHomeContinueWatchingAfterSync: async () => {
    refreshed.push("progress");
  },
  requestHomeBackgroundRefresh: async () => {
    refreshed.push("home");
  }
};
home.ensureStartupSyncSubscription();
notifySyncPullCompleted({ profileId: "2", source: "watch-state", changedHomeInputs: true });
notifySyncPullCompleted({ profileId: "1", source: "watch-state", changedHomeInputs: true });
currentRoute = "player";
notifySyncPullCompleted({ profileId: "2", source: "watch-state", changedHomeInputs: true });
assert.deepEqual(refreshed, ["progress"]);
home.unsubscribeStartupSyncPullCompleted();

for (const [owner, name, value] of originals.reverse()) owner[name] = value;
globalThis.setTimeout = nativeSetTimeout;
console.log(
  "PASS: remote profile selection, warm restart, stale session/profile guards, progress error retries, concurrent profile writes and Home sync notifications."
);
