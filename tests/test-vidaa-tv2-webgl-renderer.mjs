import assert from "node:assert/strict";

// WebGL Home images (lot W1a) on a fake Lightning node: the queue slot is held until Lightning's
// loaded/failed, a failure tries the next fallback then shows the text tile, a node is never
// visible without a URL, and the hero node is cropped as cover in the DOM hero's rectangle.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
const rootClasses = new Set();
globalThis.document = {
  documentElement: {
    dataset: {},
    style: { setProperty() {} },
    classList: {
      contains: (name) => rootClasses.has(name),
      toggle() {},
      add() {},
      remove() {}
    }
  }
};
let reducedMotion = false;
globalThis.matchMedia = () => ({ matches: reducedMotion });

const { imageSlot, heroNodeProps, glInfo, homeMotion, tween, settle } =
  await import("../js/ui/tv2/render/lightning/lightningHomeRenderer.js");
const { createImageQueue } = await import("../js/ui/tv2/imagePipeline.js");
const { createHeroCopy, heroCopyLines, HERO_COPY } =
  await import("../js/ui/tv2/render/lightning/heroCopy.js");
const { glText, CHARSET, ATLAS_WEIGHTS, atlasUrls } =
  await import("../js/ui/tv2/render/lightning/sdfAtlas.js");
const { buildSdfAtlas } = await import("../scripts/build-sdf-atlas.mjs");
const { buildModernHeroPresentation } =
  await import("../js/ui/screens/home/homeScreenHelpers-11-build-hero-display-model.js");
const { readFile } = await import("node:fs/promises");
const setting = await import("../js/ui/tv2/newHomeSetting.js");
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

// Like a Lightning CoreNode: each src gets its own texture, whose events stop at the next src;
// the same src again is ignored; renderState 2 is OutOfBounds.
function fakeNode() {
  const listeners = {};
  const node = {
    alpha: 1,
    renderState: 4,
    texture: null,
    textures: 0,
    props: { src: null },
    on: (event, fn) => (listeners[event] = listeners[event] || []).push(fn),
    emit: (event) => (listeners[event] || []).forEach((fn) => fn(node, {})),
    get src() {
      return node.props.src;
    },
    set src(url) {
      if (node.props.src === url) return;
      node.props.src = url;
      node.texture = url ? { url } : null;
      if (url) node.textures += 1;
    },
    // The texture of `url` reports `event` only while it is still the node's texture.
    finish(url, event) {
      if (node.texture?.url === url) node.emit(event);
    }
  };
  return node;
}

const visibleWithoutUrl = (node) => node.alpha > 0 && !node.src;

// Fallbacks then the tile.
{
  const node = fakeNode();
  const states = [];
  const slot = imageSlot(node, 1, (state) => states.push(state));
  assert.equal(node.alpha, 0, "no texture, no paint (Lightning paints it white)");
  const queue = createImageQueue();
  queue.request(slot, "/a.jpg", { fallbacks: ["/b.jpg"] });
  assert.equal(node.src, "/a.jpg");
  assert.equal(node.alpha, 1, "visible with a URL: Lightning only loads visible nodes");
  node.finish("/a.jpg", "failed");
  assert.equal(node.src, "/b.jpg", "next fallback in the same slot");
  node.finish("/a.jpg", "loaded");
  assert.deepEqual(states, ["loading", "loading"], "a late event of the old texture is ignored");
  node.finish("/b.jpg", "failed");
  assert.deepEqual(states, ["loading", "loading", "failed"], "text tile after the last one");
  queue.request(slot, "/a.jpg", { fallbacks: ["/b.jpg"] });
  assert.equal(node.src, "/b.jpg", "a failed card is not reloaded on every move");
  queue.request(slot, "");
  assert.equal(node.alpha, 0);
  assert.equal(states.at(-1), "empty");
  assert.equal(glInfo(), null, "no engine in node");
}

