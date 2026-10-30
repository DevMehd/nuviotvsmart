// Lot P, P6: next episode and skip intro of the new VIDAA player (js/ui/tv2/player/playerNext.js)
// against a fake <video>, fake repositories and mocked timers: next episode resolution, card
// mark recomputed after a seek, autoplay policy, no autoplay after an error or a placeholder
// end, still watching, skip intro, prefetch once, and player -> player teardown.
import assert from "node:assert/strict";
import { mock } from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { createPlayerNext, resolveNextEpisode, cardTriggerSeconds, NEXT_COUNTDOWN_MS } =
  await import("../js/ui/tv2/player/playerNext.js");
const { PlayerSettingsStore } = await import("../js/data/local/playerSettingsStore.js");

mock.timers.enable({ apis: ["setTimeout"] });
const flushAsync = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const tick = async (ms) => {
  await flushAsync();
  mock.timers.tick(ms);
  await flushAsync();
};

class FakeVideo extends EventTarget {
  currentTime = 0;
  duration = NaN;
  paused = false;
  fire(type) {
    this.dispatchEvent(new Event(type));
  }
  at(seconds, type = "timeupdate") {
    this.currentTime = seconds;
    this.fire(type);
  }
}

const episodes = [
  { id: "tt1:1:1", season: 1, episode: 1, title: "One" },
  { id: "tt1:1:2", season: 1, episode: 2, title: "Two" },
  { id: "tt1:1:3", season: 1, episode: 3, title: "Three" }
];
const baseParams = {
  itemId: "tt1",
  itemType: "series",
  imdbId: "tt1",
  videoId: "tt1:1:1",
  season: 1,
  episode: 1,
  playerTitle: "Show",
  episodes
};
const stream = {
  id: "s2",
  url: "http://media.invalid/ep2.mkv",
  name: "Addon 4K",
  addonName: "Addon"
};

function fakeRepository({ result = [stream] } = {}) {
  const calls = [];
  const paused = [];
  return {
    calls,
    paused,
    setLocalPluginSearchPaused: (value) => paused.push(value),
    getStreamsFromAllAddons(type, videoId, options) {
      calls.push({ type, videoId, options });
      return Promise.resolve({
        status: "success",
        data: [{ addonName: "Addon", streams: result }]
      });
    }
  };
}

function setup({ params = baseParams, repository = fakeRepository(), skip = [], host = {} } = {}) {
  const video = new FakeVideo();
  const log = { navigate: [], seek: [], flush: 0, leave: 0, pause: 0 };
  const state = { firstFrame: true, fatal: false, osd: false, active: true };
  const next = createPlayerNext(
    video,
    {
      params,
      isActive: () => state.active,
      firstFrame: () => state.firstFrame,
      fatal: () => state.fatal,
      osdVisible: () => state.osd,
      hideControls: () => {},
      currentStream: () => ({ id: "s1", name: "Addon 4K" }),
      seek: (seconds) => {
        log.seek.push(seconds);
        video.currentTime = seconds;
      },
      pause: () => {
        log.pause += 1;
        video.paused = true;
      },
      flush: async () => {
        log.flush += 1;
      },
      navigate: async (route, routeParams, options) => {
        log.navigate.push({ route, params: routeParams, options });
      },
      leave: () => {
        log.leave += 1;
        return true;
      },
      partyLocked: () => false,
      ...host
    },
    {
      repository,
      skipRepository: {
        getSkipIntervals: async () => skip,
        getMovieSkipIntervals: async () => skip
      },
      addons: { getInstalledAddons: async () => [{ name: "Addon" }] }
    }
  );
  video.duration = 3000;
  video.fire("loadedmetadata");
  next.onFirstFrame();
  return { video, next, log, state, repository };
}

const settings = (partial) => PlayerSettingsStore.set(partial);

