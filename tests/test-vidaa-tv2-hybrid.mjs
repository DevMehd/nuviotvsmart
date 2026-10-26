import assert from "node:assert/strict";

// New TV Home hybrid renderer (nuv-091, lot B2): engine choice, DOM fallback, texture budget,
// context loss and re-upload, and WebGL quads at the positions of the DOM cards.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };

function element(tag = "div") {
  const bySelector = new Map();
  return {
    tagName: tag,
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    listeners: {},
    parentNode: null,
    textContent: "",
    innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      child.parentNode = this;
      if (!this.children.includes(child)) this.children.push(child);
      return child;
    },
    insertBefore(child) {
      return this.appendChild(child);
    },
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    },
    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    },
    dispatch(type, event = {}) {
      (this.listeners[type] || []).forEach((listener) =>
        listener({ preventDefault() {}, ...event })
      );
    },
    querySelector(selector) {
      if (!bySelector.has(selector)) bySelector.set(selector, element());
      return bySelector.get(selector);
    },
    querySelectorAll: () => []
  };
}

let nextCanvas = null;
globalThis.document = {
  documentElement: { classList: { contains: () => false } },
  body: { classList: { contains: () => false } },
  createElement: (tag) => (tag === "canvas" && nextCanvas ? nextCanvas : element(tag))
};
globalThis.getComputedStyle = () => ({ color: "rgba(255, 255, 255, 0.5)" });
const frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {};
const runFrames = () => frames.splice(0).forEach((callback) => callback());
globalThis.Image = class {
  constructor() {
    Object.assign(this, element("img"));
  }
  set src(value) {
    this.attributes.src = value;
  }
  get src() {
    return this.attributes.src || "";
  }
};

function fakeGl(log) {
  const gl = {
    lost: false,
    isContextLost: () => gl.lost,
    getProgramParameter: () => true,
    getUniformLocation: (_, name) => name,
    getAttribLocation: () => 0,
    createTexture: () => ({}),
    texImage2D: (...args) => log.push(["upload", args[5].src]),
    deleteTexture: () => log.push(["delete"]),
    uniform4f: (name, ...values) => name === "u_rect" && log.push(["rect", ...values]),
    drawArrays: () => log.push(["draw"])
  };
  // Every other WebGL call is a no-op; constants are their own names.
  return new Proxy(gl, {
    get: (target, key) => (key in target ? target[key] : /^[A-Z0-9_]+$/.test(key) ? key : () => {})
  });
}

function fakeCanvas(gl) {
  const canvas = element("canvas");
  canvas.clientWidth = 1920;
  canvas.clientHeight = 1080;
  canvas.getContext = (type) => (type === "webgl" ? gl : null);
  return canvas;
}

const { createGlLayer, coverUv } = await import("../js/ui/tv2/render/hybrid/glLayer.js");
const { createHybridHomeRenderer, cardQuads } =
  await import("../js/ui/tv2/render/hybrid/hybridRenderer.js");
const { cardGeometry } = await import("../js/ui/tv2/railEngine.js");
const setting = await import("../js/ui/tv2/newHomeSetting.js");
const { NewHomeScreen } = await import("../js/ui/tv2/newHomeScreen.js");

const geometry = cardGeometry({});
const tmdb = (id) => `https://image.tmdb.org/t/p/original/${id}.jpg`;
const rows = [
  {
    key: "continue",
    kind: "continue",
    title: "Continue",
    items: Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, backdrop: tmdb(`c${i}`) }))
  },
  {
    key: "movies",
    kind: "catalog",
    title: "Movies",
    items: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, poster: tmdb(`m${i}`) }))
  },
  {
    key: "series",
    kind: "catalog",
    title: "Series",
    items: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, poster: tmdb(`s${i}`) }))
  }
];

// object-fit: cover crops the long side evenly.
assert.deepEqual(coverUv(200, 100, 100, 100), [0.25, 0, 0.75, 1]);
assert.deepEqual(coverUv(100, 100, 100, 100), [0, 0, 1, 1]);

