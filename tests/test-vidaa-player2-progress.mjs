// Lot P, P2: progress, resume and scrobble of the new VIDAA player (playerProgress.js) against
// the old player's builders and mocked repositories. Desktop logic only; no TV measure.
import assert from "node:assert/strict";
import { PlayerController } from "../js/core/player/playerController.js";
import { TrackingScrobbleService } from "../js/data/repository/trackingScrobbleService.js";
import { MediaServerScrobbleService } from "../js/data/mediaserver/mediaServerScrobbleService.js";
import { WatchJournal } from "../js/core/perso/watchJournal.js";
import { watchedItemsRepository } from "../js/data/repository/watchedItemsRepository.js";
import { watchProgressRepository } from "../js/data/repository/watchProgressRepository.js";
import { createPlayerScreenMethods06 } from "../js/ui/screens/player/playerScreenMethods-06-handle-post-play-key.js";
import { createPlayerScreenMethods07 } from "../js/ui/screens/player/playerScreenMethods-07-build-subtitle-lookup-context.js";
import {
  buildPendingPlaybackRestore,
  buildProgressContext,
  buildScrobbleContext,
  createPlaybackProgress,
  restoreStartOptions
} from "../js/ui/tv2/player/playerProgress.js";

const PARAMS = {
  itemId: "tt0903747",
  itemType: "series",
  imdbId: "tt0903747",
  tmdbId: "1396",
  videoId: "tt0903747:2:3",
  season: 2,
  episode: 3,
  playerTitle: "Show",
  playerSubtitle: "S2E3",
  episodeTitle: "Episode",
  poster: "poster.jpg",
  playerBackdropUrl: "backdrop.jpg",
  playerReleaseYear: 2008
};
const STREAM = {
  id: "s1",
  addonName: "Addon",
  infoHash: "a".repeat(40),
  fileIdx: 1,
  behaviorHints: { filename: "Show.S02E03.mkv", bingeGroup: "g" }
};

// 1. Same progress record as PlayerController.play(url, buildPlaybackContext) then
// createProgressContext; same scrobble context as the old screen.
{
  const methods06 = createPlayerScreenMethods06();
  const oldScreen = Object.assign(Object.create(methods06), {
    params: PARAMS,
    getCurrentStreamRequestHeaders: () => ({}),
    resolvePlaybackMediaSourceType: () => null
  });
  // Field copy of playerControllerMethods-18 play().
  const controller = {};
  for (const params of [
    PARAMS,
    { itemId: "tt1", itemType: "movie", videoId: "x", playerTitle: "M" }
  ]) {
    oldScreen.params = params;
    const ctxOld = oldScreen.buildPlaybackContext(STREAM);
    Object.assign(controller, {
      currentItemId: ctxOld.itemId,
      currentItemType: ctxOld.itemType,
      currentImdbId: ctxOld.imdbId || null,
      currentTmdbId: ctxOld.tmdbId || null,
      currentTraktId: ctxOld.traktId || null,
      currentCloudSessionToken: String(ctxOld.cloudSessionToken || "").trim() || null,
      currentVideoId: ctxOld.videoId,
      currentSeason: ctxOld.season == null ? null : Number(ctxOld.season),
      currentEpisode: ctxOld.episode == null ? null : Number(ctxOld.episode),
      currentItemTitle: ctxOld.title || null,
      currentItemPoster: ctxOld.poster || null,
      currentItemBackground: ctxOld.background || null,
      currentEpisodeTitle: ctxOld.episodeTitle || null,
      currentStreamIdentity: ctxOld.streamIdentity || null,
      watchProgressSession: null
    });
    const expected = PlayerController.createProgressContext.call(controller);
    const actual = buildProgressContext(params, STREAM);
    assert.ok(actual.progressSession.completedKeys instanceof Set);
    delete expected.progressSession;
    delete actual.progressSession;
    assert.deepEqual(actual, expected, `progress record (${params.itemType})`);
  }

  const methods07 = createPlayerScreenMethods07();
  const scrobbleScreen = Object.assign(Object.create(methods07), {
    params: PARAMS,
    getPlaybackCurrentSeconds: () => 1200,
    getPlaybackDurationSeconds: () => 2400,
    getCurrentStreamCandidate: () => STREAM
  });
  assert.deepEqual(
    buildScrobbleContext(PARAMS, STREAM, 1200, 2400),
    scrobbleScreen.buildScrobbleContext()
  );
}

