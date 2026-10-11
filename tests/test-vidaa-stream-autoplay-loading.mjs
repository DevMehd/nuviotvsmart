import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };
const {
  StreamScreen,
  Router,
  PlayerSettingsStore,
  streamRepository,
  watchProgressRepository,
  addonRepository
} = await import("../js/ui/screens/stream/streamScreen.js");
const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (callback) => {
  const id = ++timerId;
  timers.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.cancelAnimationFrame = () => {};
const navigations = [];
Router.getCurrent = () => "stream";
Router.navigate = (route, params) => navigations.push({ route, params });
streamRepository.setLocalPluginSearchPaused = () => {};
addonRepository.getCachedInstalledAddons = () => [{ name: "Source A" }, { name: "Source B" }];
let settings;
PlayerSettingsStore.get = () => settings;
const sources = [
  {
    id: "b",
    addonName: "Source B",
    addonOrderIndex: 1,
    name: "1080p",
    url: "https://fixture.invalid/b.mp4"
  },
  {
    id: "a",
    addonName: "Source A",
    addonOrderIndex: 0,
    name: "720p",
    url: "https://fixture.invalid/a.mp4"
  },
  {
    id: "4k",
    addonName: "Source B",
    addonOrderIndex: 1,
    name: "2160p",
    url: "https://fixture.invalid/4k.mp4"
  }
];
const tests = [];
const test = (name, run) => tests.push({ name, run });
async function settle() {
  for (let n = 0; n < 20; n++) await Promise.resolve();
}
async function mount(
  mode,
  { params = {}, navigation = {}, wait = 0, pattern = "2160p", scope = {} } = {}
) {
  settings = {
    streamAutoPlayMode: mode,
    streamAutoPlayRegex: pattern,
    streamAutoPlayTimeoutSeconds: wait,
    streamAutoPlaySource: "ALL_SOURCES",
    streamReuseLastLinkEnabled: false,
    streamAutoPlayPreferBingeGroupForNextEpisode: false,
    ...scope
  };
  const paints = [];
  const container = {
    style: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    set innerHTML(value) {
      this.markup = value;
      paints.push(value);
    }
  };
  document.getElementById = () => container;
  let manualRenders = 0;
  const ui = {
    ...StreamScreen,
    container,
    cancelAutoPlayCountdown() {},
    loadStreams() {},
    getBackdropUrl() {
      return this.params.backdrop || "";
    },
    requestRender() {
      this.render();
    },
    render() {
      if (this.autoPlayUiActive) StreamScreen.render.call(this);
      else manualRenders++;
    }
  };
  await ui.mount(
    {
      itemId: "film",
      itemType: "movie",
      itemTitle: "Film title",
      startFromBeginning: true,
      ...params
    },
    navigation
  );
  return {
    ui,
    container,
    paints,
    get manualRenders() {
      return manualRenders;
    }
  };
}
function complete(ui, streams = sources) {
  ui.streams = streams.slice();
  ui.loading = false;
  ui.streamSearchCompleted = true;
  ui._filteredStreamsCache = null;
  ui.render();
  ui.maybeAutoPlayStream({ allLoaded: true });
}
function assertNoPicker(paints) {
  assert.ok(paints.length);
  for (const markup of paints) {
    assert.ok(markup.includes("player-loading-overlay"));
    assert.ok(
      !/stream-route-(?:card|chip|list|content)/.test(markup),
      "No picker is painted, even temporarily"
    );
    assert.ok(
      !markup.includes("Trying the next source"),
      "Initial lookup is not an error fallback"
    );
  }
}

test("FIRST_STREAM paints only player loading and selects the first ordered source", async () => {
  const { ui, paints } = await mount("FIRST_STREAM");
  complete(ui);
  await settle();
  assertNoPicker(paints);
  assert.equal(navigations.at(-1).params.preferredStreamId, "a");
  assert.deepEqual(
    navigations.at(-1).params.streamCandidates.map((entry) => entry.id),
    ["a", "b", "4k"]
  );
});
test("REGEX_MATCH hides nonmatching partial results and selects a later matching source", async () => {
  const { ui, paints } = await mount("REGEX_MATCH");
  ui.streams = sources.slice(0, 2);
  ui.render();
  ui.maybeAutoPlayStream();
  assert.equal(navigations.length, 0);
  complete(ui);
  await settle();
  assertNoPicker(paints);
  assert.equal(navigations.at(-1).params.preferredStreamId, "4k");
});
test("selection timeout waits in loading without changing the chosen regex source", async () => {
  const { ui, paints } = await mount("REGEX_MATCH", { wait: 3 });
  ui.streams = sources.slice();
  ui.render();
  ui.maybeAutoPlayStream();
  assert.equal(navigations.length, 0);
  const timeout = timers.get(ui.autoPlaySelectionWaitTimer);
  timeout();
  await settle();
  assert.equal(navigations.at(-1).params.preferredStreamId, "4k");
  assertNoPicker(paints);
});
test("addon scope still controls automatic first-source selection", async () => {
  const { ui } = await mount("FIRST_STREAM", {
    scope: {
      streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
      streamAutoPlaySelectedAddons: ["Source B"]
    }
  });
  complete(ui);
  await settle();
  assert.equal(navigations.at(-1).params.preferredStreamId, "b");
});
test("no regex match settles with an error and reveals the list only after explicit OK", async () => {
  const result = await mount("REGEX_MATCH", { pattern: "Remux" });
  complete(result.ui);
  assert.equal(navigations.length, 0);
  assert.ok(result.ui.autoPlayUiError);
  assert.ok(result.container.markup.includes('data-action="chooseManualStream"'));
  assertNoPicker(result.paints);
  result.ui.onKeyDown({ keyCode: 13, preventDefault() {} });
  assert.equal(result.ui.autoPlayUiActive, false);
  assert.equal(result.ui.params.manualSelection, true);
  assert.equal(result.manualRenders, 1);
});
test("no sources settles the loading state without opening the picker", async () => {
  const { ui, paints } = await mount("FIRST_STREAM");
  complete(ui, []);
  assert.ok(ui.autoPlayUiError);
  assert.equal(navigations.length, 0);
  assertNoPicker(paints);
});
test("manual mode, explicit manual choice and return from player keep their normal picker", async () => {
  for (const [mode, options] of [
    ["MANUAL", {}],
    ["FIRST_STREAM", { params: { manualSelection: true } }],
    ["REGEX_MATCH", { navigation: { isBackNavigation: true, previousRoute: "player" } }]
  ]) {
    const result = await mount(mode, options);
    assert.equal(result.ui.autoPlayUiActive, false);
    assert.equal(result.paints.length, 0);
    assert.equal(result.manualRenders, 1);
  }
});
test("resume lookup stays behind loading and carries resume and episode metadata", async () => {
  let resolve;
  watchProgressRepository.getResumeByContentId = () =>
    new Promise((done) => {
      resolve = done;
    });
  const episode = { id: "film:1:2", season: 1, episode: 2 };
  const { ui, paints } = await mount("REGEX_MATCH", {
    params: {
      startFromBeginning: false,
      itemType: "series",
      videoId: episode.id,
      season: 1,
      episode: 2,
      episodes: [episode]
    }
  });
  complete(ui);
  ui.render();
  assert.equal(navigations.length, 0);
  assertNoPicker(paints);
  resolve({ positionMs: 120000, durationMs: 3600000 });
  await settle();
  assert.equal(navigations.at(-1).params.preferredStreamId, "4k");
  assert.equal(navigations.at(-1).params.resumePositionMs, 120000);
  assert.deepEqual(navigations.at(-1).params.episodes, [episode]);
});
test("back/cleanup cancels a pending resume so playback cannot open later", async () => {
  let resolve;
  watchProgressRepository.getResumeByContentId = () =>
    new Promise((done) => {
      resolve = done;
    });
  const { ui } = await mount("FIRST_STREAM", { params: { startFromBeginning: false } });
  complete(ui);
  ui.cleanup();
  resolve(null);
  await settle();
  assert.equal(navigations.length, 0);
});

let failures = 0;
for (const { name, run } of tests) {
  timers.clear();
  navigations.length = 0;
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}
assert.equal(failures, 0);
console.log(`${tests.length}/${tests.length} automatic stream loading cases passed.`);
