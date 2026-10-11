import assert from "node:assert/strict";

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
  {
    params = {},
    navigation = {},
    wait = 0,
    pattern = "2160p",
    scope = {},
    previousMarkup = ""
  } = {}
) {
  PlayerSettingsStore.set(
    {
      streamAutoPlayMode: mode,
      streamAutoPlayRegex: pattern,
      streamAutoPlayTimeoutSeconds: wait,
      streamAutoPlaySource: "ALL_SOURCES",
      streamReuseLastLinkEnabled: false,
      streamAutoPlayPreferBingeGroupForNextEpisode: false,
      streamAutoPlayReuseBingeGroup: false,
      streamAutoPlaySelectedAddons: [],
      streamAutoPlaySelectedPlugins: [],
      ...scope
    },
    { silentSync: true }
  );
  const paints = [];
  const exposures = [];
  const container = {
    style: {},
    markup: previousMarkup,
    querySelector: () => null,
    querySelectorAll: () => [],
    set innerHTML(value) {
      this.markup = value;
      paints.push(value);
    }
  };
  let display = "none";
  Object.defineProperty(container.style, "display", {
    get: () => display,
    set(value) {
      display = value;
      if (value === "block") exposures.push(container.markup);
    }
  });
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
      StreamScreen.render.call(this);
      if (!this.autoPlayUiActive) manualRenders++;
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
    exposures,
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
    assert.equal(result.paints.length, 1);
    assert.ok(result.paints[0].includes("stream-route-content"));
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

test("settings hydration enables FIRST_STREAM loading before publishing results", async () => {
  const result = await mount("MANUAL");
  const previousPaints = result.paints.length;
  PlayerSettingsStore.set({ streamAutoPlayMode: "FIRST_STREAM" }, { silentSync: true });
  complete(result.ui);
  await settle();
  assert.equal(result.ui.autoPlayUiActive, true);
  assert.equal(result.manualRenders, 1, "No second picker render follows the settings update");
  assertNoPicker(result.paints.slice(previousPaints));
  assert.equal(navigations.at(-1).params.preferredStreamId, "a");
});

test("a hydrated valid regex replaces its disabled picker with loading", async () => {
  const result = await mount("REGEX_MATCH", { pattern: "[" });
  assert.equal(result.ui.autoPlayUiActive, false);
  const previousPaints = result.paints.length;
  PlayerSettingsStore.set({ streamAutoPlayRegex: "2160p" }, { silentSync: true });
  complete(result.ui);
  await settle();
  assert.equal(result.ui.autoPlayUiActive, true);
  assert.equal(result.manualRenders, 1);
  assertNoPicker(result.paints.slice(previousPaints));
  assert.equal(navigations.at(-1).params.preferredStreamId, "4k");
});

test("a settings update to MANUAL before selection restores the normal picker", async () => {
  const result = await mount("FIRST_STREAM");
  assertNoPicker(result.paints);
  PlayerSettingsStore.set({ streamAutoPlayMode: "MANUAL" }, { silentSync: true });
  complete(result.ui);
  await settle();
  assert.equal(result.ui.autoPlayUiActive, false);
  assert.equal(result.ui.autoPlayUiError, "");
  assert.equal(result.manualRenders, 1);
  assert.ok(result.paints.at(-1).includes("stream-route-content"));
  assert.equal(navigations.length, 0);
});

test("automatic mount replaces preexisting picker DOM before showing its container", async () => {
  const result = await mount("FIRST_STREAM", {
    previousMarkup:
      '<div class="stream-route-content"><div class="stream-route-card">Old source</div></div>'
  });
  assertNoPicker(result.exposures);
  assertNoPicker(result.paints);
  assert.equal(result.manualRenders, 0);
});

test("selector settings hydration paints loading before waiting for resume data", async () => {
  const previousResume = watchProgressRepository.getResumeByContentId;
  let resolve;
  watchProgressRepository.getResumeByContentId = () =>
    new Promise((done) => {
      resolve = done;
    });
  try {
    const result = await mount("MANUAL", { params: { startFromBeginning: false } });
    const previousPaints = result.paints.length;
    PlayerSettingsStore.set({ streamAutoPlayMode: "FIRST_STREAM" }, { silentSync: true });
    result.ui.streams = sources.slice();
    result.ui.loading = false;
    result.ui.streamSearchCompleted = true;
    result.ui.maybeAutoPlayStream({ allLoaded: true });
    assert.equal(result.ui.autoPlayUiActive, true);
    assert.equal(result.manualRenders, 1);
    assertNoPicker(result.paints.slice(previousPaints));
    assert.equal(typeof resolve, "function");
    assert.equal(navigations.length, 0);
    resolve(null);
    await settle();
    assert.equal(navigations.at(-1).params.preferredStreamId, "a");
  } finally {
    watchProgressRepository.getResumeByContentId = previousResume;
  }
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