// 2. Route resume: position, else percent of the real duration, none with startFromBeginning.
{
  assert.deepEqual(
    restoreStartOptions(buildPendingPlaybackRestore({ resumePositionMs: 3600000 })),
    {
      startAt: 3600
    }
  );
  assert.deepEqual(
    restoreStartOptions(
      buildPendingPlaybackRestore({ resumeProgressPercent: 40, resumeDurationMs: 1000000 })
    ),
    { startAt: 400, startPercent: 40 }
  );
  assert.deepEqual(
    restoreStartOptions(
      buildPendingPlaybackRestore({ resumePositionMs: 5000, startFromBeginning: true })
    ),
    {}
  );
}

// Mocks: every save, scrobble and journal call is recorded, nothing leaves the process.
const calls = [];
const record =
  (name) =>
  (...args) => (calls.push([name, ...args]), Promise.resolve(true));
let scrobbleEnabled = true;
TrackingScrobbleService.isEnabled = () => scrobbleEnabled;
for (const name of ["start", "pause", "stop", "cancel"])
  TrackingScrobbleService[name] = record(`scrobble.${name}`);
MediaServerScrobbleService.update = record("server.update");
WatchJournal.tick = record("journal.tick");
WatchJournal.finish = record("journal.finish");
PlayerController.pushProgressIfDue = record("push");
watchedItemsRepository.mark = record("mark");
watchProgressRepository.saveProgress = record("save");
watchProgressRepository.removeProgress = record("remove");
const realFlush = PlayerController.flushProgress;

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type });
  }
  count() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

