import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.document = { documentElement: { classList: { contains: () => false } } };
globalThis.location = { search: "" };
const { StreamScreen, Router, PlayerSettingsStore, StreamBadgeSettingsStore, streamRepository } =
  await import("../js/ui/screens/stream/streamScreen.js");
const { resetAddonLogoCache } = await import("../js/core/media/addonLogoCache.js");
// --new-sources: the same cases against the new TV Sources screen (beta), which inherits this logic.
const newSources = process.argv.includes("--new-sources");
let methods = newSources
  ? (await import("../js/ui/tv2/sources/newSourcesScreen.js")).NewSourcesScreen
  : StreamScreen;
if (process.argv.includes("--baseline")) {
  const fileUrl = new URL(
    "../js/ui/screens/stream/streamScreenMethods-03-mount.js",
    import.meta.url
  );
  const source = execFileSync(
    "git",
    ["show", "HEAD:js/ui/screens/stream/streamScreenMethods-03-mount.js"],
    { encoding: "utf8" }
  ).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, path) => `from ${quote}${new URL(path, fileUrl).href}${quote}`
  );
  const baseline = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  methods = { ...methods, ...baseline.createStreamScreenMethods03() };
}
const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++timerId;
  timers.set(id, { callback, delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
const images = [];
globalThis.Image = class {
  constructor() {
    images.push(this);
  }
  removeAttribute() {}
  decode() {
    return this.decodeResult || Promise.resolve();
  }
};
PlayerSettingsStore.get = () => ({ streamAutoPlayMode: "NONE", streamReuseLastLinkEnabled: false });
StreamBadgeSettingsStore.snapshot = () => ({ showAddonLogo: true });
streamRepository.setLocalPluginSearchPaused = () => {};
let route = "stream";
Router.getCurrent = () => route;
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
function fixture(completed = true) {
  const paints = [];
  const renders = [];
  const searches = [];
  let applied = 0;
  const container = { style: { display: "none" } };
  document.getElementById = () => container;
  const ui = {
    ...methods,
    stopStreamVirtualization() {},
    syncAutoPlayUiState() {
      this.autoPlayUiActive = false;
    },
    cancelAutoPlayCountdown() {},
    cancelAutoPlaySelectionWait() {},
    render() {
      paints.push({
        shown: container.style.display === "block",
        loading: this.loading,
        focus: this.focusState,
        streams: this.streams.slice()
      });
    },
    requestRender(options) {
      renders.push(options);
    },
    loadStreams(options) {
      searches.push(options);
    },
    applyAddonLogos(streams) {
      applied++;
      return streams;
    }
  };
  let mounted = false;
  const pending = ui
    .mount(
      { itemId: "tt1", videoId: "tt1", itemType: "movie" },
      {
        isBackNavigation: true,
        previousRoute: "player",
        restoredState: {
          loading: true,
          streams: [
            {
              id: "source",
              addonName: "Source",
              addonLogo: "https://logos.example.test/source.png",
              url: "https://video.example.test/movie.mp4"
            }
          ],
          focusState: { zone: "card", row: 0, action: "play" },
          streamSearchCompleted: completed,
          listScrollTop: 800
        }
      }
    )
    .then(() => {
      mounted = true;
    });
  return {
    ui,
    paints,
    renders,
    searches,
    container,
    pending,
    get mounted() {
      return mounted;
    },
    get applied() {
      return applied;
    }
  };
}
const tests = [
  [
    "Restored sources paint and restore focus while a logo has no events",
    async () => {
      const state = fixture();
      await flush();
      try {
        assert.equal(images.length, 1, "The real logo request is pending");
        assert.equal(state.mounted, true, "Mount must complete before artwork events");
        assert.equal(state.container.style.display, "block");
        assert.equal(state.paints.length, 1);
        assert.equal(state.paints[0].loading, false);
        assert.equal(state.paints[0].streams[0].id, "source");
        assert.deepEqual(state.paints[0].focus, { zone: "card", row: 0, action: "play" });
        assert.equal(state.ui.listScrollTop, 800);
        assert.deepEqual(state.searches, []);
        // VIDAA shows addon logos directly (nuv-090): the request only warms the cache, so the
        // logo repaint is requested without waiting for any image event.
        await flush();
        assert.deepEqual(state.renders, [{ delayMs: 0 }]);
      } finally {
        images.forEach((image) => image.onload?.());
        await state.pending;
      }
    }
  ],
  [
    "An incomplete restored search reattaches without awaiting logos",
    async () => {
      const state = fixture(false);
      await flush();
      try {
        assert.equal(state.mounted, true);
        assert.deepEqual(state.searches, [{ preserveResults: true, forceRefresh: false }]);
        assert.equal(state.container.style.display, "block");
        assert.equal(state.ui.loading, false);
      } finally {
        images.forEach((image) => image.onload?.());
        await state.pending;
      }
    }
  ],
  [
    "Leaving before warmup starts prevents stale stream mutations",
    async () => {
      const state = fixture();
      route = "detail";
      await state.pending;
      await flush();
      assert.equal(state.applied, 0);
      assert.equal(images.length, 0);
      assert.equal(state.renders.length, 0);
    }
  ],
  [
    "A late completed logo cannot repaint a retired mount",
    async () => {
      const state = fixture();
      await flush();
      assert.equal(images.length, 1, "Only a fire-and-forget warm request exists (nuv-090)");
      const rendersBeforeRetire = state.renders.length;
      state.ui.loadToken++;
      route = "detail";
      images.forEach((image) => image.onload?.());
      await state.pending;
      await flush();
      assert.equal(state.renders.length, rendersBeforeRetire);
    }
  ]
];
let failures = 0;
for (const [name, run] of tests) {
  resetAddonLogoCache();
  images.length = 0;
  timers.clear();
  route = "stream";
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
resetAddonLogoCache();
console.log(`Stream restore loading: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
