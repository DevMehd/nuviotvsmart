import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.__NUVIO_ENV__ = { TMDB_API_KEY: "fixture-build-key" };
const {
  Router,
  ProfileManager,
  LayoutPreferences,
  TmdbSettingsStore,
  mdbListRepository,
  metaRepository,
  TmdbService,
  TmdbMetadataService
} = await import("../js/ui/screens/home/homeScreenContext.js");
const { MdbListSettingsStore } = await import("../js/data/local/mdbListSettingsStore.js");
const { createHomeScreenMethods04 } =
  await import("../js/ui/screens/home/homeScreenMethods-04-get-hero-focus-delay.js");
const { createHomeScreenMethods11 } =
  await import("../js/ui/screens/home/homeScreenMethods-11-enrich-current-hero-async.js");
const { createHomeScreenMethods10 } =
  await import("../js/ui/screens/home/homeScreenMethods-10-schedule-modern-hero-update.js");
const { homeMetadataSettingsSignature } =
  await import("../js/ui/screens/home/homeMetadataSettings.js");
const { buildHeroDisplayModel, buildModernHeroPresentation } =
  await import("../js/ui/screens/home/homeScreenHelpers-11-build-hero-display-model.js");

const defaults = {
  enabled: true,
  modernHomeEnabled: true,
  language: "it-IT",
  apiKey: "fixture-personal-key",
  useBasicInfo: true,
  useArtwork: true,
  useDetails: true,
  useReleaseDates: false
};
let settings = { ...defaults };
ProfileManager.getActiveProfileId = () => "profile-localization";
Router.getCurrent = () => "home";
TmdbSettingsStore.get = () => settings;
LayoutPreferences.get = () => ({ preferExternalMetaAddonDetail: true });
MdbListSettingsStore.get = () => ({ enabled: true, apiKey: "fixture-mdb-key", showImdb: true });
const english = {
  id: "tt0099",
  type: "movie",
  name: "English catalog title",
  description: "English catalog overview",
  logo: "https://example.test/en-logo.png",
  background: "https://example.test/catalog-backdrop.jpg"
};
const italian = {
  localizedTitle: "Titolo italiano",
  description: "Descrizione italiana",
  logo: "https://example.test/it-logo.png",
  backdrop: "https://example.test/it-backdrop.jpg",
  poster: "https://example.test/it-poster.jpg"
};
const addonEnglish = {
  status: "success",
  data: { description: "English addon overview", logo: "https://example.test/addon-en.png" }
};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}
function display(hero, layoutMode) {
  return layoutMode === "modern"
    ? buildModernHeroPresentation(hero)
    : buildHeroDisplayModel(hero, layoutMode);
}
function heroState(layoutMode = "modern") {
  return {
    ...createHomeScreenMethods04(),
    ...createHomeScreenMethods11(),
    layoutMode,
    container: { querySelector: () => null },
    heroItem: { ...english },
    heroCandidates: [{ ...english }],
    rows: [],
    heroFocusToken: 1,
    commits: [],
    getCurrentFocusedNode() {
      return { hero: this.heroItem };
    },
    getNodeHeroSource: (node) => node.hero,
    waitForVidaaHomeLoadingIdle: async (canCommit) => canCommit(),
    applyHeroToDom() {
      this.commits.push({
        hero: { ...this.heroItem },
        display: display(this.heroItem, layoutMode)
      });
    }
  };
}
function providers() {
  const tmdb = deferred();
  const addon = deferred();
  const mdb = deferred();
  const requests = { ids: [], tmdb: [], addon: [] };
  TmdbService.ensureTmdbId = async (id, type, options) => {
    requests.ids.push({ id, type, ...options });
    return 99;
  };
  TmdbMetadataService.fetchEnrichment = (options) => {
    requests.tmdb.push(options);
    return tmdb.promise;
  };
  metaRepository.getMetaFromAllAddons = (type, id, transport, options) => {
    requests.addon.push({ type, id, transport, ...options });
    return addon.promise;
  };
  mdbListRepository.getImdbRatingForItem = () => mdb.promise;
  return { tmdb, addon, mdb, requests };
}
function assertLocalized(result) {
  assert.equal(result.title, italian.localizedTitle);
  assert.equal(result.description, italian.description);
  assert.equal(result.logo, italian.logo);
}