// 1. Next episode: explicit id, then sequence; shuffle on without a pick means none; movies none.
{
  assert.equal(resolveNextEpisode(baseParams, episodes).videoId, "tt1:1:2");
  assert.equal(
    resolveNextEpisode({ ...baseParams, nextEpisodeVideoId: "tt1:1:3" }, episodes).videoId,
    "tt1:1:3"
  );
  assert.equal(
    resolveNextEpisode({ ...baseParams, videoId: "tt1:1:3", episode: 3 }, episodes),
    null
  );
  assert.equal(resolveNextEpisode(baseParams, episodes, { shuffle: true }), null);
  assert.equal(resolveNextEpisode({ ...baseParams, itemType: "movie" }, episodes), null);
  const info = resolveNextEpisode(baseParams, episodes);
  assert.equal(info.episodeLabel, "S1E2");
  assert.equal(info.hasAired, true);
}

// 2. Card mark: the old rule's first true position (99 % by default, outro start when known).
{
  const mark = cardTriggerSeconds(3000, [], { nextEpisodeThresholdPercent: 99 });
  assert.ok(Math.abs(mark - 2970) <= 0.1, `mark ${mark}`);
  const outro = cardTriggerSeconds(3000, [{ type: "outro", startTime: 2800, endTime: 2998 }], {
    nextEpisodeThresholdPercent: 99
  });
  assert.ok(Math.abs(outro - 2800) <= 0.1, `outro mark ${outro}`);
  assert.equal(cardTriggerSeconds(0, [], {}), Infinity);
}

// 3. Plain MANUAL: the card shows at the mark, no prefetch, Back dismisses it, a seek back
//    starts the cycle over and the mark follows a new duration.
{
  settings({
    autoplayNextEpisode: false,
    streamAutoPlayMode: "MANUAL",
    streamAutoPlayPreferBingeGroupForNextEpisode: false
  });
  const { video, next, repository } = setup();
  await flushAsync();
  video.at(100);
  assert.equal(next.state.cardVisible, false);
  video.at(2971);
  assert.equal(next.state.cardVisible, true);
  assert.equal(repository.calls.length, 0, "no addon request in plain MANUAL");
  assert.equal(next.back(), true);
  assert.equal(next.state.cardVisible, false);
  video.at(2975);
  assert.equal(next.state.cardVisible, false, "dismissed stays dismissed");
  video.at(1000, "seeked");
  video.at(2972);
  assert.equal(next.state.cardVisible, true, "seek back resets the dismissal");
  video.duration = 4000;
  video.fire("durationchange");
  assert.ok(Math.abs(next.state.cardAt - 3960) <= 0.1, "mark recomputed");
  video.at(2972, "seeked");
  assert.equal(next.state.cardVisible, false);
  next.destroy();
}

// 4. MANUAL, OK on the card: the next episode's Sources screen, no player route.
{
  settings({
    autoplayNextEpisode: false,
    streamAutoPlayMode: "MANUAL",
    streamAutoPlayPreferBingeGroupForNextEpisode: false
  });
  const { video, next, log } = setup();
  video.at(2971);
  assert.equal(next.onKey(13, {}), true);
  await flushAsync();
  assert.equal(log.navigate.length, 1);
  assert.equal(log.navigate[0].route, "stream");
  assert.equal(log.navigate[0].params.videoId, "tt1:1:2");
  assert.equal(log.navigate[0].params.nextEpisodeVideoId, "tt1:1:3");
  next.destroy();
}