function setup({ played = true, presenting = true } = {}) {
  calls.length = 0;
  let now = 0;
  let timer = null;
  const video = Object.assign(new FakeTarget(), { paused: false, ended: false, seeking: false });
  const document = Object.assign(new FakeTarget(), { visibilityState: "visible", hidden: false });
  const root = Object.assign(new FakeTarget(), {
    document,
    performance: { now: () => now },
    setTimeout: (fn, ms) => ((timer = { fn, ms }), 1),
    clearTimeout: () => (timer = null)
  });
  const state = { position: 0, duration: 2400, played, presenting, fatal: false, paused: 0 };
  const context = buildProgressContext(PARAMS, STREAM);
  const progress = createPlaybackProgress(
    video,
    {
      context: () => context,
      scrobbleContext: () => buildScrobbleContext(PARAMS, STREAM, state.position, state.duration),
      played: () => state.played,
      presenting: () => state.presenting,
      fatal: () => state.fatal,
      currentSeconds: () => state.position,
      durationSeconds: () => state.duration,
      pause: () => (state.paused += 1),
      journal: () => ({ run: true })
    },
    { root }
  );
  const flushes = [];
  PlayerController.flushProgress = function (position, duration, clear, ctx, options) {
    flushes.push({ position, duration, clear, ctx, options });
    return realFlush.call(this, position, duration, clear, ctx, options);
  };
  return {
    video,
    root,
    document,
    state,
    context,
    progress,
    flushes,
    advance: (ms) => (now += ms),
    runTimer: () => {
      const pending = timer;
      timer = null;
      pending?.fn();
      return pending;
    }
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const names = () => calls.map(([name]) => name);

// 3. Nothing is saved or scrobbled for a source that never showed an image.
{
  const { video, progress, flushes, state } = setup({ played: false, presenting: false });
  state.position = 10;
  video.emit("timeupdate");
  video.emit("waiting");
  progress.exit();
  await settle();
  assert.equal(flushes.length, 0, "no save before the first image");
  assert.deepEqual(names(), ["journal.finish", "scrobble.cancel"]);
}

// 4. Checkpoints by position: 90 s while playing, 5 s on waiting; local only, no cloud push.
{
  const { video, flushes, state, advance } = setup();
  state.position = 30;
  video.emit("playing");
  assert.deepEqual(names(), ["scrobble.start"]);
  video.emit("timeupdate");
  state.position = 100;
  advance(1000);
  video.emit("timeupdate");
  assert.equal(flushes.length, 1, "first checkpoint once 90 s are reached");
  assert.deepEqual(flushes[0].options, { allowCloudSync: false, syncRemote: false });
  state.position = 150;
  video.emit("timeupdate");
  assert.equal(flushes.length, 1, "under 90 s since the last save");
  video.emit("waiting");
  assert.equal(flushes.length, 2, "waiting saves at 5 s");
  video.emit("waiting");
  assert.equal(flushes.length, 2, "same position: no second save");
  assert.ok(names().includes("server.update") && names().includes("journal.tick"));
  assert.ok(!names().includes("scrobble.pause"), "a buffering wait is not a user pause");
  await settle();
  assert.ok(!names().includes("push"));
}

// 5. A user pause: scrobble pause and a save with a cloud push; a decoder pause is ignored;
// the resume sends start again and a local save.
{
  const { video, flushes, state } = setup();
  state.position = 1200;
  video.paused = false;
  video.emit("pause");
  assert.equal(flushes.length, 0, "decoder pause while buffering (video.paused false)");
  video.paused = true;
  video.emit("pause");
  assert.ok(names().includes("scrobble.pause"));
  assert.deepEqual(flushes[0].options, { allowCloudSync: false, syncRemote: true });
  await settle();
  assert.ok(names().includes("push"), "cloud push after a pause");
  calls.length = 0;
  video.paused = false;
  video.emit("playing");
  assert.deepEqual(names().slice(0, 1), ["scrobble.start"]);
  assert.deepEqual(flushes.at(-1).options, { allowCloudSync: false, syncRemote: false });
}

// 6. A same-link reload (no image yet) pauses without a scrobble pause.
{
  const { video, state, flushes } = setup({ presenting: false });
  state.position = 500;
  video.paused = true;
  video.emit("pause");
  assert.equal(flushes.length, 0);
  assert.ok(!names().includes("scrobble.pause"));
}

// 7. Seek: one synced save 700 ms later, not for the resume seek before the first image.
{
  const { video, flushes, runTimer, state } = setup();
  state.position = 600;
  video.emit("seeked");
  assert.equal(runTimer()?.ms, 700);
  assert.deepEqual(flushes[0].options, { allowCloudSync: false, syncRemote: true });
  state.presenting = false;
  video.emit("seeked");
  assert.equal(runTimer(), null, "no sync for the resume seek");
}

// 8. Hide, pagehide and app exit save with a cloud push, then pause.
{
  const { root, document, state, flushes } = setup();
  state.position = 900;
  document.emit("visibilitychange");
  assert.equal(flushes.length, 0, "visible: nothing");
  document.visibilityState = "hidden";
  document.emit("visibilitychange");
  assert.equal(state.paused, 1);
  assert.deepEqual(flushes[0].options, { allowCloudSync: false, syncRemote: true });
  state.position = 905;
  document.emit("nuvio:beforeExitApp");
  root.emit("pagehide");
  assert.equal(state.paused, 3);
  assert.equal(flushes.length, 2, "same position saved once");
}

// 9. Natural end at 90 %: scrobble stop, completion marked without a tracking write, once.
{
  const { video, state, flushes, context } = setup();
  state.position = 2400;
  video.ended = true;
  video.emit("ended");
  await settle();
  await settle();
  assert.ok(names().includes("scrobble.stop") && !names().includes("scrobble.cancel"));
  const mark = calls.find(([name]) => name === "mark");
  assert.equal(mark[1].contentId, PARAMS.itemId);
  assert.deepEqual(mark[2], { skipTrackingWrite: true });
  assert.equal(calls.find(([name]) => name === "save")[1].positionMs, 2400000);
  assert.equal(context.progressSession.completedKeys.size, 1);
  assert.deepEqual(flushes[0].options, {});
  const marks = calls.filter(([name]) => name === "mark").length;
  await PlayerController.flushProgress(2400000, 2400000, false, context);
  assert.equal(calls.filter(([name]) => name === "mark").length, marks, "completion latched");
}

// 10. An end after a fatal error or before any image is not a completion: cancel, no stop.
{
  const { video, state } = setup();
  state.fatal = true;
  video.emit("ended");
  assert.ok(names().includes("scrobble.cancel") && !names().includes("scrobble.stop"));
}

// 11. Leaving mid-play: save with a cloud push, journal finish, then cancel only; once; and
// no listener left after destroy.
{
  const { video, progress, flushes, state, root, document } = setup();
  scrobbleEnabled = true;
  state.position = 1500;
  assert.equal(progress.exit(), true);
  assert.deepEqual(flushes[0].options, { allowCloudSync: false, syncRemote: true });
  assert.deepEqual(
    names().filter((name) => name !== "save"),
    ["journal.finish", "scrobble.cancel"]
  );
  assert.ok(!names().includes("scrobble.stop"), "leaving mid-play sends cancel only");
  assert.equal(progress.exit(), false, "once per mount");
  video.emit("timeupdate");
  assert.equal(flushes.length, 1, "no save after exit");
  progress.destroy();
  assert.equal(video.count() + root.count() + document.count(), 0);
}

// 12. Scrobble disabled: no provider call on playing or pause.
{
  scrobbleEnabled = false;
  const { video } = setup();
  video.emit("playing");
  video.paused = true;
  video.emit("pause");
  assert.ok(!names().some((name) => name === "scrobble.start" || name === "scrobble.pause"));
  scrobbleEnabled = true;
}

PlayerController.flushProgress = realFlush;
console.log(
  "PASS: new VIDAA player progress (old record shape, checkpoints, pause, seek, end, exit)"
);
