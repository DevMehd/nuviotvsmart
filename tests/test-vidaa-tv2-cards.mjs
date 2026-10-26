import assert from "node:assert/strict";

// New TV Home (nuv-091, lot C4): poster card parity. Image sizes and fallbacks, watched badge,
// landscape posters, collection tile shapes and the current Home's card geometry.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("No network is permitted in this fixture");
};
async function flush() {
  for (let i = 0; i < 64; i++) await Promise.resolve();
}

// Fake DOM, as in test-vidaa-tv2-screen.mjs: one stub per selector, no CSS.
class El {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.props = {};
    this.style = { setProperty: (name, value) => (this.props[name] = value) };
    this.children = [];
    this.kids = new Map();
    this.textContent = "";
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, on) => (on ? set.add(c) : set.delete(c))
    };
  }
  set className(value) {
    value.split(/\s+/).forEach((c) => c && this.classList.add(c));
  }
  set innerHTML(_) {
    this.kids.clear();
  }
  querySelector(selector) {
    if (!this.kids.has(selector)) this.kids.set(selector, new El());
    return this.kids.get(selector);
  }
  querySelectorAll() {
    return [];
  }
  appendChild(node) {
    if (!this.children.includes(node)) this.children.push(node);
    return node;
  }
  remove() {}
  getAttribute(name) {
    return name === "src" ? this.src || null : null;
  }
  removeAttribute() {
    this.src = "";
  }
}
globalThis.document = { createElement: (tag) => new El(tag), documentElement: new El("html") };

const { Router, addonRepository, catalogRepository, LayoutPreferences, CollectionsStore } =
  await import("../js/ui/screens/home/homeScreenContext.js");
const { watchedItemsRepository } = await import("../js/data/repository/watchedItemsRepository.js");
const { Recommendations } = await import("../js/core/perso/personalRecommendations.js");
const { renderContinueWatchingCard, continueCardModel } =
  await import("../js/ui/screens/home/homeScreenHelpers-12-build-hero-indicators.js");
const { createPosterCardMarkup, posterCardModel } =
  await import("../js/ui/screens/home/homeScreenHelpers-15-create-poster-card-markup.js");
const { cardGeometry, rowCardSize } = await import("../js/ui/tv2/railEngine.js");
const { sizedImageUrl, createImageQueue } = await import("../js/ui/tv2/imagePipeline.js");
const { createDomHomeRenderer, cardImage } = await import("../js/ui/tv2/renderer.js");
const { loadHomeRows } = await import("../js/ui/tv2/homeModel.js");

const originals = [];
function replace(object, key, value) {
  originals.push([object, key, object[key]]);
  object[key] = value;
}
replace(Router, "getCurrent", () => "home");

const tmdb = (size, name = "art") => `https://image.tmdb.org/t/p/${size}/${name}.jpg`;