// 5. Autoplay: prefetch once in the last minute, then at the mark the policy source, a 3 s
//    countdown, flush, and the player route with the count and replaceHistory.
{
  settings({
    autoplayNextEpisode: true,
    streamAutoPlayMode: "MANUAL",
    stillWatchingEnabled: false
  });
  const repository = fakeRepository();
  const { video, next, log } = setup({
    params: { ...baseParams, consecutiveAutoPlayCount: 1 },
    repository
  });
  video.at(2900);
  assert.equal(repository.calls.length, 0);
  video.at(2915);
  assert.equal(repository.calls.length, 1, "prefetch in the last minute");
  video.at(2916);
  await flushAsync();
  assert.equal(repository.calls.length, 1, "prefetch once");
  video.at(2971);
  await flushAsync();
  assert.equal(next.state.launch?.phase, "countdown");
  assert.equal(repository.calls.length, 1, "the prefetched list is reused");
  assert.equal(log.navigate.length, 0);
  await tick(NEXT_COUNTDOWN_MS);
  assert.equal(log.flush, 1);
  assert.equal(log.navigate.length, 1);
  const { route, params, options } = log.navigate[0];
  assert.equal(route, "player");
  assert.equal(params.videoId, "tt1:1:2");
  assert.equal(params.preferredStreamId, "s2");
  assert.equal(params.streamUrl, stream.url);
  assert.equal(params.consecutiveAutoPlayCount, 2);
  assert.equal(params.nextEpisodeVideoId, "tt1:1:3");
  assert.deepEqual(options, { replaceHistory: true });
  next.destroy();
}

// 6. player -> player: destroying during the countdown drops the launch, its timer and the
//    listeners; a new object on the same video starts clean.
{
  settings({ autoplayNextEpisode: true, streamAutoPlayMode: "MANUAL" });
  const { video, next, log, repository } = setup();
  video.at(2971);
  await flushAsync();
  assert.equal(next.state.launch?.phase, "countdown");
  assert.equal(next.state.timer, true);
  next.destroy();
  assert.equal(next.state.launch, null);
  assert.equal(next.state.timer, false);
  assert.equal(repository.paused.at(-1), true, "local plugin search paused again");
  await tick(NEXT_COUNTDOWN_MS);
  assert.equal(log.navigate.length, 0, "no navigation after destroy");
  video.at(2980);
  assert.equal(log.navigate.length, 0, "listeners removed");
}

// 7. No autoplay after an error or a placeholder end; a natural end without autoplay leaves.
{
  settings({ autoplayNextEpisode: true, streamAutoPlayMode: "MANUAL" });
  const errored = setup();
  errored.state.fatal = true;
  errored.video.at(2971);
  errored.video.currentTime = 3000;
  errored.video.fire("ended");
  await tick(NEXT_COUNTDOWN_MS);
  assert.equal(errored.next.state.launch, null);
  assert.equal(errored.log.navigate.length, 0);
  assert.equal(errored.log.leave, 0, "an error end does not leave");
  errored.next.destroy();

  const placeholder = setup();
  placeholder.video.duration = 30;
  placeholder.video.fire("durationchange");
  placeholder.video.at(30);
  placeholder.video.fire("ended");
  await tick(NEXT_COUNTDOWN_MS);
  assert.equal(placeholder.log.navigate.length, 0);
  assert.equal(placeholder.log.leave, 0);
  placeholder.next.destroy();

  // An error during the countdown drops the launch.
  const late = setup();
  late.video.at(2971);
  await flushAsync();
  assert.equal(late.next.state.launch?.phase, "countdown");
  late.state.fatal = true;
  await tick(NEXT_COUNTDOWN_MS);
  assert.equal(late.log.navigate.length, 0);
  late.next.destroy();

  settings({ autoplayNextEpisode: false });
  const ended = setup();
  ended.video.at(3000);
  ended.video.paused = true;
  ended.video.fire("ended");
  await flushAsync();
  assert.equal(ended.log.leave, 1, "natural end without autoplay: Detail");
  ended.next.destroy();
}

// 8. Autoplay without a source while the episode plays: the card stays, no Sources screen.
{
  settings({ autoplayNextEpisode: true, streamAutoPlayMode: "MANUAL" });
  const { video, next, log } = setup({ repository: fakeRepository({ result: [] }) });
  video.at(2971);
  await flushAsync();
  await tick(0);
  assert.equal(next.state.launch, null);
  assert.equal(log.navigate.length, 0);
  assert.equal(next.state.cardVisible, true);
  next.destroy();
}