// The initial model and independent provider publications must both respect
// the preferred language in all three Home layouts.
for (const layout of ["classic", "grid", "modern"]) {
  settings = { ...defaults };
  const { tmdb, addon, mdb, requests } = providers();
  const state = heroState(layout);
  const first = display(state.heroItem, layout);
  assert.equal(first.title, "", `${layout}: no initial English title flash`);
  assert.equal(first.description, "", `${layout}: no initial English overview flash`);
  assert.equal(first.logo, "", `${layout}: no initial English logo flash`);
  assert.equal(first.backdrop, english.background, "Unlocalized backdrop remains available");
  // The generic model is also used by markup/preload callers on modern Home.
  assert.equal(buildHeroDisplayModel(state.heroItem, layout).title, "");
  const pending = state.enrichCurrentHeroAsync(state.heroItem, 1, { deferCommit: true });
  await flush();
  assert.equal(requests.tmdb.length, 1);
  assert.equal(requests.tmdb[0].language, "it-IT");
  assert.equal(requests.tmdb[0].includeExtras, false, "Preview excludes slow credits/extras");
  assert.equal(requests.tmdb[0].signal, requests.ids[0].signal);
  assert.equal(requests.tmdb[0].signal, requests.addon[0].signal);
  addon.resolve(addonEnglish);
  await flush();
  assert.equal(state.commits.length, 0, `${layout}: addon English cannot commit first`);
  tmdb.resolve(italian);
  await flush();
  assert.ok(state.commits.length > 0, `${layout}: TMDB publishes while MDBList is pending`);
  assertLocalized(display(state.heroItem, layout));
  mdb.resolve(8.6);
  await pending;
  state.commits.forEach((commit) => assertLocalized(commit.display));
  assert.equal(state.heroItem.imdbRating, 8.6);
}

// Ratings alone cannot reveal an English preview before TMDB resolves either.
{
  const { tmdb, addon, mdb } = providers();
  const state = heroState();
  const pending = state.enrichCurrentHeroAsync(state.heroItem);
  await flush();
  mdb.resolve(8.1);
  await flush();
  assert.equal(state.commits.length, 0, "Early MDBList result cannot expose English metadata");
  tmdb.resolve(italian);
  await flush();
  assertLocalized(display(state.heroItem, "modern"));
  addon.resolve(addonEnglish);
  await pending;
  state.commits.forEach((commit) => assertLocalized(commit.display));
}

// An unsuccessful TMDB request releases the available fallback before an
// unrelated rating provider completes, instead of leaving a blank preview.
{
  const { tmdb, addon, mdb } = providers();
  const state = heroState();
  const pending = state.enrichCurrentHeroAsync(state.heroItem);
  await flush();
  addon.resolve(addonEnglish);
  await flush();
  assert.equal(state.commits.length, 0);
  tmdb.reject(new Error("TMDB unavailable"));
  await flush();
  assert.ok(state.commits.length > 0, "TMDB failure releases fallback immediately");
  const fallback = display(state.heroItem, "modern");
  assert.equal(fallback.title, english.name);
  assert.equal(fallback.description, addonEnglish.data.description);
  assert.equal(fallback.logo, addonEnglish.data.logo);
  mdb.resolve(null);
  await pending;
}

// No localized request is expected when Home TMDB is disabled, the selected
// language is English, or both text and artwork enrichment are disabled.
for (const [layout, overrides] of [
  ["modern", { modernHomeEnabled: false }],
  ["classic", { enabled: false }],
  ["grid", { enabled: false }],
  ["modern", { language: "en-US" }],
  ["classic", { useBasicInfo: false, useArtwork: false }],
  ["grid", { useBasicInfo: false, useArtwork: false }],
  ["modern", { useBasicInfo: false, useArtwork: false }]
]) {
  settings = { ...defaults, ...overrides };
  const visible = display(english, layout);
  assert.equal(visible.title, english.name);
  assert.equal(visible.description, english.description);
  assert.equal(visible.logo, english.logo);
}
settings = { ...defaults };

// Revisiting a localized title while addon/MDBList work is still pending must
// keep the Italian preview visible while independent enrichment continues.
{
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const timers = new Map();
  const frames = new Map();
  let nextId = 0;
  globalThis.setTimeout = (callback) => {
    const id = ++nextId;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const localizedHero = {
      ...english,
      name: italian.localizedTitle,
      description: italian.description,
      logo: italian.logo,
      heroTmdbLocalizationSignature: homeMetadataSettingsSignature(),
      heroMetaEnriched: false
    };
    const focused = {
      isConnected: true,
      classList: { contains: (name) => name === "focused" },
      hero: localizedHero
    };
    const requested = [];
    const state = {
      ...heroState(),
      ...createHomeScreenMethods10(),
      heroItem: localizedHero,
      heroCandidates: [localizedHero],
      getCurrentFocusedNode: () => focused,
      getHeroFocusDelay: () => 0,
      isVidaaHomeLoadingBusy: () => false,
      isPerformanceConstrained: () => true,
      syncCollectionHeroMedia() {},
      enrichCurrentHeroAsync(hero) {
        requested.push(hero);
      }
    };
    state.scheduleModernHeroUpdate(focused, { immediate: true });
    const commitTimer = state.heroFocusDelayTimer;
    const commit = timers.get(commitTimer);
    assert.equal(typeof commit, "function");
    timers.delete(commitTimer);
    commit();
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback();
    }
    assert.equal(
      state.heroItem.heroMetaEnriching,
      false,
      "Pending ratings cannot hide localized copy again"
    );
    assert.equal(state.commits.length, 1);
    assertLocalized(state.commits[0].display);
    assert.equal(requested.length, 1, "Other provider enrichment still runs independently");
    state.cancelPendingHeroFocus();
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
}

