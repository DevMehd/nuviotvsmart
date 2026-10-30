// Lot P, P1: "player" route facade, setting, screen contract, Back and the build chunk assertion.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const platform = process.env.NUVIO_P2_PLATFORM || "vidaa";
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = platform;
globalThis.location = { search: "" };
globalThis.document = {
  getElementById: () => null,
  documentElement: { classList: { contains: () => false } }
};

const { Router, PlayerScreen } = await import("../js/ui/navigation/router.js");
const { NewPlayerScreen } = await import("../js/ui/tv2/player/newPlayerScreen.js");
const setting = await import("../js/ui/tv2/newPlayerSetting.js");

if (platform !== "vidaa") {
  // Tizen, webOS and browser always keep the old player, whatever is stored.
  store.set("tvNewPlayer", JSON.stringify("on"));
  setting.resetSessionNewPlayerMode();
  assert.equal(setting.getNewPlayerMode(), "off");
  assert.equal(Router.routes.player, PlayerScreen);
  console.log(`PASS: ${platform} keeps the old player`);
  process.exit(0);
}

// 1. Facade: on by default on VIDAA (D1), "off" brings the old player back, read once per run (D2).
setting.resetSessionNewPlayerMode();
assert.equal(setting.getNewPlayerMode(), "on");
assert.equal(Router.routes.player, NewPlayerScreen);
setting.setNewPlayerMode("off");
assert.equal(Router.routes.player, NewPlayerScreen, "the change waits for the next launch");
setting.resetSessionNewPlayerMode();
assert.equal(Router.routes.player, PlayerScreen);
// The lazy build writes the loaded screen into the slot of the session mode only.
const loadedOld = { loaded: "old" };
Router.routes.player = loadedOld;
assert.equal(Router.routes.player, loadedOld);
setting.setNewPlayerMode("on");
setting.resetSessionNewPlayerMode();
assert.equal(Router.routes.player, NewPlayerScreen, "the other slot is untouched");
setting.resetSessionNewPlayerMode();
setting.setNewPlayerMode("off");
setting.resetSessionNewPlayerMode();
Router.routes.player = PlayerScreen;
setting.setNewPlayerMode("on");
setting.resetSessionNewPlayerMode();

// 2. Settings > Playback row action toggles the stored mode.
const { registerPlaybackActionsPart01 } =
  await import("../js/ui/screens/settings/settingsScreenPlaybackActions-01.js");
const settings = { actionMap: new Map(), openOptionDialog() {}, toggleExpandedSection() {} };
registerPlaybackActionsPart01.call(settings, {});
settings.actionMap.get("playback:newPlayer")();
assert.equal(setting.getNewPlayerMode(), "off");
settings.actionMap.get("playback:newPlayer")();
assert.equal(setting.getNewPlayerMode(), "on");

// 3. Contract: every member the Router, FocusEngine, the phone remote, Stream info and app.js
// read with ?. (rg on ec1c282f) exists on the new screen.
const methods = [
  "mount",
  "cleanup",
  "onKeyDown",
  "onKeyUp",
  "onPointerActivate",
  "onPointerFocus",
  "onPointerMove",
  "consumeBackRequest",
  "shouldReturnToStreamOnBack",
  "hasBackDismissableOverlay",
  "navigateBackToStreamScreen",
  "cancelSourceLoad",
  "getPlaybackCurrentSeconds",
  "getPlaybackDurationSeconds",
  "getPlaybackControlPaused",
  "getPlaybackSpeed",
  "seekPlaybackSeconds",
  "applyMediaAction",
  "renderControlButtons",
  "resolveNextEpisodeInfo",
  "playNextEpisode",
  "openSubtitleDialog",
  "closeSubtitleDialog",
  "getSubtitleEntries",
  "getAudioEntries",
  "applyAudioTrack",
  "openAudioDialog",
  "getCurrentStreamCandidate",
  "getCurrentStreamDisplayName"
];
for (const name of methods) assert.equal(typeof NewPlayerScreen[name], "function", name);
for (const field of ["params", "paused", "container", "subtitleDialogVisible"])
  assert.ok(field in NewPlayerScreen, field);
assert.equal(NewPlayerScreen.paused, false);
assert.deepEqual(NewPlayerScreen.getSubtitleEntries(), []);

// 4. Back: returns to the existing Sources entry with the position; a duplicate Back is "history".
const pops = [];
const navigations = [];
Router.popToExistingRoute = (route, params) => (pops.push([route, params]), true);
Router.navigate = async (route, params, options) => navigations.push([route, params, options]);
NewPlayerScreen.params = {
  itemId: "tt1",
  itemType: "movie",
  playerTitle: "Film",
  returnToStreamOnBack: true,
  streamRouteParams: { itemId: "tt1", itemType: "movie", startFromBeginning: true }
};
NewPlayerScreen.session = { currentSeconds: () => 42.5, teardown() {} };
NewPlayerScreen.playerBackNavigationInProgress = false;
assert.equal(NewPlayerScreen.hasBackDismissableOverlay(), false);
assert.equal(NewPlayerScreen.consumeBackRequest(), "history");
assert.equal(NewPlayerScreen.consumeBackRequest(), "history");
assert.equal(pops.length, 1, "one traversal for a doubled Back");
assert.equal(pops[0][0], "stream");
assert.equal(pops[0][1].resumePositionMs, 42500);
assert.equal(pops[0][1].startFromBeginning, false);
// Without a history entry: replace towards Home when asked.
Router.popToExistingRoute = () => false;
NewPlayerScreen.params = { itemId: "tt1", returnToHomeOnBack: true };
NewPlayerScreen.playerBackNavigationInProgress = false;
assert.equal(NewPlayerScreen.navigateBackToStreamScreen(), true);
assert.equal(navigations.at(-1)[0], "home");
assert.equal(navigations.at(-1)[2].replaceHistory, true);
NewPlayerScreen.session = null;
assert.doesNotThrow(() => NewPlayerScreen.cleanup(), "cleanup without a mount never throws");

