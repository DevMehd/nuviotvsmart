import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { continueWatchingImageSources } = await import("../js/core/util/continueWatchingImage.js");
const { limitTmdbImageWidth, normalizeTmdbBackdropUrl } =
  await import("../js/core/tmdb/tmdbImageUrl.js");
const { Platform } = await import("../js/platform/index.js");
const { renderContinueWatchingCard } =
  await import("../js/ui/screens/home/homeScreenHelpers-12-build-hero-indicators.js");

const tmdb = (size, name) => `https://image.tmdb.org/t/p/${size}/${name}.jpg`;
const art = {
  poster: tmdb("original", "poster"),
  backdrop: tmdb("w780", "backdrop"),
  thumbnail: tmdb("w1280", "next-episode"),
  episodeThumbnail: tmdb("w780", "episode")
};

// The cap applies to the complete fallback chain while retaining selection
// semantics for series, movies, poster cards and unreleased next-up episodes.
assert.deepEqual(continueWatchingImageSources(art, { maxTmdbWidth: 500 }), [
  tmdb("w500", "episode"),
  tmdb("w500", "backdrop"),
  tmdb("w500", "poster")
]);
assert.deepEqual(continueWatchingImageSources(art, { maxTmdbWidth: 500, isSeries: false }), [
  tmdb("w500", "backdrop"),
  tmdb("w500", "poster")
]);
assert.deepEqual(
  continueWatchingImageSources(art, { maxTmdbWidth: 500, isNextUp: true, hasAired: false }),
  [tmdb("w500", "backdrop"), tmdb("w500", "poster"), tmdb("w500", "next-episode")]
);
assert.deepEqual(continueWatchingImageSources(art, { maxTmdbWidth: 500, cardStyle: "poster" }), [
  tmdb("w500", "poster"),
  tmdb("w500", "backdrop")
]);
assert.deepEqual(continueWatchingImageSources(art), [
  art.episodeThumbnail,
  art.backdrop,
  art.poster
]);

// Artwork smaller than a card's budget, query strings, and unrelated providers
// must survive unchanged. Do not match a TMDB URL embedded in another URL.
for (const source of [
  tmdb("w300", "small"),
  tmdb("w500", "already-sized"),
  "https://addon.example/t/p/original/image.jpg?x=1&y=2",
  "https://image.tmdb.org.evil.example/t/p/original/image.jpg",
  "https://proxy.example/?url=https://image.tmdb.org/t/p/original/image.jpg",
  "data:image/png;base64,fixture",
  undefined
]) {
  assert.equal(limitTmdbImageWidth(source, 500), source);
}
assert.equal(
  limitTmdbImageWidth(`${tmdb("original", "query")}?a=1&b=2`, 500),
  `${tmdb("w500", "query")}?a=1&b=2`
);
assert.equal(
  limitTmdbImageWidth("//image.tmdb.org/t/p/w1280/protocol-relative.jpg", 500),
  "//image.tmdb.org/t/p/w500/protocol-relative.jpg"
);
assert.equal(
  limitTmdbImageWidth(art.poster, 499),
  art.poster,
  "Do not generate unsupported TMDB widths"
);
assert.equal(
  normalizeTmdbBackdropUrl(art.backdrop),
  tmdb("w1280", "backdrop"),
  "Full-screen hero retains its existing artwork policy"
);

function renderedSources(platform, item, options = {}) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  Platform.current = null;
  const markup = renderContinueWatchingCard(item, 0, options);
  const image = markup.match(/<img class="home-continue-bg"[^>]+>/)?.[0];
  assert.ok(image, "Continue Watching renders artwork");
  const source = image.match(/\s(?:data-)?src="([^"]+)"/)?.[1];
  const fallbacks = image.match(/data-fallback-srcs="([^"]+)"/)?.[1] || "";
  return [source, ...fallbacks.split("|").filter(Boolean).map(decodeURIComponent)];
}

const episode = { contentId: "tt01", title: "Episode", type: "series", ...art };
assert.deepEqual(renderedSources("vidaa", episode), [
  tmdb("w500", "episode"),
  tmdb("w500", "backdrop"),
  tmdb("w500", "poster")
]);
assert.deepEqual(renderedSources("browser", episode), [
  tmdb("w1280", "episode"),
  tmdb("w1280", "backdrop"),
  tmdb("w1280", "poster")
]);
assert.deepEqual(renderedSources("vidaa", episode, { cardStyle: "poster" }), [
  tmdb("w500", "poster"),
  tmdb("w500", "backdrop")
]);
assert.deepEqual(
  renderedSources("vidaa", { ...episode, episodeThumbnail: tmdb("w300", "small") }),
  [tmdb("w300", "small"), tmdb("w500", "backdrop"), tmdb("w500", "poster")]
);
assert.deepEqual(
  renderedSources("vidaa", {
    ...episode,
    episodeThumbnail: tmdb("w780", "same"),
    backdrop: tmdb("w1280", "same")
  }),
  [tmdb("w500", "same"), tmdb("w500", "poster")],
  "Collapsed sizes do not create duplicate fallback retries"
);

console.log(
  "PASS: VIDAA Continue Watching limits TMDB pixels without changing source order, hero images, or other platforms."
);