// A new attempt may fail after a previous focus already localized this title.
// That failure cannot let a later English addon overwrite the valid preview.
{
  const { tmdb, addon, mdb } = providers();
  const state = heroState();
  const localized = {
    ...english,
    name: italian.localizedTitle,
    description: italian.description,
    logo: italian.logo,
    background: italian.backdrop,
    genres: ["Avventura"],
    heroTmdbLocalizationSignature: homeMetadataSettingsSignature(),
    heroMetaEnriched: false
  };
  state.heroItem = localized;
  state.heroCandidates = [localized];
  const pending = state.enrichCurrentHeroAsync(state.heroItem);
  await flush();
  addon.resolve({
    status: "success",
    data: {
      ...addonEnglish.data,
      background: "https://example.test/addon-en-backdrop.jpg",
      genres: ["Adventure"]
    }
  });
  tmdb.reject(new Error("TMDB refresh unavailable"));
  await flush();
  assert.ok(state.commits.length > 0);
  assertLocalized(display(state.heroItem, "modern"));
  assert.equal(state.heroItem.background, italian.backdrop);
  assert.deepEqual(state.heroItem.genres, localized.genres);
  mdb.resolve(8.6);
  await pending;
  state.commits.forEach((commit) => assertLocalized(commit.display));
  assert.equal(state.heroItem.background, italian.backdrop);
  assert.deepEqual(state.heroItem.genres, localized.genres);
}

// Focus cancellation aborts real request options. Even providers that ignore
// abort and complete later cannot replace the next focused title.
{
  const old = providers();
  const state = heroState();
  const oldPending = state.enrichCurrentHeroAsync(state.heroItem);
  await flush();
  state.cancelPendingHeroFocus();
  assert.ok(old.requests.ids[0].signal.aborted);
  assert.ok(old.requests.tmdb[0].signal.aborted);
  assert.ok(old.requests.addon[0].signal.aborted);
  const next = providers();
  state.heroItem = { ...english, id: "tt0100", name: "Next English title" };
  state.heroCandidates.push(state.heroItem);
  const nextPending = state.enrichCurrentHeroAsync(state.heroItem);
  await flush();
  const nextController = state.heroEnrichmentAbortController;
  const nextPendingKey = state.pendingHeroEnrichmentKey;
  const commitCount = state.commits.length;
  old.tmdb.resolve({ ...italian, localizedTitle: "Vecchio titolo", logo: "old-logo.png" });
  old.addon.resolve(addonEnglish);
  old.mdb.resolve(9.9);
  await oldPending;
  assert.equal(
    state.commits.length,
    commitCount,
    "Retired responses cannot publish during the next lookup"
  );
  assert.equal(state.heroEnrichmentAbortController, nextController);
  assert.equal(state.pendingHeroEnrichmentKey, nextPendingKey);
  next.tmdb.resolve(italian);
  next.addon.resolve({ status: "error" });
  next.mdb.resolve(null);
  await nextPending;
  assert.equal(state.heroItem.id, "tt0100");
  assertLocalized(display(state.heroItem, "modern"));
  assert.equal(next.requests.tmdb[0].signal.aborted, false);
}

// Catalog cache identity includes content type, and unrelated rows retain
// their object identity instead of being rebuilt on every provider update.
{
  const movie = { ...english, id: "shared-id" };
  const series = { ...english, id: "shared-id", type: "series", name: "Series title" };
  const movieRow = { result: { data: { items: [movie] } } };
  const seriesRow = { result: { data: { items: [series] } } };
  const unrelatedRow = { result: { data: { items: [{ ...english, id: "unrelated" }] } } };
  const state = heroState();
  state.heroCandidates = [movie, series];
  state.rows = [movieRow, seriesRow, unrelatedRow];
  state.mergeHeroIntoCatalogState("shared-id", { ...movie, name: italian.localizedTitle });
  assert.equal(state.rows[0].result.data.items[0].name, italian.localizedTitle);
  assert.equal(state.rows[1], seriesRow, "Same ID with another content type is untouched");
  assert.equal(state.heroCandidates[1], series);
  assert.equal(state.rows[2], unrelatedRow, "Nonmatching rows preserve object identity");
}

console.log(
  "VIDAA localized preview checks passed: initial classic/grid/modern display, provider ordering, fallback, settings bypass, request abort and catalog identity."
);