try {
  // Geometry: the current Home's modern formulas (buildModernHomeSizingStyle), 126 dp default.
  const geometry = cardGeometry({});
  assert.deepEqual(geometry.poster, { width: 229, height: 343 });
  assert.deepEqual(geometry.landscape, { width: 419, height: 237 });
  assert.equal(geometry.radius, 24);
  assert.equal(cardGeometry({ posterCardCornerRadiusDp: 4 }).radius, 8);
  assert.equal(geometry.landscapePosters, false);
  assert.equal(
    cardGeometry({ homeLayout: "modern", modernLandscapePostersEnabled: true }).landscapePosters,
    true
  );
  assert.equal(
    cardGeometry({ homeLayout: "classic", modernLandscapePostersEnabled: true }).landscapePosters,
    false,
    "landscape posters are a modern-only preference"
  );
  // One size per row: collection tile shapes, landscape catalog posters.
  assert.deepEqual(rowCardSize({ kind: "poster" }, geometry), geometry.poster);
  // Continue Watching: fixed 419x236 in modern (components-16.css), poster style = poster size.
  assert.deepEqual(rowCardSize({ kind: "continue" }, geometry), { width: 419, height: 236 });
  assert.deepEqual(
    rowCardSize({ kind: "continue" }, cardGeometry({ posterCardWidthDp: 160 })),
    { width: 419, height: 236 },
    "not dp-scaled"
  );
  assert.deepEqual(
    rowCardSize({ kind: "continue" }, cardGeometry({ continueWatchingCardStyle: "wide" })),
    { width: 419, height: 236 },
    "wide renders at the card size on TV"
  );
  assert.deepEqual(
    rowCardSize({ kind: "continue" }, cardGeometry({ continueWatchingCardStyle: "poster" })),
    geometry.poster
  );
  assert.deepEqual(
    rowCardSize({ kind: "collection", tileShape: "POSTER" }, geometry),
    geometry.poster
  );
  assert.deepEqual(
    rowCardSize({ kind: "collection", tileShape: "LANDSCAPE" }, geometry),
    geometry.landscape
  );
  assert.deepEqual(rowCardSize({ kind: "collection", tileShape: "SQUARE" }, geometry), {
    width: 343,
    height: 343
  });
  assert.deepEqual(rowCardSize({ kind: "collection" }, geometry).width, 343, "SQUARE by default");
  const landscapeGeometry = cardGeometry({
    homeLayout: "modern",
    modernLandscapePostersEnabled: true
  });
  assert.deepEqual(rowCardSize({ kind: "poster" }, landscapeGeometry), landscapeGeometry.landscape);

  // Image sizes: anchored TMDB rewrite, never upsized; other URLs untouched.
  const sized = [
    [tmdb("original"), 229, tmdb("w342")],
    [tmdb("w500"), 229, tmdb("w342")],
    [tmdb("w185"), 229, tmdb("w185")],
    [tmdb("w1280"), 419, tmdb("w500")],
    [tmdb("w500"), 1280, tmdb("w500")],
    [tmdb("original"), 1280, tmdb("w1280")]
  ];
  for (const [source, width, expected] of sized)
    assert.equal(sizedImageUrl(source, width), expected, `${source} at ${width}`);
  for (const source of [
    "https://addon.example/image/original/poster.jpg?signature=fixture%2Bvalue&size=1280",
    "https://image.tmdb.org.evil.example/t/p/original/poster.jpg",
    "https://proxy.example/?url=https://image.tmdb.org/t/p/original/poster.jpg",
    "https://image.tmdb.org/proxy?image=/t/p/original/poster.jpg",
    "data:image/png;base64,fixture"
  ])
    assert.equal(sizedImageUrl(source, 229), source, "foreign URLs stay byte-identical");

  // Queue: a failed image tries its fallbacks in the same slot; the focused card goes first.
  const fake = () => {
    const node = new El("img");
    Object.defineProperty(node, "src", {
      get: () => node.attr || "",
      set: (value) => (node.attr = value)
    });
    node.getAttribute = (name) => (name === "src" ? node.attr || null : null);
    node.removeAttribute = () => (node.attr = "");
    return node;
  };
  const queue = createImageQueue({ concurrency: 1 });
  const [a, b, c] = [fake(), fake(), fake()];
  queue.request(a, "a.jpg", { fallbacks: ["a-raw.jpg"] });
  queue.request(b, "b.jpg");
  queue.request(c, "c.jpg", { priority: true });
  assert.equal(a.src, "a.jpg");
  a.onerror();
  assert.equal(a.src, "a-raw.jpg", "the fallback reuses the freed slot");
  assert.equal(c.src, "", "one image at a time");
  a.onload();
  assert.equal(c.src, "c.jpg", "the focused card jumps the queue");
  queue.request(a, "a.jpg", { fallbacks: ["a-raw.jpg"] });
  assert.equal(queue.pendingCount, 1, "a fallen-back card is not re-requested on every frame");
  c.onerror();
  assert.equal(b.src, "b.jpg", "no fallback left: the slot moves on");
  queue.clear();

  // posterCardModel is the current Home card's own image/watched logic.
  const watchedTitleIds = new Set(["tt1"]);
  const item = { id: "tt1", name: "Dune", type: "movie", poster: tmdb("original", "p") };
  const markup = createPosterCardMarkup(
    item,
    0,
    0,
    "movie",
    null,
    true,
    "modern",
    false,
    false,
    false,
    watchedTitleIds
  );
  const model = posterCardModel(item, null, {
    itemType: "movie",
    layoutMode: "modern",
    watchedTitleIds
  });
  assert.ok(markup.includes(`data-poster-src="${model.posterSrc}"`));
  assert.ok(markup.includes(`data-src="${model.cardPosterSrc}"`));
  assert.equal(model.watched, true);
  assert.match(markup, /title-watched-badge/);
  assert.equal(posterCardModel({ ...item, id: "tt2" }, null, { watchedTitleIds }).watched, false);

  // cardImage: catalog chain with the custom poster's original as fallback; folders use covers.
  const custom = {
    customPosterUrlPattern: "https://cp.invalid/{imdb_id}.jpg",
    customPosterEnabledScreens: ["home"]
  };
  const poster = cardImage({ kind: "poster" }, item, geometry.poster, custom);
  assert.equal(poster.url, "https://cp.invalid/tt1.jpg");
  assert.deepEqual(poster.fallbacks, [tmdb("w342", "p")]);
  assert.equal(
    cardImage({ kind: "poster" }, { id: "x", thumbnail: tmdb("w500", "t") }, geometry.poster, {})
      .url,
    tmdb("w342", "t"),
    "same fallback order as the current Home"
  );
  const landscape = cardImage(
    { kind: "poster" },
    { ...item, background: tmdb("w780", "b") },
    geometry.landscape,
    {}
  );
  assert.equal(landscape.url, tmdb("w500", "b"), "landscape cards use the backdrop chain");
  assert.equal(
    cardImage(
      { kind: "collection" },
      { coverImageUrl: tmdb("original", "cover") },
      { width: 343 },
      {}
    ).url,
    tmdb("w500", "cover")
  );

  // Renderer: watched badge follows setWatched; collection and landscape rows use their own size.
  const container = new El();
  const requests = [];
  const imageQueue = { request: (node, url, options) => requests.push({ node, url, options }) };
  const view = createDomHomeRenderer(container, {
    geometry: landscapeGeometry,
    imageQueue,
    layout: { homeLayout: "modern", modernLandscapePostersEnabled: true }
  });
  const root = container.querySelector(".tv2-home");
  assert.equal(root.props["--tv2-card-radius"], "24px");
  const rows = [
    {
      key: "cat",
      kind: "poster",
      title: "Cat",
      status: "success",
      items: [
        { ...item, logo: "https://logo.invalid/l.png", releaseInfo: "2021" },
        { id: "tt9", name: "Other", type: "movie", poster: tmdb("w500", "o") }
      ]
    },
    {
      key: "col",
      kind: "collection",
      title: "Col",
      status: "success",
      tileShape: "SQUARE",
      items: [{ id: "collection:c:f", type: "collection_folder", coverEmoji: "🎬", name: "F" }]
    }
  ];
  const focus = { row: 0, columns: {} };
  view.setRows(rows);
  view.update(rows, focus);
  const first = container.querySelector(".tv2-rows").children[0].querySelector(".tv2-track")
    .children[0];
  assert.equal(first.style.width, "419px", "landscape catalog card");
  assert.ok(first.classList.contains("is-landscape"));
  assert.equal(
    first.querySelector(".tv2-card-title").textContent,
    "",
    "no title on modern posters (D2)"
  );
  assert.equal(first.querySelector(".tv2-card-overlay-subtitle").textContent, "2021");
  assert.ok(
    requests.some((r) => r.url === "https://logo.invalid/l.png"),
    "the logo goes through the image queue"
  );
  assert.equal(
    requests.find((r) => r.node === first.querySelector(".tv2-card-image")).options.priority,
    true
  );
  assert.equal(first.classList.contains("is-watched"), false);
  view.setWatched(watchedTitleIds);
  view.update(rows, focus);
  assert.equal(first.classList.contains("is-watched"), true, "badge shown after setWatched");
  view.setWatched(new Set());
  view.update(rows, focus);
  assert.equal(first.classList.contains("is-watched"), false, "badge hidden again");
  // Same row key and index, new item (Continue Watching enrichment, recommendations refresh).
  const firstImage = first.querySelector(".tv2-card-image");
  rows[0] = {
    ...rows[0],
    items: [{ ...rows[0].items[0], id: "tt3", background: tmdb("w780", "new") }, rows[0].items[1]]
  };
  view.setRows(rows);
  view.update(rows, focus);
  assert.equal(
    requests.filter((r) => r.node === firstImage).at(-1).url,
    tmdb("w500", "new"),
    "a replaced item refills its card"
  );
  assert.equal(first.dataset.itemId, "tt3", "openDetail reads the new item");
  const folder = container.querySelector(".tv2-rows").children[1].querySelector(".tv2-track")
    .children[0];
  assert.equal(folder.style.width, "343px");
  assert.equal(folder.style.height, "343px", "SQUARE tile");
  assert.equal(folder.querySelector(".tv2-card-title").textContent, "🎬", "emoji cover");

  // C5: continueCardModel is the current Home Continue Watching card's own content.
  const day = 86400000;
  const cwItems = [
    {
      contentId: "tt5",
      type: "movie",
      title: "Heat",
      positionMs: 3000000,
      durationMs: 6000000,
      backdrop: tmdb("w1280", "hb"),
      poster: tmdb("original", "hp")
    },
    {
      contentId: "tt6",
      type: "series",
      title: "Show",
      season: 1,
      episode: 2,
      episodeTitle: "Pilot 2",
      isNextUp: true,
      thumbnail: tmdb("w300", "ep"),
      backdrop: tmdb("w780", "sb"),
      poster: tmdb("w500", "sp")
    },
    {
      contentId: "tt7",
      type: "series",
      title: "Soon",
      season: 2,
      episode: 1,
      isNextUp: true,
      released: new Date(Date.now() + 10 * day).toISOString(),
      backdrop: tmdb("w780", "soon")
    }
  ];
  const text = (markup, cls) => markup.match(new RegExp(`class="${cls}"[^>]*>([^<]*)<`))?.[1] ?? "";
  for (const options of [{}, { cardStyle: "poster" }, { blurNextUp: true }]) {
    for (const cwItem of cwItems) {
      const cwMarkup = renderContinueWatchingCard(cwItem, 0, options);
      const cw = continueCardModel(cwItem, options);
      const label = `${cwItem.title} ${JSON.stringify(options)}`;
      assert.equal(cwMarkup.match(/\s(?:data-)?src="([^"]+)"/)?.[1], cw.image, label);
      assert.equal(text(cwMarkup, "home-continue-badge"), cw.badge, label);
      assert.equal(text(cwMarkup, "home-continue-kicker"), cw.kicker, label);
      assert.equal(text(cwMarkup, "home-continue-title"), cw.title, label);
      assert.equal(text(cwMarkup, "home-continue-subtitle"), cw.subtitle, label);
      assert.ok(cwMarkup.includes(`width:${cw.progressPct}%`), label);
      assert.equal(cwMarkup.includes("home-continue-card-blur-next-up"), cw.blur, label);
    }
  }
  const heat = continueCardModel(cwItems[0], {});
  assert.equal(heat.progressPct, 50, "round(progressFraction * 100)");
  assert.equal(continueCardModel(cwItems[1], { blurNextUp: true }).blur, true);
  assert.equal(
    continueCardModel(cwItems[1], { blurNextUp: true, cardStyle: "poster" }).blur,
    false,
    "poster style uses no episode thumbnail, so no spoiler blur"
  );

  // Renderer: badge, kicker, title, subtitle, progress and blur on pooled continue cards.
  const cwRequests = [];
  const cwContainer = new El();
  const cwView = createDomHomeRenderer(cwContainer, {
    geometry,
    imageQueue: { request: (node, url, options) => cwRequests.push({ node, url, options }) },
    layout: { homeLayout: "modern", blurContinueWatchingNextUp: true }
  });
  let cwRows = [{ key: "continue_watching", kind: "continue", title: "CW", items: cwItems }];
  cwView.setRows(cwRows);
  cwView.update(cwRows, { row: 0, columns: {} });
  const cwTrack = cwContainer.querySelector(".tv2-rows").children[0].querySelector(".tv2-track");
  const [heatCard, showCard] = cwTrack.children;
  assert.equal(heatCard.style.width, "419px");
  assert.equal(heatCard.style.height, "236px");
  assert.equal(heatCard.querySelector(".tv2-cw-badge").textContent, heat.badge);
  assert.equal(heatCard.querySelector(".tv2-card-title").textContent, "Heat");
  assert.equal(heatCard.querySelector(".tv2-cw-progress span").style.width, "50%");
  assert.equal(showCard.querySelector(".tv2-cw-kicker").textContent, "S1 E2");
  assert.equal(showCard.querySelector(".tv2-cw-subtitle").textContent, "Pilot 2");
  assert.ok(showCard.classList.contains("home-continue-card-blur-next-up"), "Next Up blur");
  assert.equal(heatCard.classList.contains("home-continue-card-blur-next-up"), false);
  const heatImage = cwRequests.find((r) => r.node === heatCard.querySelector(".tv2-card-image"));
  assert.equal(heatImage.url, tmdb("w500", "hb"), "backdrop at the card size");
  assert.deepEqual(heatImage.options.fallbacks, [tmdb("w500", "hp")]);
  // Release labels depend on time: every emit refills the visible continue cards.
  heatCard.querySelector(".tv2-cw-badge").textContent = "stale";
  cwView.update(cwRows, { row: 0, columns: {} });
  assert.equal(heatCard.querySelector(".tv2-cw-badge").textContent, "stale", "no refill on moves");
  cwRows = [{ ...cwRows[0] }];
  cwView.setRows(cwRows);
  cwView.update(cwRows, { row: 0, columns: {} });
  assert.equal(heatCard.querySelector(".tv2-cw-badge").textContent, heat.badge, "refilled");
  // Poster style: poster size and poster artwork.
  const posterContainer = new El();
  const posterView = createDomHomeRenderer(posterContainer, {
    geometry: cardGeometry({ continueWatchingCardStyle: "poster" }),
    imageQueue: { request: (node, url) => cwRequests.push({ node, url }) },
    layout: { continueWatchingCardStyle: "poster" }
  });
  posterView.setRows(cwRows);
  posterView.update(cwRows, { row: 0, columns: {} });
  const posterCard = posterContainer
    .querySelector(".tv2-rows")
    .children[0].querySelector(".tv2-track").children[0];
  assert.equal(posterCard.style.height, "343px");
  assert.equal(
    cwRequests.find((r) => r.node === posterCard.querySelector(".tv2-card-image")).url,
    tmdb("w342", "hp")
  );

  // Model: watched title ids come with the rows, the base set first.
  replace(LayoutPreferences, "get", () => ({
    homeLayout: "modern",
    continueWatchingEnabled: false
  }));
  replace(CollectionsStore, "get", () => []);
  replace(addonRepository, "getInstalledAddons", async () => [
    {
      id: "alpha",
      baseUrl: "https://alpha.invalid",
      displayName: "Alpha",
      catalogs: [{ id: "c0", name: "c0", apiType: "movie" }]
    }
  ]);
  replace(catalogRepository, "getCatalog", async () => ({
    status: "success",
    data: { items: [item] }
  }));
  replace(watchedItemsRepository, "getAll", async () => [
    { contentId: "tt1", contentType: "movie" }
  ]);
  replace(Recommendations, "refresh", async () => {});
  const watchedSets = [];
  await loadHomeRows({ onRows: () => {}, onWatched: (ids) => watchedSets.push(ids) });
  await flush();
  assert.ok(watchedSets.length >= 1, "watched ids published");
  assert.ok(watchedSets.at(-1).has("tt1"));
  assert.equal(
    new Set(watchedSets.map((ids) => [...ids].sort().join())).size,
    watchedSets.length,
    "an unchanged set is not published twice"
  );
} finally {
  for (const [object, name, value] of originals.reverse()) object[name] = value;
}

console.log(
  "PASS: new TV Home poster cards match the current Home (sizes, fallbacks, watched badge, shapes)"
);