// 4b. A resolution that never answers ends in an explicit error; its late answer is dropped.
{
  const { DirectDebridResolver } = await import("../js/core/debrid/directDebridResolver.js");
  const saved = {
    can: DirectDebridResolver.canResolveStream,
    resolve: DirectDebridResolver.resolve
  };
  let answer;
  DirectDebridResolver.canResolveStream = () => true;
  DirectDebridResolver.resolve = () => new Promise((resolve) => (answer = resolve));
  const attached = [];
  Router.current = "player";
  Object.assign(NewPlayerScreen, {
    params: {},
    refs: null,
    candidate: { infoHash: "abc" },
    resolveCapMs: 20,
    session: { attach: (url) => attached.push(url) }
  });
  await NewPlayerScreen.startCandidate(NewPlayerScreen.playerMountToken);
  assert.equal(NewPlayerScreen.resolveError?.kind, "timeout");
  assert.equal(NewPlayerScreen.resolveTimer, null);
  answer({ status: "success", stream: { url: "http://media.invalid/late.mkv" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(attached, [], "a late resolution never starts playback");
  Object.assign(DirectDebridResolver, { canResolveStream: saved.can, resolve: saved.resolve });
  NewPlayerScreen.resolveCapMs = 45000;
  NewPlayerScreen.session = null;
  NewPlayerScreen.resolveError = null;
  Router.current = null;
}

// 5. Initial source and resolution (no network: direct links only).
const { pickInitialCandidate, resolvePlayableCandidate } =
  await import("../js/ui/tv2/player/resolvePlayableCandidate.js");
const a = { id: "a", url: "http://media.invalid/a.mkv" };
const b = { id: "b", url: "http://media.invalid/b.mkv" };
assert.equal(pickInitialCandidate({ streamCandidates: [a, b], preferredStreamId: "b" }), b);
assert.equal(pickInitialCandidate({ streamCandidates: [a, b], streamUrl: b.url }), b);
assert.equal(pickInitialCandidate({ streamCandidates: [a, b] }), a);
assert.equal(pickInitialCandidate({ streamUrl: "http://media.invalid/c.mp4" }).isSynthetic, true);
assert.equal(pickInitialCandidate({}), null);
assert.deepEqual(await resolvePlayableCandidate(a), { url: a.url });
const headerBound = await resolvePlayableCandidate({
  url: "http://media.invalid/d.mkv",
  behaviorHints: {
    notWebReady: true,
    proxyHeaders: { request: { Referer: "http://addon.invalid/" } }
  }
});
assert.equal(headerBound.errorKey, "player_error_vidaa_standalone_unsupported");
const hls = await resolvePlayableCandidate({
  url: "http://media.invalid/live.m3u8",
  behaviorHints: { proxyHeaders: { request: { "X-Token": "t" } } }
});
// P5: HLS with headers plays through hls.js with the forwardable headers only.
assert.deepEqual(hls, { url: "http://media.invalid/live.m3u8", headers: { "X-Token": "t" } });
const expired = await resolvePlayableCandidate({
  url: "http://media.invalid/e.mkv?expires=1600000000"
});
assert.equal(expired.errorKey, "player_error_stream_expired");
assert.equal(
  (await resolvePlayableCandidate({ infoHash: "abc" })).errorKey,
  "player_error_playback_fallback"
);

// 6. Error text: localized, the HTTP status, never the link.
const { playerErrorMessage } = await import("../js/ui/tv2/player/newPlayerScreen.js");
assert.match(playerErrorMessage({ kind: "source", code: 4, httpStatus: 403 }), /^HTTP 403/);
assert.match(playerErrorMessage({ kind: "decode", code: 3 }), /decoder/);
assert.ok(!/invalid/.test(playerErrorMessage({ kind: "source", code: 4 })));

// 7. Build: the new player chunk must not pull the old player screen.
const { assertNewPlayerChunk } = await import("../scripts/build-vidaa-modules.mjs");
const entry = "js/ui/tv2/player/newPlayerScreen.js";
const clean = {
  "m/new.js": {
    entryPoint: entry,
    inputs: { [entry]: {} },
    imports: [{ path: "m/shared.js", kind: "import-statement" }]
  },
  "m/shared.js": { inputs: { "js/core/player/playerController.js": {} }, imports: [] }
};
assert.equal(assertNewPlayerChunk(clean), 2);
clean["m/shared.js"].inputs["js/ui/screens/player/playerScreenContext.js"] = {};
assert.throws(() => assertNewPlayerChunk(clean), /pulls the old player/);

// 8. Tizen keeps the old player (separate process: the platform adapter is cached).
for (const other of ["tizen", "webos"]) {
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, NUVIO_P2_PLATFORM: other },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

console.log("PASS: new VIDAA player facade, setting, contract, Back and chunk assertion");
