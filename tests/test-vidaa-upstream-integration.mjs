import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  documentElement: {}
};
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const { MdbListSettingsStore, MDBLIST_RATING_ORDER, normalizeMdbListRatingOrder } =
  await import("../js/data/local/mdbListSettingsStore.js");
const { mdbListRepository } = await import("../js/data/repository/mdbListRepository.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { Router } = await import("../js/ui/navigation/routerState.js");
const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
const { I18n } = await import("../js/i18n/index.js");
const { Platform } = await import("../js/platform/index.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { ensureHeroMdbListRatings } = await import("../js/ui/screens/home/homeHeroMdbListLoad.js");
const { getHeroMdbListRatings, renderHeroMdbListRatings } =
  await import("../js/ui/screens/home/homeMdbListRatings.js");
const { normalizeCollection } = await import("../js/data/local/collectionsStore.js");
const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");
const { createPlayerScreenMethods28 } =
  await import("../js/ui/screens/player/playerScreenMethods-28-unbind-video-events.js");
const { createDiscoverScreenMethods05 } =
  await import("../js/ui/screens/search/discoverScreenMethods-05-restore-content-focus.js");
const { FocusEngine } = await import("../js/ui/navigation/focusEngine.js");

let settings = {
  enabled: true,
  apiKey: "fixture",
  showOnHero: true,
  ratingOrder: MDBLIST_RATING_ORDER
};
MdbListSettingsStore.get = () => settings;
LayoutPreferences.get = () => ({ homeImdbRatingsVisibility: "all" });
I18n.getLocale = () => "it";
let profile = "1",
  route = "home";
ProfileManager.getActiveProfileId = () => profile;
Router.getCurrent = () => route;
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("hero ratings share pending requests and reject responses for a previous title/profile/route", async () => {
  const requests = [];
  mdbListRepository.getRatingsForMeta = (hero) => {
    const request = { ...deferred(), id: hero.id };
    requests.push(request);
    return request.promise;
  };
  let paints = 0;
  const owner = {
    heroItem: { id: "a", type: "movie", name: "Titolo italiano" },
    homeLoadToken: 1,
    applyHeroToDom() {
      paints++;
    },
    mergeHeroIntoCatalogState() {}
  };
  const first = ensureHeroMdbListRatings.call(owner);
  assert.equal(ensureHeroMdbListRatings.call(owner), first);
  assert.equal(requests.length, 1);
  owner.heroItem = { id: "b", type: "movie", name: "Altro titolo" };
  const second = ensureHeroMdbListRatings.call(owner);
  requests[0].resolve({ ratings: { imdb: 9 } });
  await first;
  assert.equal(paints, 0);
  requests[1].resolve({ ratings: { imdb: 8, tomatoes: 95 } });
  await second;
  assert.equal(owner.heroItem.name, "Altro titolo");
  assert.equal(owner.heroItem.mdbListRatings.imdb, 8);
  assert.equal(paints, 1);
  owner.heroItem = { id: "b", type: "movie", name: "Metadati aggiornati" };
  await ensureHeroMdbListRatings.call(owner);
  assert.equal(requests.length, 2, "Metadata refresh reuses the completed rating response");
  assert.equal(owner.heroItem.name, "Metadati aggiornati");
  assert.equal(owner.heroItem.mdbListRatings.imdb, 8);
  owner.heroItem = { id: "c", type: "movie" };
  const staleProfile = ensureHeroMdbListRatings.call(owner);
  profile = "2";
  requests[2].resolve({ ratings: { imdb: 1 } });
  await staleProfile;
  assert.equal(owner.heroItem.mdbListRatings, undefined);
  const staleRoute = ensureHeroMdbListRatings.call(owner);
  route = "player";
  requests[3].resolve({ ratings: { imdb: 2 } });
  await staleRoute;
  assert.equal(owner.heroItem.mdbListRatings, undefined);
  route = "home";
  owner.heroItem = { id: "collection", heroSource: "collection" };
  assert.equal(ensureHeroMdbListRatings.call(owner), undefined);
  settings.showOnHero = false;
  owner.heroItem = { id: "disabled" };
  assert.equal(ensureHeroMdbListRatings.call(owner), undefined);
  assert.equal(requests.length, 4);
  settings.showOnHero = true;
});

test("hero rating order, provider switches, certified icons and layout limits are respected", () => {
  const order = normalizeMdbListRatingOrder([
    "tomatoes",
    "imdb",
    "imdb",
    "invalid",
    "audience",
    "mal"
  ]);
  assert.equal(order.length, MDBLIST_RATING_ORDER.length);
  assert.deepEqual(order.slice(0, 4), ["tomatoes", "imdb", "audience", "mal"]);
  settings = { ...settings, ratingOrder: order, showImdb: false };
  const hero = {
    mdbListRatings: {
      tomatoes: 95,
      tomatoesCertified: true,
      imdb: 8.1,
      audience: 98,
      mal: 8.2,
      trakt: 90,
      tmdb: 80,
      metacritic: 75,
      letterboxd: 4
    }
  };
  assert.deepEqual(
    getHeroMdbListRatings(hero).map((item) => item.provider),
    ["tomatoes", "audience", "mal"]
  );
  assert.equal(getHeroMdbListRatings(hero, "classic").length, 6);
  const markup = renderHeroMdbListRatings(hero);
  assert.match(markup, /certified/);
  assert.match(markup, /8,2/);
  assert.doesNotMatch(markup, /imdb_logo/);
  settings.showOnHero = false;
  assert.equal(renderHeroMdbListRatings(hero), "");
});

test("empty numeric collection filters survive normalization while explicit zero remains zero", () => {
  for (const value of [null, undefined, "", "  ", 0, "0", "7.4"]) {
    const collection = normalizeCollection({
      id: "c",
      title: "Collection",
      folders: [
        {
          id: "f",
          title: "Folder",
          sources: [
            {
              provider: "tmdb",
              tmdbSourceType: "DISCOVER",
              filters: { voteAverageGte: value, voteAverageLte: value, voteCountGte: value }
            }
          ]
        }
      ]
    });
    const filters = collection.folders[0].sources[0].filters;
    const expected = value == null || String(value).trim() === "" ? null : Number(value);
    assert.equal(filters.voteAverageGte, expected);
    assert.equal(filters.voteAverageLte, expected);
    assert.equal(filters.voteCountGte, expected == null ? null : Math.trunc(expected));
  }
});

test("a playing seek remains loading until seek completion and a subsequent clock advance", () => {
  PlayerController.video = { readyState: 4, seeking: false, ended: false };
  PlayerController.getPlaybackReadyState = () => 4;
  PlayerController.isPlaybackEnded = () => false;
  PlayerController.avplaySeekInFlight = false;
  let seconds = 100;
  const owner = {
    ...createPlayerScreenMethods30(),
    ...createPlayerScreenMethods28(),
    seekLoading: true,
    seekLoadingSettled: false,
    paused: false,
    hasPresentedPlaybackFrame: true,
    pendingPlaybackRestore: null,
    clearBufferingSpinnerTimer() {},
    updateLoadingVisibility() {},
    isStartupLoadingVisible: () => false,
    getPlaybackCurrentSeconds: () => seconds
  };
  assert.equal(owner.completeSeekLoadingIfReady(), false);
  owner.seekLoadingSettled = true;
  owner.seekLoadingProgressSeconds = null;
  assert.equal(owner.completeSeekLoadingIfReady(), false);
  assert.equal(owner.completeSeekLoadingIfReady(), false);
  seconds += 0.1;
  assert.equal(owner.completeSeekLoadingIfReady(), true);
  assert.equal(owner.seekLoading, false);
  Object.assign(owner, { seekLoading: true, seekLoadingSettled: true, paused: true });
  assert.equal(
    owner.completeSeekLoadingIfReady(),
    true,
    "A paused seek can settle without clock advance"
  );
  assert.equal(
    PlayerController.setWebOsAudioTrackWithDtsConversion({}, 0, 0),
    false,
    "VIDAA cannot enter the webOS conversion service"
  );
});

test("Discover reuses only decoded posters with the same title, type and image URL", () => {
  class ImageNode {
    constructor(id, src, { type = "movie", complete = true, width = 100, deferred = false } = {}) {
      this.complete = complete;
      this.naturalWidth = width;
      this.alt = "old";
      this.card = { dataset: { itemId: id, itemType: type } };
      this.dataset = deferred ? { src } : {};
      this.src = deferred ? "" : src;
      this.parentNode = {
        replaceChild: (replacement) => {
          this.replacement = replacement;
        }
      };
    }
    getAttribute() {
      return this.src;
    }
    closest() {
      return this.card;
    }
  }
  globalThis.HTMLImageElement = ImageNode;
  const loaded = new ImageNode("a", "poster-a");
  let images = [
    loaded,
    new ImageNode("b", "poster-b", { complete: false }),
    new ImageNode("c", "poster-c", { width: 0 })
  ];
  const owner = {
    ...createDiscoverScreenMethods05(),
    container: { querySelectorAll: () => images }
  };
  const captured = owner.captureLoadedDiscoverPosters();
  assert.equal(captured.size, 1);
  images = [
    new ImageNode("a", "poster-a", { type: "series", deferred: true }),
    new ImageNode("a", "new-poster", { deferred: true }),
    new ImageNode("a", "poster-a", { deferred: true })
  ];
  images[2].alt = "localized title";
  owner.restoreLoadedDiscoverPosters(captured);
  assert.equal(images[0].replacement, undefined);
  assert.equal(images[1].replacement, undefined);
  assert.equal(images[2].replacement, loaded);
  assert.equal(loaded.alt, "localized title");
});

test("pointer hover preserves an active editor; an explicit pointer click moves focus", () => {
  Platform.current = { name: "webos" };
  Router.getCurrentScreen = () => null;
  const target = { closest: () => null };
  document.activeElement = { matches: () => true, disabled: false, readOnly: false };
  document.querySelector = () => null;
  let focusChanges = 0;
  const owner = {
    ...FocusEngine,
    getPointerFocusable: () => target,
    focusPointerTarget() {
      focusChanges++;
    }
  };
  owner.processPointerMove({ target });
  assert.equal(focusChanges, 0);
  owner.handlePointerClick({ target });
  assert.equal(focusChanges, 1);
});

for (const { name, run } of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(
  `${tests.length}/${tests.length} upstream 1.2.5 integration checks passed (simulated requests/media/DOM).`
);
