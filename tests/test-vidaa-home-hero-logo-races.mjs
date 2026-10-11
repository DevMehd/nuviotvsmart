import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const preloads = [];
const domRequests = [];
function classes(...initial) {
  const values = new Set(initial);
  return {
    contains: (name) => values.has(name),
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    }
  };
}
class Element extends EventTarget {
  constructor() {
    super();
    this.classList = classes();
    this.dataset = {};
    this.children = [];
    this.isConnected = true;
    this.attributes = new Map();
    const styles = new Map();
    this.style = {
      getPropertyValue: (name) => styles.get(name) || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name)
    };
  }
  set className(value) {
    this.classList = classes(...value.split(/\s+/));
  }
  get firstChild() {
    return this.children[0] || null;
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  insertBefore(node, before) {
    node.parentElement = this;
    node.isConnected = this.isConnected;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
    this.isConnected = false;
  }
  querySelectorAll(selector) {
    if (selector === ".home-hero-logo-transition-ghost")
      return this.children.filter((node) =>
        node.classList.contains("home-hero-logo-transition-ghost")
      );
    return [];
  }
}
class DomImage extends Element {
  constructor() {
    super();
    this.complete = false;
    this.naturalWidth = 0;
  }
  setAttribute(name, value) {
    super.setAttribute(name, value);
    if (name === "src") {
      this.complete = false;
      this.naturalWidth = 0;
      domRequests.push(String(value));
    }
  }
  loaded() {
    this.complete = true;
    this.naturalWidth = 120;
    this.dispatchEvent(new Event("load"));
  }
  failed() {
    this.complete = true;
    this.naturalWidth = 0;
    this.dispatchEvent(new Event("error"));
  }
}
globalThis.HTMLElement = Element;
globalThis.HTMLImageElement = DomImage;
globalThis.Image = class {
  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    preloads.push(this);
  }
  loaded() {
    this.complete = true;
    this.naturalWidth = 120;
    this.onload?.();
  }
  failed() {
    this.complete = true;
    this.naturalWidth = 0;
    this.onerror?.();
  }
  decode() {
    return Promise.resolve();
  }
};
globalThis.document = {
  getElementById: () => null,
  documentElement: { classList: classes() },
  createElement: () => new DomImage()
};

const { createHomeScreenMethods05 } =
  await import("../js/ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js");
const { createHomeScreenMethods10 } =
  await import("../js/ui/screens/home/homeScreenMethods-10-schedule-modern-hero-update.js");
const { animateHeroLogoSwap } =
  await import("../js/ui/screens/home/homeScreenHelpers-04-animate-hero-logo-swap.js");
const { heroImagePreloadCache } =
  await import("../js/ui/screens/home/homeScreenHelpers-02-extract-release-date-text.js");