// At most 3 loads at once, the focused card first, a slot freed by loaded or by leaving bounds.
{
  const queue = createImageQueue();
  const nodes = Array.from({ length: 5 }, fakeNode);
  const slots = nodes.map((node) => imageSlot(node));
  slots.forEach((slot, index) => queue.request(slot, `/${index}.jpg`));
  const focused = fakeNode();
  queue.request(imageSlot(focused), "/focused.jpg", { priority: true });
  assert.deepEqual(
    nodes.map((node) => node.src),
    ["/0.jpg", "/1.jpg", "/2.jpg", null, null],
    "three in flight until Lightning answers"
  );
  assert.equal(queue.pendingCount, 3);
  nodes[0].finish("/0.jpg", "loaded");
  assert.equal(focused.src, "/focused.jpg", "the focused card goes first");
  nodes[1].renderState = 2;
  nodes[1].emit("outOfBounds");
  assert.equal(nodes[1].src, null, "out of bounds before loading: slot given back");
  assert.equal(nodes[1].alpha, 0);
  assert.equal(nodes[3].src, "/3.jpg");
  // Already outside the bounds when its turn comes: given back without waiting for an event.
  nodes[4].renderState = 2;
  nodes[2].finish("/2.jpg", "loaded");
  assert.equal(nodes[4].src, "/4.jpg");
  await flush();
  assert.equal(nodes[4].src, null);
  nodes[4].renderState = 4;
  queue.request(slots[4], "/4.jpg");
  assert.equal(nodes[4].src, "/4.jpg", "requested again by the next update");
  assert.equal(nodes.some(visibleWithoutUrl), false);
  // The same URL again re-attaches the texture, so Lightning reports for it (no stuck slot).
  const node = nodes[0];
  const before = node.textures;
  slots[0].src = "/0.jpg";
  assert.equal(node.textures, before + 1);
}

// Hero: the modern hero media rectangle, cover from the top right; full screen when enabled.
assert.deepEqual(heroNodeProps(), {
  x: 594,
  y: 0,
  w: 1382,
  h: 650,
  textureOptions: { resizeMode: { type: "cover", clipX: 1, clipY: 0 } }
});
assert.deepEqual(
  (({ x, y, w, h }) => [x, y, w, h])(heroNodeProps({ modernHeroFullScreenBackdropEnabled: true })),
  [0, 0, 1920, 1080]
);