// No WebGL: no layer.
assert.equal(createGlLayer(fakeCanvas(null)), null);

// Transform sync: each WebGL quad sits exactly on the DOM card the same frame shows.
const translate = (value) =>
  (/translate3d\(([-\d.]+)(?:px)?,([-\d.]+)/.exec(value) || []).slice(1).map(Number);
{
  const log = [];
  const canvas = fakeCanvas(fakeGl(log));
  const layer = createGlLayer(canvas);
  const container = element();
  const requests = new Map();
  const imageQueue = { request: (node, url) => requests.set(node, url), clear() {} };
  const view = createHybridHomeRenderer(container, {
    geometry,
    imageQueue,
    layout: {},
    glLayer: layer,
    onFallback: () => assert.fail("no fallback expected")
  });
  assert.equal(
    canvas.parentNode,
    container.querySelector(".tv2-home"),
    "canvas under the DOM layer"
  );
  view.setRows(rows);
  const focus = { row: 1, columns: { movies: 9 } };
  view.update(rows, focus, { sidebarIndex: -1 });
  runFrames();
  const rects = log.filter(([type]) => type === "rect").map(([, x, y]) => `${x},${y}`);
  const quads = cardQuads(rows, focus, geometry);
  assert.ok(quads.length >= 6, "the focused rail is on screen");
  assert.equal(rects.length, quads.length, "placeholders drawn while textures load");

  const rowsHost = container.querySelector(".tv2-rows");
  const [, rowsY] = translate(rowsHost.style.transform);
  let sectionTop = 0;
  const domCards = new Set();
  for (const section of rowsHost.children) {
    const track = section.querySelector(".tv2-track");
    const [trackX] = translate(track.style.transform);
    for (const card of track.children) {
      if (card.style.visibility === "hidden") continue;
      const [cardX] = translate(card.style.transform);
      domCards.add(`${220 + trackX + cardX},${560 + rowsY + sectionTop + 56}`);
    }
    sectionTop += parseFloat(section.style.height);
  }
  for (const rect of rects) assert.ok(domCards.has(rect), `quad ${rect} matches a DOM card`);

  // WebGL owns the images: the DOM <img> stays empty, the layer asks the shared queue.
  const urls = quads.map((quad) => quad.url);
  assert.ok([...requests].some(([node, url]) => node instanceof Image && url === urls[0]));
  assert.ok(
    [...requests].every(([node, url]) => node instanceof Image || url === ""),
    "no DOM image while WebGL can draw it"
  );

  // A loaded texture is uploaded and drawn; an unreadable one (no CORS) goes back to the DOM.
  const [loaded] = [...requests].find(([node, url]) => node instanceof Image && url === urls[0]);
  loaded.src = urls[0]; // what the image queue does
  loaded.naturalWidth = 342;
  loaded.naturalHeight = 513;
  loaded.dispatch("load");
  assert.ok(log.some(([type, src]) => type === "upload" && src === urls[0]));
  assert.equal(layer.state(urls[0]), "ready");
  assert.equal(layer.usedPixels, 342 * 513);
  const [broken] = [...requests].find(([node, url]) => node instanceof Image && url === urls[1]);
  broken.dispatch("error");
  assert.equal(layer.state(urls[1]), "failed");
  assert.ok(
    [...requests].some(([node, url]) => !(node instanceof Image) && url === urls[1]),
    "the DOM card shows the image WebGL could not read"
  );
  view.destroy();
  assert.equal(canvas.parentNode, null);
  assert.equal(layer.onEvent, null);
}

// Texture budget: least recently drawn textures go first; a frame that alone exceeds it falls back.
{
  const log = [];
  const layer = createGlLayer(fakeCanvas(fakeGl(log)), { budgetPixels: 25000 });
  const images = new Map();
  const load = (image, url) => url && images.set(url, image);
  const loadNow = (url) => {
    const image = images.get(url);
    image.naturalWidth = 100;
    image.naturalHeight = 100;
    image.attributes.src = url;
    image.dispatch("load");
  };
  const events = [];
  layer.onEvent = (type) => events.push(type);
  for (const url of ["a", "b", "c"]) {
    layer.draw([{ x: 0, y: 0, w: 10, h: 10, url }], load);
    loadNow(url);
  }
  assert.equal(layer.state("a"), "", "oldest texture evicted");
  assert.equal(layer.state("c"), "ready");
  assert.equal(layer.usedPixels, 20000);
  assert.ok(!events.includes("budget"));
  layer.draw(
    ["d", "e", "f"].map((url) => ({ x: 0, y: 0, w: 10, h: 10, url })),
    load
  );
  ["d", "e", "f"].forEach(loadNow);
  assert.ok(events.includes("budget"), "one frame over budget leaves WebGL");
  layer.clear();
  assert.equal(layer.usedPixels, 0);
}

// Engine choice and fallback on the screen.
assert.equal(setting.setNewHomeMode("hybrid"), "hybrid");
setting.resetSessionNewHomeMode();
const makeScreen = () => {
  const screen = Object.create(NewHomeScreen);
  Object.assign(screen, {
    container: element(),
    viewOptions: { geometry, imageQueue: { request() {}, clear() {} }, layout: {} },
    rows,
    focus: { row: 0, columns: {} },
    sidebarIndex: -1,
    profile: null
  });
  return screen;
};
{
  nextCanvas = fakeCanvas(null);
  const screen = makeScreen();
  screen.view = screen.createView();
  assert.equal(setting.activeHomeEngine(), "dom:no-webgl");
  assert.equal(nextCanvas.parentNode, null);
}
{
  const log = [];
  const gl = fakeGl(log);
  const canvas = fakeCanvas(gl);
  nextCanvas = canvas;
  const screen = makeScreen();
  screen.view = screen.createView();
  assert.equal(setting.activeHomeEngine(), "hybrid");
  assert.ok(canvas.parentNode, "canvas mounted");
  screen.view.setRows(rows);
  screen.render();
  runFrames();
  const hybridView = screen.view;

  // Context lost while the Home is shown: same rows and focus, drawn by the DOM.
  gl.lost = true;
  canvas.dispatch("webglcontextlost");
  assert.equal(setting.activeHomeEngine(), "dom:lost");
  assert.equal(setting.homeEngine(), "dom", "Diagnostic homeEngine");
  assert.equal(setting.homeEngineFallback(), "lost", "Diagnostic homeEngineFallback");
  assert.notEqual(screen.view, hybridView);
  assert.equal(canvas.parentNode, null);
  clearTimeout(screen.heroTimer);

  // Back from the player with the context still lost: DOM for this visit.
  screen.view = screen.createView();
  assert.equal(setting.activeHomeEngine(), "dom:lost");

  // Restored meanwhile: hybrid again, and the textures are uploaded again.
  gl.lost = false;
  canvas.dispatch("webglcontextrestored");
  const requested = [];
  screen.viewOptions.imageQueue = {
    request: (node, url) => url && requested.push(url),
    clear() {}
  };
  screen.view = screen.createView();
  assert.equal(setting.activeHomeEngine(), "hybrid");
  assert.equal(setting.homeEngine(), "hybrid");
  assert.equal(setting.homeEngineFallback(), null);
  screen.view.setRows(rows);
  screen.render();
  runFrames();
  assert.ok(requested.includes(cardQuads(rows, screen.focus, geometry)[0].url));
  screen.view.destroy();
}
{
  // DOM mode never touches WebGL.
  setting.setNewHomeMode("dom");
  setting.resetSessionNewHomeMode();
  nextCanvas = null;
  const screen = makeScreen();
  screen.view = screen.createView();
  assert.equal(setting.activeHomeEngine(), "dom");
  assert.equal(screen.glLayer, undefined);
}
setting.setNewHomeMode("off");
setting.resetSessionNewHomeMode();

console.log("PASS: new TV Home hybrid renderer, fallback, budget and transform sync");
