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

const { imageSlot, heroNodeProps, glInfo, homeMotion, tween, settle, softwareWebglRefusal } =
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

// Hero: the modern hero media rectangle (WF-16: 632 px tall as measured in the DOM Home), cover
// from the top right; full screen when enabled.
assert.deepEqual(heroNodeProps(), {
  x: 594,
  y: 0,
  w: 1382,
  h: 632,
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
  // WF-11: constrained runtimes slide in 140 ms too (components-44.css wins over tv2-home.css).
  rootClasses.add("performance-constrained");
  assert.deepEqual(homeMotion(domRoot).rail, rail);
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
  // Two properties of one node animate side by side (the hero copy's alpha and y, WF-10), and
  // settle ends both at their targets.
  const pair = { alpha: 0.7, y: 5 };
  const pairRuns = [];
  pair.animate = (props, settings) => {
    const listeners = [];
    const ctrl = {
      start: () => pairRuns.push(props),
      stop() {
        listeners.splice(0).forEach((fn) => fn());
      },
      once: (event, fn) => listeners.push(fn)
    };
    return ctrl;
  };
  tween(pair, "alpha", 1, rail);
  tween(pair, "y", 0, rail);
  assert.deepEqual(pairRuns, [{ alpha: 1 }, { y: 0 }], "alpha and y both run");
  tween(pair, "alpha", 1, rail);
  assert.equal(pairRuns.length, 2, "the running alpha is not restarted by the y one");
  settle(pair);
  assert.deepEqual([pair.alpha, pair.y], [1, 0]);
  rootClasses.clear();
}

// Lot W3: hero copy on fake Lightning nodes. Text nodes report their size on "loaded". Sizes and
// positions of the DOM modern hero (fidelity group 1: WF-06 to WF-10, WF-15).
{
  const made = [];
  const animations = [];
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
      animate(to, settings) {
        const stopped = [];
        const ctrl = {
          node,
          to,
          settings,
          start: () => animations.push(ctrl),
          stop: () => stopped.splice(0).forEach((fn) => fn()),
          once: (event, fn) => stopped.push(fn)
        };
        return ctrl;
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
  let fade = null;
  const copy = createHeroCopy({
    parent: glNode(),
    node: glNode,
    text: ({ weight, ...props }) => Object.assign(glNode(props), { weight }),
    shader: (props) => ({ shader: props }),
    slot: imageSlot,
    tween,
    settle,
    colors: { text: 1, secondary: 2, dot: 3, badge: 4 },
    get fade() {
      return fade;
    }
  });
  const textsIn = (node) =>
    [node, ...node.children.flatMap(textsIn)].filter((child) => typeof child.text === "string");
  // Every text reports 10 px per character; tokens 40 px, the title 76, the description `lines` × 36.
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
  const { bottom, gap } = HERO_COPY;
  const at = (value) => Math.round(value);

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
    ["text", "text", "text", "imdb"],
    "a movie without badges keeps IMDb on the first line"
  );
  copy.set(movie);
  assert.equal(copy.block.alpha, 0, "hidden until every text is measured");
  const { primary, secondary, title, description } = copy.parts();
  assert.equal(secondary, null);
  // renderModernHeroPrimary: the leading tokens in one text, then dots.
  assert.deepEqual(tokenTexts(primary), [
    [movie.leadingMeta.join(" • ")],
    ["2h"],
    ["2020"],
    ["7.8"]
  ]);
  assert.equal(title.weight, 600, "title in the 600 atlas");
  assert.deepEqual(
    [title.fontSize, title.lineHeight, title.maxWidth],
    [51.52, 66.24, 806],
    "DOM title size, copy width"
  );
  // WF-07: the first meta line in gray, regular (500 in the DOM, no 500 atlas), 24 px on 32.
  const metaText = primary.tokens[0].texts[0];
  assert.deepEqual(
    [metaText.color, metaText.weight, metaText.fontSize, metaText.lineHeight],
    [HERO_COPY.metaColor, 400, 24, 32]
  );
  // WF-08: white description, 25.2 px on 36, up to 4 lines in the room the copy box leaves.
  assert.deepEqual(
    [description.weight, description.color, description.fontSize, description.maxLines],
    [400, 0xffffffff, 25.2, 4]
  );
  report();
  assert.equal(copy.block.alpha, 1, "shown once laid out");
  // Tokens and dots: a 7 px dot 43 px from token to token, as the DOM "•" glyph.
  const widths = primary.tokens.map((entry) => entry.texts[0].text.length * 10);
  const step = 2 * HERO_COPY.dotGap + HERO_COPY.dot;
  assert.equal(step, 43);
  assert.equal(primary.tokens[1].group.x, widths[0] + step);
  assert.equal(primary.dots[0].x, widths[0] + HERO_COPY.dotGap);
  assert.equal(primary.dots[0].y, (32 - HERO_COPY.dot) / 2, "dot centered on the 32 px line");
  // Inside the trailing group (gap 12, not 16): 35 px from token to token.
  const groupStep = 2 * HERO_COPY.groupDotGap + HERO_COPY.dot;
  assert.equal(groupStep, 35);
  assert.equal(primary.tokens[2].group.x, widths[0] + step + widths[1] + groupStep);
  assert.equal(primary.dots[1].x, widths[0] + step + widths[1] + HERO_COPY.groupDotGap);
  const imdbValue = primary.tokens[3].texts[0];
  assert.equal(imdbValue.x, HERO_COPY.imdb.w + HERO_COPY.imdb.gap, "value after the IMDb logo");
  assert.equal(imdbValue.color, HERO_COPY.metaColor, "IMDb value gray, as .home-hero-imdb");
  // WF-09: bottom-up from the DOM copy box bottom (468), 14.72 px apart: description (2 lines),
  // primary (32), the 200 px logo box. WF-15: the title stays hidden while the logo loads.
  assert.equal(description.y, bottom - 72);
  assert.equal(primary.group.y, at(bottom - 72 - gap - 32));
  const { logo } = copy;
  assert.equal(logo.y, at(bottom - 72 - 2 * gap - 32 - 200), "empty logo box while it loads");
  assert.equal(title.alpha, 0, "no title while the logo loads (DOM)");
  // A one-line description moves everything above it down by one line.
  description.text = "Short";
  description.emit("loaded", { dimensions: { w: 50, h: 36 } });
  const box = at(bottom - 36 - 2 * gap - 32 - 200);
  assert.equal(logo.y, box, "logo box follows the description height");

  // WF-06: logo contained in 440×200, left, vertically centered in its box.
  assert.equal(logo.src, "https://example.test/logo.png");
  logo.finish("https://example.test/logo.png", "loaded", { w: 1000, h: 200 });
  assert.deepEqual([logo.w, logo.h], [440, 88]);
  assert.equal(logo.y, box + 56);
  assert.equal(title.alpha, 0, "title hidden behind the loaded logo");
  assert.equal(logo.alpha, 1);
  copy.set({ ...movie, logo: "https://example.test/other.png" });
  assert.equal(copy.parts().title, title, "same copy: nodes kept");
  assert.equal(title.alpha, 0, "a new logo keeps its box empty until it is ready");
  logo.finish("https://example.test/logo.png", "loaded", { w: 10, h: 10 });
  assert.deepEqual([logo.w, logo.h], [440, 200], "the previous logo's late event is ignored");
  logo.finish("https://example.test/other.png", "failed");
  assert.equal(title.alpha, 1, "failed logo: title");
  assert.equal(logo.alpha, 0);
  assert.equal(title.y, at(bottom - 36 - 2 * gap - 32 - 76), "the title in place of the box");
  // A logo given back before it loaded (out of bounds, freed): the title, never an empty box
  // for good; the same hero again asks for it anew.
  const third = { ...movie, logo: "https://example.test/third.png" };
  copy.set(third);
  assert.equal(title.alpha, 0, "loading: empty box");
  logo.emit("freed");
  assert.deepEqual([title.alpha, logo.src], [1, null], "given back: the title");
  copy.set(third);
  assert.deepEqual([title.alpha, logo.src], [0, "https://example.test/third.png"], "asked again");
  logo.finish("https://example.test/third.png", "failed");

  // Series with badges: IMDb on the second line, after the badges, then the language. The copy
  // on screen stays (no empty frame) until the new one is measured (WF-10).
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
  assert.equal(copy.block.alpha, 1, "another title: the shown copy stays while measuring");
  const next = copy.parts();
  assert.notEqual(next.title, title);
  assert.equal(title.destroyed, undefined, "previous copy kept meanwhile");
  assert.equal(next.title.alpha, 0, "the new copy waits hidden");
  assert.equal(next.description, null);
  assert.deepEqual(tokenTexts(next.primary), [["Series • Drama"], ["2020"]]);
  assert.deepEqual(
    next.secondary.tokens.map((entry) => entry.texts[0].text),
    ["TV-MA", "ENDED", "8.1", "EN"]
  );
  assert.equal(next.secondary.tokens[2].texts[0].weight, 600, "second line in 600");
  report();
  assert.equal(title.destroyed, true, "previous copy destroyed once replaced");
  assert.deepEqual([copy.block.alpha, copy.block.y], [1, 0], "no rise without motion");
  const badge = next.secondary.tokens[0];
  assert.equal(
    badge.group.children[0].w,
    50 + 2 * HERO_COPY.badge.padX,
    "badge outline around its text"
  );
  assert.equal(badge.group.children[0].shader.shader["border-w"], 1);
  assert.deepEqual([badge.group.children[0].h, badge.texts[0].fontSize], [40, 18]);
  // A line with a badge is 40 px tall (.home-modern-hero-badge min-height), the other 32.
  assert.equal(next.secondary.group.y, bottom - 40);
  assert.equal(next.primary.group.y, at(bottom - 40 - gap - 32));
  assert.equal(next.title.y, at(bottom - 40 - 2 * gap - 32 - 76));
  assert.equal(next.title.alpha, 1);
  // Enrichment of the same title (enrichCurrentHeroAsync): the shown copy stays until the
  // enriched one is measured, without a blink nor a rise, then gives way to it.
  fade = { duration: 150 };
  copy.set({ ...series, description: "Enriched" });
  const enriched = copy.parts();
  assert.equal(copy.block.alpha, 1, "same title: no blink while measuring");
  assert.equal(next.title.destroyed, undefined, "shown copy kept meanwhile");
  assert.equal(enriched.title.alpha, 0);
  report(1);
  assert.equal(next.title.destroyed, true, "previous copy destroyed once replaced");
  assert.equal(enriched.title.alpha, 1);
  assert.equal(enriched.description.alpha, 1);
  assert.equal(enriched.description.y, bottom - 36);
  assert.deepEqual([copy.block.alpha, copy.block.y], [1, 0], "an enrichment does not rise");
  // WF-10: another title rises in from 0.7 and 5 px in 160 ms ease-out, never through 0.
  copy.set(movie);
  assert.equal(copy.block.alpha, 1);
  animations.length = 0;
  report();
  assert.deepEqual([copy.block.alpha, copy.block.y], [HERO_COPY.swap.alpha, HERO_COPY.swap.y]);
  assert.deepEqual(
    animations.filter((run) => run.node === copy.block).map((run) => [run.to, run.settings]),
    [
      [{ alpha: 1 }, { duration: 160, easing: "ease-out" }],
      [{ y: 0 }, { duration: 160, easing: "ease-out" }]
    ]
  );
  settle(copy.block);
  assert.deepEqual([copy.block.alpha, copy.block.y], [1, 0]);
  fade = null;
  copy.set({ ...series, description: "Enriched" });
  report(1);
  // Lot W5, full-screen trailer: the meta lines and description fade, the title stays, an
  // enrichment meanwhile keeps them hidden, and they come back to their alphas after it.
  const shownSeries = copy.parts();
  copy.hideMeta(true, null);
  assert.deepEqual(
    [
      shownSeries.title,
      shownSeries.primary.group,
      shownSeries.secondary.group,
      shownSeries.description
    ].map((node) => node.alpha),
    [1, 0, 0, 0]
  );
  copy.set({ ...series, description: "Enriched again" });
  report(1);
  const during = copy.parts();
  assert.equal(during.title.alpha, 1);
  assert.equal(during.description.alpha, 0, "a copy laid out under the trailer stays hidden");
  copy.set(movie);
  report();
  assert.equal(copy.parts().primary.group.alpha, 0, "a new title under the trailer too");
  copy.hideMeta(false, null);
  assert.equal(copy.parts().primary.group.alpha, 1);
  assert.equal(copy.parts().description.alpha, 1);
  // Breaking Bad's case (logo, a badge line): the description gets the 3 lines left.
  copy.set({ ...series, description: "Long", logo: "https://example.test/bb.png" });
  assert.equal(copy.parts().description.maxLines, 3);
  copy.set(null);
  assert.equal(copy.block.alpha, 0);
}

// Lot W4a: card content on fake nodes. Posters carry no title, Continue Watching cards carry the
// mobile copy, badge and progress for each card style, loading rows show N skeleton cards.
{
  const { createGlCard, fillGlCard, setRowSkeletons, CW_CARD } =
    await import("../js/ui/tv2/render/lightning/lightningHomeRenderer.js");
  const { continueCardModel } =
    await import("../js/ui/screens/home/homeScreenHelpers-12-build-hero-indicators.js");
  const { cardGeometry, rowCardSize } = await import("../js/ui/tv2/railEngine.js");
  const animations = [];
  function glNode(props = {}) {
    const listeners = {};
    const node = {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      alpha: 1,
      children: [],
      on: (event, fn) => (listeners[event] = listeners[event] || []).push(fn),
      emit: (event, payload = {}) => (listeners[event] || []).forEach((fn) => fn(node, payload)),
      animate: (to, settings) => {
        const listeners = [];
        const ctrl = { to, settings, started: false, stopped: false };
        ctrl.start = () => (ctrl.started = true);
        ctrl.stop = () => {
          ctrl.stopped = true;
          listeners.splice(0).forEach((fn) => fn());
        };
        ctrl.once = (event, fn) => listeners.push(fn);
        animations.push(ctrl);
        return ctrl;
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
    return node;
  }
  const scene = {
    node: glNode,
    group: glNode,
    text: ({ weight = 400, text = "", ...props }) => Object.assign(glNode(props), { weight, text }),
    retext: (node, value) => Object.assign(node, { text: value }),
    shader: (props) => ({ shader: props }),
    round: (radius) => ({ round: radius }),
    radius: 24,
    colors: { card: 1, accent: 5, bgAt: (alpha) => `bg${alpha}` }
  };
  const textsIn = (node) =>
    [node, ...node.children.flatMap(textsIn)].filter((child) => typeof child.text === "string");

  const geometry = cardGeometry({ homeLayout: "modern" });
  const poster = createGlCard(scene, glNode(), "poster", geometry.poster);
  fillGlCard(scene, poster, { name: "Heat" }, { url: "/heat.jpg", fallbacks: [] });
  assert.deepEqual(
    textsIn(poster.node),
    [poster.fallback],
    "a poster has no title, only its text tile"
  );
  assert.equal(poster.fallback.text, "Heat");
  assert.equal(poster.fallback.alpha, 0);
  poster.showTile(true);
  assert.equal(poster.fallback.alpha, 1, "text tile of a failed image");
  assert.equal(poster.node.children[0].w, geometry.poster.width, "image first, at the card size");
  // WF-04: the card and its artwork have the DOM's 24 px rounded corners.
  assert.deepEqual(
    [poster.node.shader, poster.node.children[0].shader],
    [{ round: 24 }, { round: 24 }]
  );

  const episode = {
    contentId: "tt6",
    type: "series",
    title: "Show",
    season: 1,
    episode: 2,
    episodeTitle: "Pilot 2",
    positionMs: 1500000,
    durationMs: 6000000,
    backdrop: "https://image.tmdb.org/t/p/w780/sb.jpg"
  };
  for (const cardStyle of ["card", "wide", "poster"]) {
    const size = rowCardSize(
      { kind: "continue" },
      cardGeometry({ homeLayout: "modern", continueWatchingCardStyle: cardStyle })
    );
    const card = createGlCard(scene, glNode(), "continue", size);
    const cw = continueCardModel(episode, { cardStyle });
    fillGlCard(scene, card, episode, { url: "", fallbacks: [], cw });
    const { kicker, title, subtitle, badge, badgeText, track, fill } = card.cw;
    assert.equal(card.fallback, null, `${cardStyle}: no text tile, the copy stays`);
    assert.deepEqual([kicker.text, title.text, subtitle.text], [cw.kicker, "Show", "Pilot 2"]);
    assert.ok(cw.kicker, "episode code");
    // WF-12: the DOM .tv2-cw-* sizes (weight 500 drawn in 400), cut at a character.
    assert.deepEqual(
      [kicker, title, subtitle].map((node) => [node.weight, node.fontSize, node.alpha ?? 1]),
      [
        [400, 24, 0.88],
        [400, 28, 1],
        [400, 24, 0.72]
      ]
    );
    assert.equal(title.wordBreak, "break-all", "text-overflow: ellipsis cuts inside a word");
    // Bottom-up from 24 px: subtitle 32, title 40, kicker 32 (DOM line heights, no gap).
    assert.equal(subtitle.y, size.height - 24 - 32, `${cardStyle} subtitle y`);
    assert.equal(title.y, subtitle.y - 40);
    assert.equal(kicker.y, title.y - 32);
    assert.equal(track.w, size.width - 40, `${cardStyle} progress track`);
    assert.equal(track.y, size.height - 8 - 6);
    assert.deepEqual(
      [track.shader, fill.shader],
      [{ round: 3 }, { round: 3 }],
      "rounded progress ends"
    );
    assert.equal(fill.w, Math.round(0.25 * (size.width - 40)), `${cardStyle} progress 25 %`);
    assert.equal(badgeText.text, cw.badge);
    assert.ok(cw.badge, "remaining time badge");
    badgeText.emit("loaded", { dimensions: { w: 100, h: 28 } });
    assert.equal(badge.w, 100 + 2 * CW_CARD.badge.padX, "badge frame around its text");
    assert.equal(badge.x, size.width - 16);
    assert.equal(
      badgeText.maxWidth,
      size.width - 64,
      `${cardStyle}: a long badge stays in the card`
    );
    assert.equal(badge.color, CW_CARD.badge.color, "badge rgba(19, 19, 19, 0.88)");
    assert.equal(badgeText.weight, 400);
    // A movie: no episode code nor subtitle, the title sits on the bottom line.
    const movie = { contentId: "tt5", type: "movie", title: "Heat", positionMs: 0, durationMs: 0 };
    fillGlCard(scene, card, movie, { cw: continueCardModel(movie, { cardStyle }) });
    assert.equal(title.y, size.height - 24 - 40, `${cardStyle} movie title y`);
    assert.equal(fill.w, 0);
  }
  const release = createGlCard(scene, glNode(), "continue", geometry.continueCard);
  const releaseCw = continueCardModel(episode, {});
  for (const [isNewSeasonRelease, color] of [
    [true, CW_CARD.newSeason],
    [false, CW_CARD.newEpisode]
  ]) {
    const normalized = { isNextUp: true, isReleaseAlert: true, isNewSeasonRelease };
    fillGlCard(scene, release, episode, { cw: { ...releaseCw, normalized } });
    assert.equal(release.cw.badge.color, color, "mobile release badge colors");
  }

  // Loading rows: N cards at the card pitch in the track, one pulse on the row, gone with the items.
  const view = { track: glNode(), size: geometry.poster, skeleton: null };
  setRowSkeletons(scene, view, 4, geometry.gap, null);
  const group = view.track.children[0];
  assert.equal(group.children.length, 4);
  assert.equal(group.children[3].x, 3 * (geometry.poster.width + geometry.gap));
  assert.deepEqual(
    [group.children[0].colorTop, group.children[0].colorBottom],
    [0x262626ff, 0x101010ff],
    "DOM skeleton gradient (WF-14)"
  );
  assert.deepEqual(group.children[0].shader, { round: 24 }, "rounded skeleton cards");
  assert.equal(animations.length, 0, "no pulse when constrained or without motion");
  setRowSkeletons(scene, view, 4, geometry.gap, null);
  assert.equal(view.track.children[0], group, "same count: kept");
  setRowSkeletons(scene, view, 0);
  assert.equal(group.destroyed, true);
  assert.equal(view.track.children.length, 0, "items arrived: skeletons removed");
  setRowSkeletons(scene, view, 2, geometry.gap, true);
  const [pulse] = animations;
  assert.deepEqual([pulse.started, pulse.to.alpha, pulse.settings.duration], [true, 0.6, 1200]);
  assert.equal(view.track.children[0].children.length, 2);
  setRowSkeletons(scene, view, 0);
  assert.equal(pulse.stopped, true, "pulse stopped with the skeletons");

  // WF-20: artwork arriving on a resting rail fades in over 150 ms; while the rail slides it
  // shows at once; a new URL ends a running fade (a node without texture is painted white).
  {
    const track = glNode();
    const fading = { ...scene, imageFade: { duration: 150 }, rowsLayer: glNode() };
    const fadeCard = createGlCard(fading, track, "poster", geometry.poster);
    const art = fadeCard.node.children[0];
    fadeCard.image.src = "/p.jpg";
    art.emit("loaded");
    assert.equal(art.alpha, 1, "preloaded off screen (InBounds): no fade nobody sees");
    art.renderState = 8;
    fadeCard.image.src = "/a.jpg";
    art.emit("loaded");
    const run = animations.at(-1);
    assert.deepEqual(
      [art.alpha, run.to, run.settings, run.started],
      [0, { alpha: 1 }, { duration: 150 }, true]
    );
    fadeCard.image.src = "";
    assert.deepEqual([run.stopped, art.alpha], [true, 0], "cleared: the fade ends, nothing drawn");
    tween(track, "x", -10, { duration: 140 });
    fadeCard.image.src = "/b.jpg";
    art.emit("loaded");
    assert.equal(art.alpha, 1, "no fade while the rail slides");
    settle(track);
    const still = createGlCard(scene, glNode(), "poster", geometry.poster);
    still.image.src = "/c.jpg";
    still.node.children[0].emit("loaded");
    assert.equal(still.node.children[0].alpha, 1, "no fade without motion");
  }

  // Lot W4b: watched badge, landscape logo then title, folder emoji, Next Up blur, depth.
  const { CARD_EXTRAS, blurredSource, watchedBadgeBox } =
    await import("../js/ui/tv2/render/lightning/lightningHomeRenderer.js");
  const { cardImage } = await import("../js/ui/tv2/renderer.js");
  const { Router } = await import("../js/ui/navigation/routerState.js");
  Router.getCurrent = () => "home";
  const same = (url) => url;
  const catalog = { key: "cat", kind: "poster", entry: { type: "movie" } };
  const film = { id: "tt0000042", type: "movie", name: "Heat", poster: "/heat.jpg" };
  const watchedCard = createGlCard(scene, glNode(), "poster", geometry.poster);
  const posterSource = cardImage(catalog, film, geometry.poster, {}, same);
  fillGlCard(scene, watchedCard, film, posterSource, null);
  assert.equal(watchedCard.watched.alpha, 0, "not watched");
  fillGlCard(scene, watchedCard, film, posterSource, new Set(["tt0000042"]));
  assert.equal(watchedCard.watched.alpha, 1, "badge after setWatched");
  // WF-13: the DOM badge's 34 px circle 14 px from the corner, its texture wider for the shadow.
  const shadowBox = watchedBadgeBox();
  assert.deepEqual(shadowBox, { left: 24, top: 10, w: 82, h: 82 });
  assert.deepEqual(
    [watchedCard.watched.x, watchedCard.watched.y, watchedCard.watched.w, watchedCard.watched.h],
    [geometry.poster.width - 14 - 34 - 24, 14 - 10, 82, 82]
  );

  const wide = rowCardSize(
    catalog,
    cardGeometry({ homeLayout: "modern", modernLandscapePostersEnabled: true })
  );
  assert.ok(wide.width > wide.height, "landscape catalog size");
  const landscapeCard = createGlCard(scene, glNode(), "poster", wide);
  assert.equal(landscapeCard.fallback, null, "the overlay title replaces the tile");
  const logoFilm = { ...film, logo: "https://logo.invalid/l.png", releaseInfo: "2021" };
  const wideSource = cardImage(catalog, logoFilm, wide, {}, same);
  fillGlCard(scene, landscapeCard, logoFilm, wideSource, null);
  const L = landscapeCard.landscape;
  assert.ok(L.url.includes("logo.invalid"), "logo chosen");
  assert.equal(L.title.alpha, 0, "title hidden while the logo loads");
  assert.equal(L.subtitle.text, wideSource.model.subtitle);
  L.logoNode.texture = { dimensions: { w: 400, h: 50 } };
  L.logo.src = L.url;
  L.logoNode.emit("loaded");
  assert.deepEqual([L.logoNode.w, L.logoNode.h], [232, 29], "logo fitted in 232×60");
  assert.equal(L.logoNode.y, L.title.y, "logo and title share the bottom line");
  L.logo.src = `${L.url}?again`;
  L.logoNode.emit("failed");
  assert.equal(L.title.alpha, 1, "failed logo: title on 2 lines");
  assert.equal(L.title.text, "Heat");
  assert.deepEqual([L.title.maxLines, L.title.weight], [2, 600]);
  fillGlCard(scene, landscapeCard, film, cardImage(catalog, film, wide, {}, same), null);
  assert.deepEqual([L.url, L.title.alpha], ["", 1], "no logo: title");

  const folderRow = { key: "col", kind: "collection" };
  const folder = { id: "collection:c:f", coverEmoji: "🎬", name: "Folder" };
  const folderCard = createGlCard(scene, glNode(), "collection", geometry.poster);
  assert.equal(folderCard.watched, null, "no watched badge on folders");
  fillGlCard(scene, folderCard, folder, cardImage(folderRow, folder, geometry.poster, {}, same));
  assert.deepEqual(
    [folderCard.fallback.text, folderCard.fallback.fontSize],
    ["🎬", CARD_EXTRAS.emoji.fontSize]
  );
  const covered = { ...folder, poster: "/cover.jpg" };
  fillGlCard(scene, folderCard, covered, cardImage(folderRow, covered, geometry.poster, {}, same));
  assert.deepEqual([folderCard.fallback.text, folderCard.fallback.fontSize], ["Folder", 28]);

  const tmdbStill = "https://image.tmdb.org/t/p/w500/still.jpg";
  const blurred = blurredSource({ url: tmdbStill, fallbacks: [tmdbStill, "/other.jpg"] });
  assert.equal(blurred.url, "https://image.tmdb.org/t/p/w92/still.jpg", "TMDB's smallest size");
  assert.deepEqual(blurred.fallbacks, ["/other.jpg"], "no fallback equal to the shrunk URL");
  assert.equal(blurred.veil, false);
  assert.equal(blurredSource({ url: "/other.jpg", fallbacks: [] }).veil, true, "veil elsewhere");
  const nextUp = createGlCard(scene, glNode(), "continue", geometry.continueCard);
  const nextCw = { ...continueCardModel(episode, {}), blur: true };
  fillGlCard(scene, nextUp, episode, { ...blurred, cw: nextCw });
  assert.equal(nextUp.cw.veil.alpha, 0, "small TMDB image: no veil");
  fillGlCard(scene, nextUp, episode, { url: "/other.jpg", fallbacks: [], veil: true, cw: nextCw });
  assert.equal(nextUp.cw.veil.alpha, 1, "veil over artwork that cannot be shrunk");
  assert.deepEqual(nextUp.cw.veil.shader, { round: 24 }, "rounded veil");
  // WF-12: the DOM scrim stops, transparent to 45 %, 0.7 at 78 %, 0.95 at the bottom.
  const scrims = nextUp.node.children.filter((child) => String(child.colorBottom).startsWith("bg"));
  const cwHeight = geometry.continueCard.height;
  assert.deepEqual(
    scrims.map((node) => [node.y, node.h, node.colorTop, node.colorBottom, node.shader]),
    [
      [
        Math.round(cwHeight * 0.45),
        Math.round(cwHeight * 0.78) - Math.round(cwHeight * 0.45),
        "bg0",
        "bg0.7",
        undefined
      ],
      [
        Math.round(cwHeight * 0.78),
        cwHeight - Math.round(cwHeight * 0.78),
        "bg0.7",
        "bg0.95",
        { round: [0, 0, 24, 24] }
      ]
    ],
    "scrim rounded at the bottom only"
  );

  const deep = { ...scene, depth: { posters: true, continue: false, edge: 7, sheen: 8 } };
  const plainCount = createGlCard(scene, glNode(), "poster", geometry.poster).node.children.length;
  const deepCard = createGlCard(deep, glNode(), "poster", geometry.poster);
  assert.equal(deepCard.node.children.length, plainCount + 2, "edge and sheen");
  const [sheen, edge] = deepCard.node.children.slice(-2);
  assert.deepEqual([edge.color, edge.h, sheen.colorTop], [7, 2, 8]);
  assert.deepEqual([edge.x, edge.w], [24, geometry.poster.width - 48], "edge between the corners");
  assert.deepEqual(sheen.shader, { round: [24, 24, 0, 0] }, "sheen rounded at the top");
  assert.equal(sheen.h, Math.round(geometry.poster.height * 0.22));
  assert.equal(
    createGlCard(deep, glNode(), "continue", geometry.continueCard).node.children.length,
    createGlCard(scene, glNode(), "continue", geometry.continueCard).node.children.length,
    "depth off for Continue Watching"
  );
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
assert.deepEqual(seen, [
  "bitmap-basic",
  "platform-legacy",
  "hero-780",
  "trailer-above",
  "standard"
]);
assert.equal(store.has("tvWebglVariant"), false);

// Lot W6: a software WebGL is refused on VIDAA only, with the exact renderer string kept for the
// Diagnostic (homeEngineFallback); off VIDAA (desktop checks, the SwiftShader fixture) it is used.
{
  const swiftShader =
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
  assert.equal(softwareWebglRefusal(swiftShader, true), `no-webgl:${swiftShader}`);
  assert.equal(
    softwareWebglRefusal("llvmpipe (LLVM 15.0.7, 256 bits)", true).startsWith("no-webgl:"),
    true
  );
  assert.equal(softwareWebglRefusal(swiftShader, false), "", "accepted off VIDAA");
  assert.equal(softwareWebglRefusal("Mali-G52", true), "", "a TV GPU is accepted");
  setting.resetSessionNewHomeMode();
  setting.markWebglFailed(softwareWebglRefusal(swiftShader, true));
  assert.equal(setting.homeEngineFallback(), `no-webgl:${swiftShader}`);
  setting.resetSessionNewHomeMode();
}

console.log(
  "PASS: WebGL Home image slots, fallbacks, text tile, hero cover, motion, hero copy, cards, skeletons, atlases, variants and software WebGL refusal"
);
