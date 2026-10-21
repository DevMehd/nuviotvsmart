import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.HTMLImageElement = class {};
const { Platform } = await import("../js/platform/index.js");
const { normalizeCollectionFolderItem } =
  await import("../js/ui/screens/home/homeScreenHelpers-05-normalize-collection-folder-item.js");
const { createHomeScreenMethods11 } =
  await import("../js/ui/screens/home/homeScreenMethods-11-enrich-current-hero-async.js");
const { createHomeScreenMethods12 } =
  await import("../js/ui/screens/home/homeScreenMethods-12-sync-collection-hero-media.js");
const { createHomeScreenMethods03 } =
  await import("../js/ui/screens/home/homeScreenMethods-03-is-scroll-animation-active.js");
const seed = {
  collectionId: "collection",
  folderId: "folder",
  name: "Collection",
  coverImageUrl: "https://example.test/cover.jpg",
  focusGifUrl: "https://example.test/focus.gif",
  heroVideoUrl: "https://example.test/video.mp4"
};
for (const platform of ["vidaa", "tizen", "webos", "browser"]) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  Platform.current = null;
  assert.equal(
    createHomeScreenMethods03().shouldSuppressAutomaticTrailerPlayback.call({
      isLegacyTvRuntime: () => true
    }),
    platform === "webos" || platform === "browser",
    "VIDAA keeps profile-enabled previews available on older browsers"
  );
  const hero = normalizeCollectionFolderItem(seed);
  assert.equal(hero.poster, seed.coverImageUrl);
  assert.equal(hero.heroVideoUrl, seed.heroVideoUrl);
  assert.equal(hero.focusGifUrl, seed.focusGifUrl);
  assert.equal(hero.focusGifEnabled, true);
  const configuredGif = normalizeCollectionFolderItem({ ...seed, focusGifEnabled: false });
  assert.equal(
    configuredGif.poster,
    // VIDAA never decodes a GIF as a static card image (memory); other platforms keep it.
    platform === "vidaa" ? seed.coverImageUrl : seed.focusGifUrl,
    "Preserve the original collection's configured poster"
  );
  const animatedHero = normalizeCollectionFolderItem({
    ...seed,
    heroBackdropUrl: "https://example.test/fullscreen.gif"
  });
  assert.equal(
    animatedHero.background,
    // VIDAA keeps a static backdrop instead of a full-screen GIF (1 GB TV); others keep it.
    platform === "vidaa" ? seed.coverImageUrl : "https://example.test/fullscreen.gif",
    "Preserve account artwork on every platform"
  );

  const image = new HTMLImageElement();
  image.tagName = "IMG";
  image.dataset = { src: seed.focusGifUrl };
  const attrs = new Map();
  image.getAttribute = (name) => attrs.get(name) || null;
  image.setAttribute = (name, value) => attrs.set(name, value);
  image.removeAttribute = (name) => attrs.delete(name);
  const classes = new Set(["focused"]);
  const card = {
    isConnected: true,
    querySelector: () => image,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
  const methods = createHomeScreenMethods11();
  methods.hydrateCollectionFocusGif(card, true);
  if (platform === "vidaa") {
    assert.equal(attrs.has("src"), false, "Passing focus must not eagerly start GIF decoding");
    await new Promise((resolve) => setTimeout(resolve, 110));
  }
  assert.equal(attrs.has("src"), true);
  assert.equal(classes.has("is-focus-gif-active"), true);
  methods.hydrateCollectionFocusGif(card, false);
  assert.equal(attrs.has("src"), false, "Leaving a collection stops GIF decoding");
  const preserveOwner = { isCollectionFolderNode: () => true, getNodeHeroSource: () => seed };
  assert.equal(methods.shouldPreserveCollectionHeroMedia.call(preserveOwner, card), true);

  let mounts = 0;
  let clears = 0;
  let active = false;
  const layer = { querySelector: () => null, classList: { contains: () => false } };
  const media = {};
  const owner = {
    container: {
      querySelector: (selector) => (selector === ".home-hero-trailer-layer" ? layer : media)
    },
    collectionHeroMediaKey: "previous-video",
    clearTrailerLayer: () => {
      clears += 1;
    },
    setHeroTrailerActive: (enabled) => {
      active = enabled;
    },
    mountTrailerLayer: (_layer, source, ready) => {
      mounts += 1;
      assert.equal(source.url, seed.heroVideoUrl);
      ready();
    }
  };
  createHomeScreenMethods12().syncCollectionHeroMedia.call(owner, seed);
  assert.equal(mounts, 1);
  assert.equal(clears, 0);
  assert.equal(active, true);
  createHomeScreenMethods12().syncCollectionHeroMedia.call(owner, null);
  assert.equal(clears, 1, "Leaving a collection clears its video");
  assert.equal(active, false);
}
// Trakt must supply artwork with the list itself, including later pages and
// series lists; otherwise cards arrive without usable posters or backgrounds.
// A trailer cache entry must not survive a profile or language change.
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { TmdbSettingsStore } = await import("../js/data/local/tmdbSettingsStore.js");
const { createHomeScreenMethods14 } =
  await import("../js/ui/screens/home/homeScreenMethods-14-activate-focused-poster-flow.js");