const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");
const { TmdbSettingsStore } = await import("../js/data/local/tmdbSettingsStore.js");
LayoutPreferences.get = () => ({ preferExternalMetaAddonDetail: false });
TmdbSettingsStore.get = () => ({ enabled: false });
let timerId = 0;
let now = 1000;
const timers = new Map();
const frames = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++timerId;
  timers.set(id, { callback, time: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.requestAnimationFrame = (callback) => {
  const id = ++timerId;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
async function flush() {
  for (let n = 0; n < 30; n++) await Promise.resolve();
}
async function advance(ms) {
  const until = now + ms;
  for (let n = 0; n < 100; n++) {
    await flush();
    const due = [...timers]
      .filter(([, timer]) => timer.time <= until)
      .sort((a, b) => a[1].time - b[1].time)[0];
    if (!due) {
      now = until;
      return;
    }
    const [id, timer] = due;
    timers.delete(id);
    now = timer.time;
    timer.callback();
  }
  throw new Error("Hero callbacks must remain bounded");
}
async function frame() {
  const pending = [...frames];
  frames.clear();
  pending.forEach(([, callback]) => callback());
  await flush();
}
function hero(id, logo = `https://fixture.invalid/${id}.png`) {
  return { id, type: "movie", name: `Title ${id}`, logo, description: `Overview ${id}` };
}
function fixture() {
  const first = hero("a");
  const title = new Element();
  title.classList.add("is-hidden");
  const brand = new Element();
  const logo = new DomImage();
  logo.classList.add("home-hero-logo");
  logo.setAttribute("src", first.logo);
  logo.loaded();
  brand.insertBefore(logo, null);
  const card = new Element();
  card.dataset = { itemId: first.id, itemType: first.type };
  card.querySelector = (selector) => {
    if (selector === ".home-hero-brand") return brand;
    if (selector === ".home-hero-title-text") return title;
    if (selector.startsWith(".home-hero-logo:"))
      return (
        brand.children.find(
          (node) =>
            node.classList.contains("home-hero-logo") &&
            !node.classList.contains("home-hero-logo-transition-ghost")
        ) || null
      );
    return null;
  };
  card.querySelectorAll = (selector) => brand.querySelectorAll(selector);
  const node = new Element();
  node.hero = first;
  node.classList.add("focused");
  const ui = {
    ...createHomeScreenMethods05(),
    ...createHomeScreenMethods10(),
    layoutMode: "modern",
    heroItem: first,
    heroCandidates: [first],
    heroFocusToken: 1,
    container: { querySelector: () => card },
    focused: node,
    busy: false,
    getCurrentFocusedNode() {
      return this.focused;
    },
    getNodeHeroSource: (focused) => focused?.hero,
    isVidaaHomeLoadingBusy() {
      return this.busy;
    },
    isHomeNavigationSettling: () => false,
    isModernVerticalScrollActive: () => false,
    isPerformanceConstrained: () => false,
    getHeroFocusDelay: () => 80,
    cancelPendingHeroFocus() {
      clearTimeout(this.heroFocusDelayTimer);
      clearTimeout(this.heroBackdropPreloadTimer);
      this.heroFocusToken++;
    },
    scheduleHomeTruncationUpdate() {},
    syncCollectionHeroMedia() {},
    enrichCurrentHeroAsync() {}
  };
  return { ui, card, brand, title, oldLogo: logo, node };
}
function focus(state, item) {
  const node = new Element();
  node.hero = item;
  node.classList.add("focused");
  state.ui.focused = node;
  return node;
}
function reset() {
  timers.clear();
  frames.clear();
  preloads.length = 0;
  domRequests.length = 0;
  heroImagePreloadCache.clear();
}

reset();
{
  const state = fixture();
  const obsolete = new Element();
  obsolete.hero = hero("obsolete");
  obsolete.classList.add("focused");
  state.ui.scheduleModernHeroUpdate(obsolete);
  assert.equal(state.oldLogo.isConnected, true);
  assert.equal(state.title.classList.contains("is-hidden"), true);
  assert.equal(preloads.length, 0);
  console.log(
    "PASS a stale focus notification cannot clear the current logo or request obsolete artwork"
  );
}
reset();
{
  const state = fixture();
  state.ui.busy = true;
  const before = preloads.length;
  state.ui.scheduleModernHeroUpdate(focus(state, hero("b")));
  assert.equal(
    state.oldLogo.isConnected,
    false,
    "Changing focus retires the previous logo synchronously"
  );
  assert.equal(state.title.textContent, "Title b");
  assert.equal(state.title.classList.contains("is-hidden"), false);
  assert.equal(
    preloads.length,
    before,
    "Clearing a previous logo must not start an image request during loading"
  );
  const restoredByRender = new DomImage();
  restoredByRender.classList.add("home-hero-logo");
  restoredByRender.setAttribute("src", state.node.hero.logo);
  restoredByRender.loaded();
  state.brand.insertBefore(restoredByRender, null);
  state.ui.scheduleModernHeroUpdate(state.ui.focused);
  assert.equal(
    restoredByRender.isConnected,
    false,
    "An intervening render of the old hero cannot reintroduce its logo"
  );
  await advance(200);
  assert.equal(preloads.length, before);
  console.log(
    "PASS focus retires the previous logo before busy/debounce resolves, without loading artwork"
  );
}
reset();
{
  const state = fixture();
  const item = hero("b");
  focus(state, item);
  state.ui.heroItem = item;
  state.ui.applyHeroToDom();
  const logo = state.brand.children[0];
  assert.equal(state.title.classList.contains("is-hidden"), false);
  preloads.find((image) => image.src === item.logo).loaded();
  await flush();
  assert.equal(logo.getAttribute("src"), item.logo);
  assert.equal(
    state.title.classList.contains("is-hidden"),
    false,
    "A successful preload cannot hide the fallback before the DOM image loads"
  );
  logo.loaded();
  assert.equal(state.title.classList.contains("is-hidden"), true);
  await frame();
  await frame();
  logo.failed();
  assert.equal(state.title.classList.contains("is-hidden"), false);
  assert.equal(logo.isConnected, false);
  assert.equal(state.title.textContent, "Title b");
  console.log(
    "PASS the current title remains visible until its logo loads and returns on a DOM image error"
  );
}
reset();
{
  const state = fixture();
  const item = hero("b");
  focus(state, item);
  state.ui.heroItem = item;
  state.ui.applyHeroToDom();
  const retired = state.brand.children[0];
  const oldPreload = preloads.find((image) => image.src === item.logo);
  const latest = hero("c", "");
  state.ui.scheduleModernHeroUpdate(focus(state, latest));
  oldPreload.loaded();
  await flush();
  retired.loaded();
  retired.failed();
  await frame();
  await frame();
  assert.equal(state.brand.children.length, 0);
  assert.equal(
    retired.getAttribute("src"),
    null,
    "A late old preload must not assign a source to its retired DOM node"
  );
  assert.equal(state.title.textContent, "Title c");
  assert.equal(state.title.classList.contains("is-hidden"), false);
  console.log(
    "PASS a superseded preload/load/error cannot restore an old logo or hide the newly focused title"
  );
}
reset();
{
  const state = fixture();
  const ghost = new DomImage();
  ghost.classList.add("home-hero-logo-transition-ghost");
  state.brand.insertBefore(ghost, null);
  focus(state, hero("b"));
  state.ui.heroItem = state.ui.focused.hero;
  state.ui.applyHeroToDom();
  preloads.find((image) => image.src === state.ui.heroItem.logo).failed();
  await flush();
  assert.equal(state.brand.children.length, 0);
  assert.equal(state.title.classList.contains("is-hidden"), false);
  assert.equal(ghost.isConnected, false);
  console.log("PASS a missing logo removes ghosts and preserves the current title fallback");
}
reset();
{
  const state = fixture();
  const next = focus(state, hero("b"));
  state.ui.scheduleModernHeroUpdate(next);
  state.ui.focused = state.node;
  state.ui.scheduleModernHeroUpdate(state.node);
  preloads.find((image) => image.src === state.node.hero.logo).loaded();
  await flush();
  const restored = state.brand.children[0];
  restored.loaded();
  await advance(300);
  assert.equal(state.ui.heroItem.id, "a");
  assert.equal(restored.getAttribute("src"), state.node.hero.logo);
  assert.equal(state.title.classList.contains("is-hidden"), true);
  assert.ok(
    !preloads.some((image) => image.src === next.hero.logo),
    "Returning focus cancels the obsolete delayed hero request"
  );
  console.log("PASS returning to the displayed title cancels stale work and restores its logo");
}
reset();
for (const transitionMode of ["crossfade", "single-layer"]) {
  const state = fixture();
  const ready = [];
  animateHeroLogoSwap(
    state.oldLogo,
    `https://fixture.invalid/new-${transitionMode}.png`,
    "New title",
    100,
    { transitionMode, onReady: (value) => ready.push(value) }
  );
  assert.equal(state.oldLogo.getAttribute("src"), null);
  assert.equal(state.oldLogo.style.getPropertyValue("display"), "none");
  preloads.at(-1).failed();
  await flush();
  assert.equal(state.oldLogo.isConnected, false);
  assert.deepEqual(ready, [false, false]);
  console.log(
    `PASS ${transitionMode} never holds the previous image while the replacement is pending or broken`
  );
}
reset();