// 8b. The autoplay search outlives the episode (ended while searching) and finds nothing: the
//     next episode's Sources open, as on a natural end, instead of a card over the last image.
{
  settings({
    autoplayNextEpisode: true,
    streamAutoPlayMode: "MANUAL",
    stillWatchingEnabled: false
  });
  let answer;
  const repository = {
    ...fakeRepository(),
    getStreamsFromAllAddons: () => new Promise((resolve) => (answer = resolve))
  };
  const { video, next, log } = setup({ repository });
  video.at(2971);
  await flushAsync();
  assert.equal(next.state.launch?.phase, "searching");
  video.paused = true;
  video.ended = true;
  video.at(3000, "ended");
  await flushAsync();
  answer({ status: "success", data: [] });
  await flushAsync();
  assert.equal(next.state.launch, null);
  assert.equal(log.navigate.at(-1)?.route, "stream", "Sources of the next episode");
  next.destroy();
}

// 8c. A failed search is not kept: OK on the card asks the addons again.
{
  settings({ autoplayNextEpisode: false, streamAutoPlayMode: "FIRST_STREAM" });
  let calls = 0;
  const repository = {
    ...fakeRepository(),
    getStreamsFromAllAddons: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ status: "success", data: [{ addonName: "Addon", streams: [stream] }] });
    }
  };
  const { video, next } = setup({ repository });
  video.at(2915);
  await flushAsync();
  assert.equal(calls, 1, "prefetch failed");
  video.at(2971);
  next.onKey(13, {});
  await flushAsync();
  assert.equal(calls, 2, "searched again");
  assert.equal(next.state.launch?.phase, "countdown");
  next.destroy();
  settings({ streamAutoPlayMode: "MANUAL" });
}

// 9. Still watching after the threshold of automatic episodes: pause, then Exit leaves.
{
  settings({
    autoplayNextEpisode: true,
    streamAutoPlayMode: "MANUAL",
    stillWatchingEnabled: true,
    stillWatchingEpisodeThreshold: 2
  });
  const { video, next, log } = setup({ params: { ...baseParams, consecutiveAutoPlayCount: 2 } });
  video.at(2971);
  assert.equal(next.state.still, true);
  assert.equal(log.pause, 1);
  assert.equal(next.onKey(39, {}), true, "the prompt owns the keys");
  next.onKey(13, {});
  assert.equal(log.leave, 1);
  assert.equal(log.navigate.length, 0);
  next.destroy();
  settings({ stillWatchingEnabled: false });
}

// 10. Skip intro: shown inside the interval after the first image, OK seeks to its end, the
//     interval stays hidden while the seek settles; hidden while the OSD shows.
{
  settings({ autoplayNextEpisode: false, skipIntroEnabled: true, autoSkipSegmentTypes: [] });
  const { video, next, log, state } = setup({
    skip: [{ type: "intro", startTime: 30, endTime: 90 }]
  });
  await flushAsync();
  video.at(40);
  assert.equal(next.state.skipVisible, true);
  state.osd = true;
  assert.equal(next.state.skipVisible, false);
  assert.equal(next.onKey(13, {}), false, "OK goes to the OSD");
  state.osd = false;
  assert.equal(next.onKey(13, {}), true);
  assert.deepEqual(log.seek, [90]);
  video.at(45);
  assert.equal(next.state.skipVisible, false, "suppressed while the seek settles");
  next.destroy();
}

// 11. Auto-skip of the intro type seeks by itself, never before the first image.
{
  settings({ skipIntroEnabled: true, autoSkipSegmentTypes: ["intro"] });
  const { video, next, log } = setup({ skip: [{ type: "intro", startTime: 30, endTime: 90 }] });
  await flushAsync();
  video.at(31);
  assert.deepEqual(log.seek, [90]);
  next.destroy();
  settings({ autoSkipSegmentTypes: [] });
}

mock.timers.reset();
console.log("PASS: VIDAA player2 next episode and skip intro (P6)");