// Motion (lot W2): the DOM renderer's durations and curves, none under reduced motion.
{
  const domRoot = { animate() {} };
  const rail = { duration: 140, easing: "cubic-bezier(0.33, 0, 0.67, 1)" };
  const still = { rail: null, scale: null, hero: null, copy: null };
  assert.deepEqual(homeMotion(domRoot), still, "off VIDAA");
  rootClasses.add("vidaa-tv").add("vidaa-balanced-motion");
  assert.deepEqual(homeMotion(domRoot), {
    rail,
    scale: { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    hero: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    copy: { duration: 150, easing: "cubic-bezier(0.2, 0, 0, 1)" }
  });
  rootClasses.add("performance-constrained");
  assert.equal(homeMotion(domRoot).rail.duration, 100);
  reducedMotion = true;
  assert.deepEqual(homeMotion(domRoot), still, "reduced motion");
  reducedMotion = false;

  // Like Lightning: animate() hands out a pooled controller, stop(reset) emits "stopped".
  const calls = [];
  const node = {
    x: 0,
    animate(props, settings) {
      const listeners = [];
      const ctrl = {
        stopped: false,
        start: () => calls.push(["start", props.x, settings]),
        stop(reset) {
          calls.push(["stop", reset]);
          ctrl.stopped = true;
          listeners.splice(0).forEach((fn) => fn());
        },
        once: (event, fn) => event === "stopped" && listeners.push(fn),
        finish() {
          Object.assign(node, props);
          listeners.splice(0).forEach((fn) => fn());
        }
      };
      node.ctrl = ctrl;
      return ctrl;
    }
  };
  tween(node, "x", -100, rail);
  assert.deepEqual(calls, [["start", -100, rail]]);
  tween(node, "x", -100, rail);
  assert.equal(calls.length, 1, "the same target never restarts the slide");
  const first = node.ctrl;
  tween(node, "x", -200, rail);
  assert.deepEqual(
    calls.slice(1),
    [
      ["stop", false],
      ["start", -200, rail]
    ],
    "stopped in place"
  );
  assert.equal(first.stopped, true);
  node.ctrl.finish();
  tween(node, "x", -300, rail);
  assert.deepEqual(
    calls.slice(3),
    [["start", -300, rail]],
    "a finished (pooled) one is not stopped"
  );
  let done = 0;
  tween(node, "x", 40, null, () => (done += 1));
  assert.deepEqual(calls.slice(4), [["stop", false]], "no settings: set at once");
  assert.equal(node.x, 40);
  assert.equal(done, 1);
  tween(node, "x", 40, rail, () => (done += 1));
  assert.equal(calls.length, 5, "already there: no animation");
  assert.equal(done, 2);
  // An interrupted hero fade ends at its target, never stuck half-faded over the background.
  tween(node, "x", 90, rail, () => (done += 1));
  node.x = 60;
  settle(node);
  assert.equal(node.x, 90, "settled at the target");
  assert.equal(done, 3);
  settle(node);
  assert.equal(done, 3, "nothing left to settle");
  rootClasses.clear();
}

// Lot W3: hero copy on fake Lightning nodes. Text nodes report their size on "loaded".
{
  const made = [];
  function glNode(props = {}) {
    const listeners = {};
    const node = {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      alpha: 1,
      renderState: 4,
      children: [],
      parent: null,
      texture: null,
      props: { src: null },
      on: (event, fn) => (listeners[event] = listeners[event] || []).push(fn),
      emit: (event, payload = {}) => (listeners[event] || []).forEach((fn) => fn(node, payload)),
      get src() {
        return node.props.src;
      },
      set src(url) {
        if (node.props.src === url) return;
        node.props.src = url;
        node.texture = url ? { url, dimensions: null } : null;
      },
      // Like Lightning: only the current texture reports to the node.
      finish(url, event, dimensions) {
        if (node.texture?.url !== url) return;
        node.texture.dimensions = dimensions;
        node.emit(event, { dimensions });
      },
      destroy() {
        node.destroyed = true;
        node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      }
    };
    const { parent, ...rest } = props;
    Object.assign(node, rest);
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    }
    made.push(node);
    return node;
  }
  const copy = createHeroCopy({
    parent: glNode(),
    node: glNode,
    text: ({ weight, ...props }) => Object.assign(glNode(props), { weight }),
    shader: (props) => ({ shader: props }),
    slot: imageSlot,
    tween,
    settle,
    colors: { text: 1, secondary: 2, dot: 3, badge: 4 },
    fade: null
  });
  const textsIn = (node) =>
    [node, ...node.children.flatMap(textsIn)].filter((child) => typeof child.text === "string");
  // Every text reports 10 px per character; lines are 40 px, the title 76, the description `lines` × 36.
  const report = (lines = 2) =>
    textsIn(copy.block).forEach((node) =>
      node.emit("loaded", {
        type: "text",
        dimensions: {
          w: node.text.length * 10,
          h: node === copy.parts().description ? lines * 36 : node === copy.parts().title ? 76 : 40
        }
      })
    );
  const tokenTexts = (line) => line.tokens.map((entry) => entry.texts.map((node) => node.text));

  const movie = buildModernHeroPresentation({
    id: "tt1",
    type: "movie",
    name: "Movie",
    imdbRating: "7.8",
    genres: ["Drama"],
    runtime: "120 min",
    releaseInfo: "2020",
    description: "A description",
    logo: "https://example.test/logo.png"
  });
  assert.deepEqual(
    heroCopyLines(movie).primary.map((token) => token.type),
    ["text", "text", "text", "text", "imdb"],
    "a movie without badges keeps IMDb on the first line"
  );
  copy.set(movie);
  assert.equal(copy.block.alpha, 0, "hidden until every text is measured");
  const { primary, secondary, title, description } = copy.parts();
  assert.equal(secondary, null);
  assert.deepEqual(tokenTexts(primary), [
    [movie.leadingMeta[0]],
    ["Drama"],
    ["2h"],
    ["2020"],
    ["7.8"]
  ]);
  assert.equal(title.weight, 600, "title and meta in the 600 atlas");
  assert.equal(description.weight, 400);
  report();
  assert.equal(copy.block.alpha, 1, "shown once laid out");
  // Tokens and dots: 14 px, 6 px dot, 14 px.
  const widths = primary.tokens.map((entry) => entry.texts[0].text.length * 10);
  const step = 2 * HERO_COPY.gap + HERO_COPY.dot;
  assert.equal(primary.tokens[1].group.x, widths[0] + step);
  assert.equal(primary.dots[0].x, widths[0] + HERO_COPY.gap);
  assert.equal(
    primary.tokens[4].texts[0].x,
    HERO_COPY.imdb.w + HERO_COPY.imdb.gap,
    "value after the IMDb logo"
  );
  assert.equal(primary.tokens[4].texts[0].color, HERO_COPY.imdb.color);
  // Bottom-up: description (2 lines), 20, primary, 28, title.
  assert.equal(description.y, 486 - 72);
  assert.equal(primary.group.y, 486 - 72 - 20 - 40);
  assert.equal(title.y, 486 - 72 - 20 - 40 - 28 - 76);
  assert.equal(title.alpha, 1, "title until the logo is ready");
  // A one-line description moves everything above it down by one line.
  description.text = "Short";
  description.emit("loaded", { dimensions: { w: 50, h: 36 } });
  assert.equal(title.y, 486 - 36 - 20 - 40 - 28 - 76, "title y follows the description height");

  // Logo: fitted in 600×230 without distortion, bottom left; the title hides, then returns on failure.
  const { logo } = copy;
  assert.equal(logo.src, "https://example.test/logo.png");
  logo.finish("https://example.test/logo.png", "loaded", { w: 1000, h: 200 });
  assert.deepEqual([logo.w, logo.h], [600, 120]);
  assert.equal(title.alpha, 0, "title hidden behind the loaded logo");
  assert.equal(logo.y, 486 - 36 - 20 - 40 - 28 - 120);
  assert.equal(logo.alpha, 1);
  copy.set({ ...movie, logo: "https://example.test/other.png" });
  assert.equal(copy.parts().title, title, "same copy: nodes kept");
  assert.equal(title.alpha, 1, "a new logo shows the title until it is ready");
  logo.finish("https://example.test/logo.png", "loaded", { w: 10, h: 10 });
  assert.equal(title.alpha, 1, "the previous logo's late event is ignored");
  logo.finish("https://example.test/other.png", "failed");
  assert.equal(title.alpha, 1, "failed logo: title");
  assert.equal(logo.alpha, 0);

  // Series with badges: IMDb on the second line, after the badges, then the language.
  const series = buildModernHeroPresentation({
    id: "tt2",
    type: "series",
    name: "東京 Story",
    imdbRating: "8.1",
    genres: ["Drama"],
    ageRating: "TV-MA",
    status: "Ended",
    language: "en",
    releaseInfo: "2020"
  });
  copy.set(series);
  assert.equal(copy.block.alpha, 0, "new copy hidden while it is measured");
  const next = copy.parts();
  assert.notEqual(next.title, title);
  assert.equal(title.destroyed, true, "previous copy destroyed");
  assert.equal(next.description, null);
  assert.deepEqual(tokenTexts(next.primary), [["Series"], ["Drama"], ["2020"]]);
  assert.deepEqual(
    next.secondary.tokens.map((entry) => entry.texts[0].text),
    ["TV-MA", "ENDED", "8.1", "EN"]
  );
  report();
  const badge = next.secondary.tokens[0];
  assert.equal(
    badge.group.children[0].w,
    50 + 2 * HERO_COPY.badge.padX,
    "badge outline around its text"
  );
  assert.equal(badge.group.children[0].shader.shader["border-w"], 2);
  assert.equal(next.secondary.group.y, 486 - 40);
  assert.equal(next.primary.group.y, 486 - 40 - 12 - 40);
  assert.equal(next.title.y, 486 - 40 - 12 - 40 - 28 - 76);
  // Enrichment of the same title (enrichCurrentHeroAsync): the shown copy stays until the
  // enriched one is measured, without a blink, then gives way to it.
  copy.set({ ...series, description: "Enriched" });
  const enriched = copy.parts();
  assert.equal(copy.block.alpha, 1, "same title: no blink while measuring");
  assert.equal(next.title.destroyed, undefined, "shown copy kept meanwhile");
  assert.equal(enriched.title.alpha, 0);
  report(1);
  assert.equal(next.title.destroyed, true, "previous copy destroyed once replaced");
  assert.equal(enriched.title.alpha, 1);
  assert.equal(enriched.description.alpha, HERO_COPY.description.alpha);
  assert.equal(enriched.description.y, 486 - 36);
  copy.set(null);
  assert.equal(copy.block.alpha, 0);
}

