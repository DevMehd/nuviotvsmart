import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { Platform } = await import("../js/platform/index.js");
const { limitTmdbImageWidth } = await import("../js/core/tmdb/tmdbImageUrl.js");
const { createPosterCardMarkup } =
  await import("../js/ui/screens/home/homeScreenHelpers-15-create-poster-card-markup.js");

const tmdb = (size, name = "artwork") => `https://image.tmdb.org/t/p/${size}/${name}.jpg`;
const item = {
  id: "fixture-title",
  name: "Title",
  type: "movie",
  poster: tmdb("original", "poster"),
  background: tmdb("w780", "backdrop"),
  landscapePoster: tmdb("w1280", "landscape")
};

function render(
  platform,
  content = item,
  { layout = "modern", landscape = false, defer = false } = {}
) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  Platform.current = null;
  return createPosterCardMarkup(
    content,
    0,
    0,
    "movie",
    null,
    true,
    layout,
    false,
    landscape,
    defer
  );
}

function imageSource(markup, className) {
  const image = markup.match(new RegExp(`<img class="${className}"[^>]+>`))?.[0];
  assert.ok(image, `Artwork ${className} is rendered`);
  return image.match(/\s(?:data-)?src="([^"]+)"/)?.[1];
}

for (const layout of ["classic", "grid", "modern"]) {
  for (const defer of [false, true]) {
    const before = render("browser", item, { layout, defer });
    const after = render("vidaa", item, { layout, defer });
    assert.equal(imageSource(before, "content-poster"), tmdb("w500", "poster"));
    assert.equal(imageSource(after, "content-poster"), tmdb("w342", "poster"));
    assert.match(after, /data-vidaa-recyclable-card="true"/);
    assert.doesNotMatch(before, /data-vidaa-recyclable-card/);
    assert.equal(
      imageSource(after, "home-poster-expanded-backdrop"),
      imageSource(before, "home-poster-expanded-backdrop"),
      `${layout}: expansion preserves its full-size image`
    );
    assert.match(after, /data-poster-src="https:\/\/image\.tmdb\.org\/t\/p\/w500\/poster.jpg"/);
    assert.match(
      after,
      /data-backdrop-src="https:\/\/image\.tmdb\.org\/t\/p\/w1280\/landscape.jpg"/
    );
    assert.match(
      after,
      /class="content-poster" data-src=/,
      "Initial VIDAA cards must not bypass the shared load budget"
    );
    assert.match(before, new RegExp(`class="content-poster" ${defer ? "data-src" : "src"}=`));
  }
}

for (const defer of [false, true]) {
  const options = { landscape: true, defer };
  const before = render("browser", item, options);
  const after = render("vidaa", item, options);
  assert.equal(imageSource(before, "content-poster"), tmdb("w1280", "landscape"));
  assert.equal(imageSource(after, "content-poster"), tmdb("w500", "landscape"));
  assert.equal(imageSource(after, "home-poster-expanded-backdrop"), tmdb("w1280", "landscape"));
  assert.match(after, /data-poster-src="https:\/\/image\.tmdb\.org\/t\/p\/w1280\/landscape.jpg"/);
}

// Missing posters and landscape art still follow the existing fallback order;
// the selected source is capped regardless of which field supplied it.
assert.equal(
  imageSource(
    render("vidaa", { ...item, poster: null, thumbnail: tmdb("w1280", "thumbnail") }),
    "content-poster"
  ),
  tmdb("w342", "thumbnail")
);
assert.equal(
  imageSource(
    render("vidaa", { ...item, landscapePoster: null }, { landscape: true }),
    "content-poster"
  ),
  tmdb("w500", "backdrop")
);
assert.equal(
  imageSource(render("vidaa", { ...item, poster: tmdb("w185", "small") }), "content-poster"),
  tmdb("w185", "small"),
  "Card sizing must not upscale smaller source artwork"
);

for (const tileShape of ["POSTER", "SQUARE", "LANDSCAPE"]) {
  const collection = {
    collectionId: "fixture-collection",
    folderId: "fixture-folder",
    title: "Collection",
    tileShape,
    coverImageUrl: tmdb("w1280", "collection"),
    heroBackdropUrl: tmdb("w1280", "collection-hero")
  };
  const markup = render("vidaa", collection);
  assert.doesNotMatch(
    markup,
    /data-vidaa-recyclable-card/,
    "Collection media is excluded from subtree recycling"
  );
  assert.equal(
    imageSource(markup, "content-poster"),
    tmdb(tileShape === "POSTER" ? "w342" : "w500", "collection")
  );
  assert.match(
    markup,
    /data-backdrop-src="https:\/\/image\.tmdb\.org\/t\/p\/w1280\/collection-hero.jpg"/
  );
}
assert.doesNotMatch(render("vidaa", { ...item, isLoading: true }), /data-vidaa-recyclable-card/);

// Never guess parameters for another provider or rewrite a TMDB URL that is
// merely embedded in a query. In particular, signed URLs remain unchanged.
for (const source of [
  "https://addon.example/image/original/poster.jpg?signature=fixture%2Bvalue&size=1280",
  "https://image.tmdb.org.evil.example/t/p/original/poster.jpg",
  "https://proxy.example/?url=https://image.tmdb.org/t/p/original/poster.jpg",
  "https://image.tmdb.org/proxy?image=/t/p/original/poster.jpg",
  "data:image/png;base64,fixture"
]) {
  assert.equal(limitTmdbImageWidth(source, 342), source);
  const markup = render("vidaa", { ...item, poster: source });
  assert.equal(imageSource(markup, "content-poster").replaceAll("&amp;", "&"), source);
}

console.log(
  "PASS: VIDAA Home cards cap TMDB pixels by artwork role; eager/deferred loads, fallback order, hero/expanded images and signed external URLs are preserved."
);