const originalActiveProfile = ProfileManager.getActiveProfileId;
const originalTmdbSettings = TmdbSettingsStore.get;
try {
  let profileId = "one";
  let language = "it-IT";
  ProfileManager.getActiveProfileId = () => profileId;
  TmdbSettingsStore.get = () => ({ enabled: true, language, apiKey: "fixture-key" });
  const node = { dataset: { itemId: "tt1000001", itemType: "movie" } };
  const owner = { getNodeHeroSource: () => null };
  const key = () => createHomeScreenMethods14().getFocusedPosterFlowKey.call(owner, node);
  const initial = key();
  assert.equal(key(), initial, "Same profile/preferences reuses the cache");
  language = "en-US";
  assert.notEqual(key(), initial, "Changing trailer language invalidates the cache");
  language = "it-IT";
  profileId = "two";
  assert.notEqual(key(), initial, "Changing profile invalidates the cache");
  assert.ok(!initial.includes("fixture-key"), "Cache keys omit API credentials");
} finally {
  ProfileManager.getActiveProfileId = originalActiveProfile;
  TmdbSettingsStore.get = originalTmdbSettings;
}
const { fetchTraktSourceItems } =
  await import("../js/ui/screens/collection/folderDetailScreenHelpers-04-map-trakt-entity.js");
const { TraktClientSettingsStore } = await import("../js/data/local/traktClientSettingsStore.js");
const originalFetch = globalThis.fetch;
const originalCredentials = TraktClientSettingsStore.get;
TraktClientSettingsStore.get = () => ({
  clientId: "fixture-client",
  clientSecret: "fixture-secret"
});
globalThis.__NUVIO_PLATFORM__ = "vidaa";
Platform.current = null;
try {
  for (const [mediaType, entityType, type] of [
    ["MOVIE", "movie", "movie"],
    ["TV", "show", "series"]
  ]) {
    const requests = [];
    globalThis.fetch = async (rawUrl) => {
      const url = new URL(rawUrl);
      requests.push(url);
      const hasArtwork = url.searchParams.get("extended")?.split(",").includes("images");
      return new Response(
        JSON.stringify([
          {
            [entityType]: {
              title: "Fixture title",
              year: 2026,
              ids: { imdb: "tt1000001" },
              ...(hasArtwork
                ? {
                    images: {
                      poster: ["https://fixture.invalid/poster.jpg"],
                      fanart: ["https://fixture.invalid/backdrop.jpg"],
                      logo: ["https://fixture.invalid/logo.png"]
                    }
                  }
                : {})
            }
          }
        ]),
        { status: 200, headers: { "X-Pagination-Page-Count": "3" } }
      );
    };
    const result = await fetchTraktSourceItems(
      { mediaType, traktListId: "fixture-list", sortBy: "added", sortHow: "desc" },
      2
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, `/lists/fixture-list/items/${entityType}`);
    assert.equal(requests[0].searchParams.get("extended"), "full,images");
    assert.equal(requests[0].searchParams.get("page"), "2");
    assert.equal(requests[0].searchParams.get("sort_by"), "added");
    assert.equal(requests[0].searchParams.get("sort_how"), "desc");
    assert.equal(result.page, 2);
    assert.equal(result.hasMore, true);
    assert.equal(result.items[0].type, type);
    assert.equal(result.items[0].id, "tt1000001");
    assert.equal(result.items[0].poster, "https://fixture.invalid/poster.jpg");
    assert.equal(result.items[0].background, "https://fixture.invalid/backdrop.jpg");
    assert.equal(result.items[0].logo, "https://fixture.invalid/logo.png");
  }
} finally {
  globalThis.fetch = originalFetch;
  TraktClientSettingsStore.get = originalCredentials;
}
console.log(
  "VIDAA collection checks passed: original video/GIF lifecycle, Trakt movie/series artwork and pagination."
);