// Atlas: versioned files equal a fresh build from the TTF files; French typography inside it,
// other scripts on the canvas renderer, narrow spaces drawn as spaces.
for (const weight of ATLAS_WEIGHTS) {
  const built = await buildSdfAtlas(weight);
  const { atlasUrl, atlasDataUrl } = atlasUrls(weight);
  const json = await readFile(new URL(`../${atlasDataUrl}`, import.meta.url), "utf8");
  assert.equal(built.json, json, `${atlasDataUrl} is stale: run node scripts/build-sdf-atlas.mjs`);
  assert.ok(built.png.equals(await readFile(new URL(`../${atlasUrl}`, import.meta.url))), atlasUrl);
  const chars = new Set(JSON.parse(json).chars.map((entry) => entry.char));
  for (const char of "éèêçœ«»’…·") assert.ok(chars.has(char), `${char} in the ${weight} atlas`);
  assert.equal(chars.size, CHARSET.length);
}
assert.deepEqual(glText("L’été « là »…"), { text: "L’été « là »…", canvas: false });
assert.deepEqual(glText("12\u202f€ et\u00a02\u2009h"), { text: "12 € et 2 h", canvas: false });
assert.equal(glText("東京").canvas, true);
assert.equal(glText("Łódź").canvas, true);
assert.equal(glText(null).text, "");

// Diagnostic variants: one at a time, cycled from the Diagnostic, back to standard.
assert.equal(setting.getWebglVariant(), "standard");
const seen = setting.WEBGL_VARIANTS.map(() => setting.cycleWebglVariant());
assert.deepEqual(seen, ["bitmap-basic", "platform-legacy", "hero-780", "standard"]);
assert.equal(store.has("tvWebglVariant"), false);

console.log(
  "PASS: WebGL Home image slots, fallbacks, text tile, hero cover, motion, hero copy, atlases and variants"
);
