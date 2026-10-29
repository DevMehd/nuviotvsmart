import { renderLegacySidebar } from "../../../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { loadScript } from "../../../../runtime/loadStreamingLibs.js";
import { homeLayout, rowCardSize, rowLabelHeight, slotFor } from "../../railEngine.js";
import { t } from "../../../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { focusedIndex } from "../../focusModel.js";
import { createImageQueue, glImageUrl } from "../../imagePipeline.js";
import { cardImage, fillCard, navRowOf, setNavPosition } from "../../renderer.js";
import { getWebglVariant, markWebglFailed, setWebglInfoSource } from "../../newHomeSetting.js";
import { buildModernHeroPresentation } from "../../../screens/home/homeScreenHelpers-11-build-hero-display-model.js";
import { buildSdfAtlas } from "./sdfAtlas.js";
import { useVidaaHeroTransition } from "../../../screens/home/vidaaHeroTransition.js";

// New TV Home (nuv-091, lot B2), 100 % WebGL prototype on Lightning: hero, rails, text (SDF
// atlas) and focus are drawn in one canvas. Same interface as createDomHomeRenderer. The
// sidebar stays the shared DOM component; a hidden DOM proxy of the focused card keeps
// openDetail and the diagnostic driver selectors working. Any failure reports to `onFailure`
// and the screen swaps to the DOM renderer for the rest of the run.

const LIB_URL = "assets/runtime/tv2-lightning.js";
const FONT = "Tv2Sans";
let engineCount = 0;
const APP_WIDTH = 1920;
const APP_HEIGHT = 1080;
// Same layout as css/tv2-home.css.
const RAIL_LEFT = 220;
const MAIN_TOP = 560;
// Focus ring of the DOM card (tv2-home.css .tv2-card.focused box-shadow): 3 px, --focus-color.
const FOCUS_RING = 3;
const FOCUS_SCALE = 1.015;
// The incoming hero image loads at this alpha: Lightning only uploads a visible node's texture.
const HERO_LOADING_ALPHA = 0.01;
// Fixed GPU budget: the image windows of renderer.js need about 45 MB (poster ~0.7 MB, hero
// 3.7 MB). Still above it after Lightning's own cleanup means the TV cannot hold the scene.
export const TEXTURE_BUDGET_BYTES = 64 * 1024 * 1024;
// Memory outside the image textures: the SDF font atlas (1024 px wide, RGBA). Lightning assumes
// 26 MB by default, which would leave a 40-card window too little room before criticalCleanup.
const BASELINE_BYTES = 4 * 1024 * 1024;
// Mobile text fallback of a failed image (ShelfComponents.kt:194-203): textMuted, 16 sp → 28 px.
const FALLBACK_TEXT = 0x969ca3ff;
const COVER = { resizeMode: { type: "cover" } };

/**
 * Modern hero media node: components-16.css draws it 72 % wide, 56 px past the right edge and
 * (48 % + 132 px) tall, i.e. 594/0/1382×650 at 1080p, or the full screen with
 * modernHeroFullScreenBackdropEnabled; cropped as cover from the top right (object-position 100% 0).
 */
export function heroNodeProps(layout = {}) {
  const rect = layout.modernHeroFullScreenBackdropEnabled
    ? { x: 0, y: 0, w: APP_WIDTH, h: APP_HEIGHT }
    : { x: 594, y: 0, w: 1382, h: 650 };
  return { ...rect, textureOptions: { resizeMode: { type: "cover", clipX: 1, clipY: 0 } } };
}

// Diagnostic WebGL (lot W1a): failures per host class (never a URL or an addon host), distinct
// proxied URLs and peak texture memory of this run.
const glStats = {
  failed: { tmdb: 0, metahub: 0, proxy: 0, autre: 0 },
  proxied: new Set(),
  peakTextureBytes: 0
};
let liveEngine = null;

/**
 * Motion of the current Home on VIDAA, as the DOM renderer: rails and rows slide in 140 ms (100
 * on constrained runtimes, tv2-home.css); the focused card scales and the hero fades behind
 * useVidaaHeroTransition (vidaa-balanced-motion), which animateHeroBackdropSwap checks before its
 * transition mode. Nothing under reduced motion. `null` means a direct jump.
 */
export function homeMotion(root) {
  const html = globalThis.document?.documentElement?.classList;
  const reduced = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const balanced = useVidaaHeroTransition(root);
  const standard = "cubic-bezier(0.2, 0, 0, 1)";
  return {
    rail:
      html?.contains("vidaa-tv") && !reduced
        ? {
            duration: html.contains("performance-constrained") ? 100 : 140,
            easing: "cubic-bezier(0.33, 0, 0.67, 1)"
          }
        : null,
    scale: balanced ? { duration: 160, easing: standard } : null,
    hero: balanced ? { duration: 200, easing: standard } : null
  };
}

// One animated property per node (track x, rows y, card scale, hero alpha).
const running = new WeakMap();

/**
 * Animates `prop` of a Lightning node to `value`, or sets it at once without `settings`. A new
 * target stops the running animation where it is (stop(false), no reset), so the next one starts
 * from the current value; the same target never restarts it. Lightning pools its controllers: a
 * handle is dropped as soon as it stops, never stopped twice. `done` follows the end or the stop.
 */
export function tween(node, prop, value, settings, done) {
  const run = running.get(node);
  if (run ? run.value === value : node[prop] === value) return void (!run && done?.());
  run?.ctrl.stop(false);
  if (!settings) {
    node[prop] = value;
    return void done?.();
  }
  const ctrl = node.animate({ [prop]: value }, settings);
  running.set(node, { ctrl, value });
  ctrl.once("stopped", () => {
    if (running.get(node)?.ctrl === ctrl) running.delete(node);
    done?.();
  });
  ctrl.start();
}

/** Ends a running animation of `node` now, at its current value (its `done` runs). */
const settle = (node) => running.get(node)?.ctrl.stop(false);

function hostClass(url) {
  if (/^(?:\/_vercel\/image\?|https:\/\/res\.cloudinary\.com\/)/.test(url)) return "proxy";
  if (/^https?:\/\/image\.tmdb\.org\//.test(url)) return "tmdb";
  if (/^https:\/\/[a-z]+\.metahub\.space\//.test(url)) return "metahub";
  return "autre";
}

function samplePeak() {
  // The field, not getMemoryInfo(): this runs on every move and that one walks every texture.
  const used = liveEngine?.renderer.stage.txMemManager.memUsed || 0;
  glStats.peakTextureBytes = Math.max(glStats.peakTextureBytes, used);
}

/**
 * GPU facts for the Diagnostic, to tell where the hero stripes come from: renderer string,
 * high-precision fragment support, limits, peak texture memory, failures, and a checksum of a
 * hero band read back after drawing a frame (stripes in it come from WebGL, not the compositor).
 */
export function glInfo() {
  const engine = liveEngine;
  if (!engine) return null;
  samplePeak();
  const gl = engine.canvas.getContext("webgl");
  const info = {
    variant: engine.variant,
    renderer: null,
    highFloat: null,
    maxTextureSize: null,
    innerWidth: globalThis.innerWidth ?? null,
    devicePixelRatio: globalThis.devicePixelRatio ?? null,
    peakTextureBytes: glStats.peakTextureBytes,
    failed: { ...glStats.failed },
    proxiedUrls: glStats.proxied.size,
    heroBand: null
  };
  if (!gl) return info;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  info.renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  info.highFloat = high ? { precision: high.precision, rangeMax: high.rangeMax } : null;
  info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  // preserveDrawingBuffer is off: draw now and read in the same task.
  engine.renderer.stage.drawFrame();
  const scale = engine.canvas.width / APP_WIDTH;
  const hero = heroNodeProps();
  const w = Math.max(1, Math.round(hero.w * scale));
  const h = Math.max(1, Math.round(8 * scale));
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(
    Math.round(hero.x * scale),
    engine.canvas.height - Math.round(208 * scale),
    w,
    h,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels
  );
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 1) sum = (sum * 31 + pixels[i]) >>> 0;
  info.heroBand = { w, h, checksum: sum };
  return info;
}
setWebglInfoSource(glInfo);

/**
 * One engine (GL context, shaders, font atlas) per run, reused across Home mounts. `create`
 * gets a `report(reason)` callback; a context lost while Home is away is rebuilt on the next
 * acquire, which re-uploads every texture; any trouble while a view is attached goes to it.
 */
export function createEngineKeeper(create) {
  let record = null;
  let attached = null;
  const keeper = {
    acquire(onTrouble) {
      if (record?.lost) keeper.drop();
      if (!record) {
        const current = { lost: false };
        current.promise = Promise.resolve().then(() =>
          create((reason) => {
            if (reason === "context-lost") current.lost = true;
            if (record === current) attached?.(reason);
          })
        );
        current.promise.catch(() => {
          if (record === current) record = null;
        });
        record = current;
      }
      attached = onTrouble;
      return record.promise;
    },
    release(onTrouble) {
      if (attached === onTrouble) attached = null;
    },
    drop() {
      const current = record;
      record = null;
      current?.promise.then((engine) => engine.dispose()).catch(() => {});
    }
  };
  return keeper;
}

let fontPromise = null;
/** Atlas built once per run; its blob URLs also serve an engine rebuilt after a context loss. */
function fontUrls() {
  fontPromise =
    fontPromise ||
    buildSdfAtlas().then(
      ({ canvas, data }) =>
        new Promise((resolve, reject) =>
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error("font-atlas"));
            resolve({
              atlasUrl: URL.createObjectURL(blob),
              atlasDataUrl: URL.createObjectURL(
                new Blob([JSON.stringify(data)], { type: "application/json" })
              )
            });
          }, "image/png")
        )
    );
  fontPromise.catch(() => (fontPromise = null));
  return fontPromise;
}

async function createEngine(report) {
  if (!globalThis.NuvioLightning) await loadScript(LIB_URL).catch(() => {});
  const L = globalThis.NuvioLightning;
  if (!L) throw new Error("lightning-missing");
  const urls = await fontUrls();
  const variant = getWebglVariant();
  // Lightning keeps SDF fonts in a module cache: a rebuilt engine needs its own family name.
  engineCount += 1;
  const font = `${FONT}${engineCount}`;
  let renderer;
  try {
    renderer = new L.RendererMain(
      {
        appWidth: APP_WIDTH,
        appHeight: APP_HEIGHT,
        deviceLogicalPixelRatio: (globalThis.innerWidth || APP_WIDTH) / APP_WIDTH,
        devicePhysicalPixelRatio: 1,
        renderEngine: L.WebGlCoreRenderer,
        fontEngines: [L.SdfTextRenderer],
        platform:
          variant === "platform-legacy" && L.WebPlatformLegacy
            ? L.WebPlatformLegacy
            : L.WebPlatform,
        createImageBitmapSupport: variant === "bitmap-basic" ? "basic" : "full",
        numImageWorkers: 0,
        // Default 42 ms per frame: uploads would eat a whole 140 ms slide in three frames.
        textureProcessingTimeLimit: 10,
        // A failed URL fails at once: the card's fallbacks, then its text tile, replace retries.
        maxRetryCount: 0,
        clearColor: 0x00000000,
        // Preload about one card or row beyond the clip, like the DOM renderer's margins.
        boundsMargin: 480,
        textureMemory: {
          criticalThreshold: TEXTURE_BUDGET_BYTES,
          targetThresholdLevel: 0.5,
          baselineMemoryAllocation: BASELINE_BYTES
        },
        enableContextSpy: false
      },
      document.createElement("div")
    );
  } catch (_) {
    throw new Error("no-webgl");
  }
  // The focus ring's rounded border (not in Lightning's default shader set).
  renderer.stage.shManager.registerShaderType("RoundedWithBorder", L.RoundedWithBorder);
  const canvas = renderer.canvas;
  canvas.className = "tv2-gl-canvas";
  canvas.addEventListener("webglcontextlost", () => report("context-lost"));
  renderer.on("criticalCleanupFailed", () => report("texture-budget"));
  const dispose = () => {
    if (liveEngine?.renderer === renderer) liveEngine = null;
    try {
      L.SdfTextRenderer.font.unloadFont(font);
      renderer.close();
    } catch (_) {}
    canvas.remove();
    // Free the GPU context now, not at GC, so a rebuild never piles up contexts.
    try {
      canvas.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch (_) {}
  };
  try {
    await renderer.stage.preloadFont("sdf", { fontFamily: font, ...urls });
  } catch (_) {
    dispose();
    throw new Error("font-atlas");
  }
  liveEngine = { renderer, canvas, dispose, font, variant };
  return liveEngine;
}

const keeper = createEngineKeeper(createEngine);

let colorContext = null;
/** CSS color of a theme variable as Lightning's 0xRRGGBBAA. */
function themeColor(element, name, fallback, alpha = 1) {
  colorContext = colorContext || document.createElement("canvas").getContext("2d");
  colorContext.fillStyle = fallback;
  colorContext.fillStyle = getComputedStyle(element).getPropertyValue(name).trim() || fallback;
  const value = String(colorContext.fillStyle);
  let [r, g, b, a] = [0, 0, 0, 1];
  if (value[0] === "#") {
    const n = parseInt(value.slice(1), 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    [r, g, b, a = 1] = (value.match(/[\d.]+/g) || []).map(Number);
  }
  return ((r << 24) | (g << 16) | (b << 8) | Math.round(a * alpha * 255)) >>> 0;
}

/**
 * Lightning image node behind the element-like surface imagePipeline's queue drives. The queue
 * slot is held until Lightning reports `loaded` or `failed`; `failed` lets the queue try the next
 * fallback, and `onState("failed")` follows the last one. Lightning only uploads a texture for a
 * visible node (alpha > 0, inside the preload bounds) and never draws it before it is loaded, so
 * the node shows `alpha` as soon as it has a URL; without one it stays at 0, since a node without
 * texture is painted white. A node leaving the bounds (or whose texture is freed) before loading
 * gives its slot back and is requested again by the next update.
 */
export function imageSlot(node, alpha = 1, onState = () => {}) {
  node.alpha = 0;
  const slot = {
    url: "",
    loading: false,
    onload: null,
    onerror: null,
    getAttribute: (name) => (name === "src" && slot.url) || null,
    removeAttribute: () => set(""),
    set src(url) {
      set(url);
    }
  };
  function set(url) {
    slot.url = url || "";
    slot.loading = Boolean(url);
    // Lightning ignores the same src again: reattach so its texture reports loaded/failed anew.
    if (url && node.src === url) node.src = null;
    node.src = url || null;
    node.alpha = url ? alpha : 0;
    onState(url ? "loading" : "empty");
    if (url && hostClass(url) === "proxy") glStats.proxied.add(url);
    // Already outside the bounds: no event would come until it scrolls back.
    if (url) Promise.resolve().then(() => slot.url === url && node.renderState === 2 && giveBack());
  }
  function giveBack() {
    if (!slot.loading) return;
    const done = slot.onload;
    set("");
    done?.();
  }
  // shortcut: Lightning never reports a 1×1 image as loaded, so it holds its slot until it leaves
  // the bounds; time the slot out if such placeholders show up in real catalogs.
  node.on("loaded", () => {
    if (!slot.loading) return;
    slot.loading = false;
    onState("loaded");
    slot.onload?.();
  });
  node.on("failed", () => {
    if (!slot.loading) return;
    const url = slot.url;
    slot.loading = false;
    glStats.failed[hostClass(url)] += 1;
    slot.onerror?.();
    if (slot.url === url) onState("failed");
  });
  node.on("outOfBounds", giveBack);
  node.on("freed", giveBack);
  return slot;
}

export function createLightningHomeRenderer(
  container,
  { geometry, imageQueue, layout = {}, onFailure }
) {
  container.innerHTML = `
    <div class="tv2-home tv2-home-webgl">
      ${renderLegacySidebar({ selectedRoute: "home", layout })}
      <div class="tv2-gl-host"></div>
      <div class="home-main tv2-gl-proxy"><article class="home-poster-card tv2-card focusable" data-action="openDetail"><div class="tv2-card-title"></div></article></div>
    </div>`;
  const root = container.querySelector(".tv2-home");
  const host = container.querySelector(".tv2-gl-host");
  const proxy = container.querySelector(".tv2-gl-proxy .tv2-card");
  const views = new Map();
  const last = { rows: [], focus: null, options: {}, hero: null };
  // The hero image stays out of the card queue, as in the DOM renderer.
  const heroQueue = createImageQueue({ concurrency: 1 });
  let engine = null;
  let scene = null;
  let closed = false;
  let failed = false;
  let proxyFocused = false;
  let sidebarFocused = null;
  const motion = homeMotion(root);
  // The legacy sidebar is drawn until lot W6: content starts after its rail, even with the pill.
  const geo = { ...geometry, contentStart: RAIL_LEFT, viewport: APP_WIDTH - RAIL_LEFT };

  function fail(reason) {
    if (failed) return;
    failed = true;
    scene = null;
    markWebglFailed(reason);
    keeper.release(fail);
    keeper.drop();
    if (!closed) onFailure?.(reason);
  }

  function buildScene({ renderer, font }) {
    const colors = {
      bg: themeColor(root, "--bg-color", "#0d0d0d"),
      bgClear: themeColor(root, "--bg-color", "#0d0d0d", 0),
      text: themeColor(root, "--text-color", "#ffffff"),
      secondary: themeColor(root, "--text-secondary", "#b3b3b3"),
      tertiary: themeColor(root, "--text-tertiary", "#808080"),
      card: themeColor(root, "--card-bg", "#222222"),
      focus: themeColor(root, "--focus-color", "#ffffff")
    };
    const node = (props) => renderer.createNode(props);
    // Lightning paints any sized node white unless its color is 0: containers stay transparent.
    const group = (props) => renderer.createNode({ color: 0, ...props });
    const text = (props) =>
      renderer.createTextNode({
        fontFamily: font,
        color: colors.text,
        contain: "width",
        maxLines: 1,
        overflowSuffix: "…",
        ...props
      });
    const sceneRoot = node({
      parent: renderer.root,
      w: APP_WIDTH,
      h: APP_HEIGHT,
      color: colors.bg
    });
    const hero = heroNodeProps(layout);
    // Two hero images: the next one loads hidden over the shown one, then fades in (setHero).
    const heroLayer = group({ parent: sceneRoot });
    const heroSlots = [0, 1].map(() => {
      const image = node({ parent: heroLayer, ...hero });
      const slot = imageSlot(image, HERO_LOADING_ALPHA, (state) => heroState(slot, state));
      slot.node = image;
      return slot;
    });
    // Left and bottom fades of the hero media (components-16.css ::before/::after), two stops.
    node({
      parent: sceneRoot,
      x: hero.x,
      w: hero.w * 0.45,
      h: hero.h,
      colorLeft: colors.bg,
      colorRight: colors.bgClear
    });
    node({
      parent: sceneRoot,
      x: hero.x,
      y: hero.h * 0.4,
      w: hero.w,
      h: hero.h * 0.6,
      colorTop: colors.bgClear,
      colorBottom: colors.bg
    });
    const rowsClip = group({
      parent: sceneRoot,
      y: MAIN_TOP,
      w: APP_WIDTH,
      h: APP_HEIGHT - MAIN_TOP,
      clipping: true
    });
    return {
      renderer,
      colors,
      node,
      group,
      text,
      root: sceneRoot,
      hero: { front: heroSlots[0], back: heroSlots[1], shown: "", wanted: "" },
      heroTitle: text({ parent: sceneRoot, x: RAIL_LEFT, y: 300, fontSize: 64, maxWidth: 900 }),
      heroDescription: text({
        parent: sceneRoot,
        x: RAIL_LEFT,
        y: 390,
        fontSize: 26,
        lineHeight: 36,
        maxWidth: 900,
        maxLines: 3,
        color: colors.secondary
      }),
      rowsLayer: group({ parent: rowsClip }),
      // Child of the focused card, so it follows its slide and scale; transparent inside.
      ring: node({
        parent: sceneRoot,
        x: -FOCUS_RING,
        y: -FOCUS_RING,
        color: 0,
        alpha: 0,
        shader: renderer.createShader("RoundedWithBorder", {
          radius: (geometry.radius ?? 24) + FOCUS_RING,
          "border-w": FOCUS_RING,
          "border-color": colors.focus
        })
      })
    };
  }

  function setRows(rows) {
    last.rows = rows;
    if (!scene) return;
    const kept = new Map(rows.map((row) => [row.key, rowCardSize(row, geo)]));
    for (const [key, view] of views) {
      const size = kept.get(key);
      // A row whose card shape changed (kind, tile shape) gets new pooled cards.
      if (!size || size.width !== view.size.width || size.height !== view.size.height) {
        // The ring may sit on one of its cards; the next update puts it back on the focus.
        scene.ring.parent = scene.root;
        scene.ring.alpha = 0;
        view.node.destroy();
        views.delete(key);
      }
    }
    rows.forEach((row) => {
      let view = views.get(row.key);
      if (!view) {
        const rowNode = scene.group({ parent: scene.rowsLayer });
        view = {
          node: rowNode,
          title: scene.text({
            parent: rowNode,
            x: geo.contentStart,
            y: 10,
            fontSize: 32,
            maxWidth: geo.viewport
          }),
          status: scene.text({
            parent: rowNode,
            x: geo.contentStart,
            y: 70,
            fontSize: 24,
            maxWidth: geo.viewport,
            color: scene.colors.tertiary
          }),
          track: scene.group({ parent: rowNode }),
          slots: [],
          size: kept.get(row.key),
          placed: false
        };
        views.set(row.key, view);
      }
      view.title.text = row.title || "";
      // Loading rows stay empty, without skeleton cards (lot C12); no error text (D1).
      view.status.text =
        row.items.length || row.status !== "loading" ? "" : t("common.loading", {}, "Loading");
    });
  }

  function slotCard(view, slot) {
    let card = view.slots[slot];
    if (!card) {
      const { width, height } = view.size;
      const cardNode = scene.node({
        parent: view.track,
        w: width,
        h: height,
        color: scene.colors.card,
        pivot: 0.5,
        zIndex: 1
      });
      const image = scene.node({ parent: cardNode, w: width, h: height, textureOptions: COVER });
      card = { node: cardNode, image: null, title: null, index: -1, rowKey: "", x: null };
      const scrim = scene.node({
        parent: cardNode,
        y: height - 80,
        w: width,
        h: 80,
        colorTop: 0x00000000,
        colorBottom: 0x000000c0
      });
      card.title = scene.text({
        parent: cardNode,
        x: 12,
        y: height - 40,
        fontSize: 22,
        maxWidth: width - 24
      });
      // Failed image: the card background with the title centered (mobile text fallback).
      card.fallback = scene.text({
        parent: cardNode,
        x: 28,
        y: height / 2,
        mountY: 0.5,
        fontSize: 28,
        lineHeight: 34,
        maxWidth: width - 56,
        maxLines: 3,
        textAlign: "center",
        color: FALLBACK_TEXT,
        alpha: 0
      });
      card.showTile = (on) => {
        card.fallback.alpha = on ? 1 : 0;
        scrim.alpha = card.title.alpha = on ? 0 : 1;
      };
      card.image = imageSlot(image, 1, (state) => {
        card.showTile(state === "failed");
        // Given back (out of bounds, freed) or cleared: the next update asks again.
        if (state === "empty") card.wanted = null;
      });
      view.slots[slot] = card;
    }
    return card;
  }

  function updateProxy(rows, focus, sidebarIndex, hideFocus) {
    const row = rows[focus.row];
    const index = focusedIndex(focus, rows);
    // A hold menu is open (current Home lockHomeHoldFocus): nothing focused.
    const item = sidebarIndex < 0 && !hideFocus ? row?.items[index] : null;
    proxyFocused = Boolean(item);
    if (item) {
      fillCard(proxy, item, index, row);
      setNavPosition(proxy, navRowOf(rows, focus.row), index);
    }
    proxy.className = `${row?.kind === "continue" ? "home-continue-card" : "home-poster-card"} tv2-card focusable${proxyFocused ? " focused" : ""}`;
    sidebarFocused?.classList.remove("focused");
    sidebarFocused = sidebarIndex >= 0 && !hideFocus ? sidebarItems()[sidebarIndex] || null : null;
    sidebarFocused?.classList.add("focused");
    root.classList.toggle("tv2-sidebar-open", sidebarIndex >= 0);
    const sidebar = container.querySelector(".home-sidebar");
    sidebar?.classList.toggle("expanded", sidebarIndex >= 0);
    sidebar?.classList.toggle("content-expanded", sidebarIndex >= 0);
  }

  /**
   * Card position and focus scale, as the DOM renderer's placeCard: only a card staying in place
   * tweens its scale; a placed or recycled card jumps instead of sliding across the rail.
   */
  function placeCard(card, x, scaled) {
    const stays = card.x === x;
    card.x = card.node.x = x;
    if (stays && card.scaled === scaled) return;
    card.scaled = scaled;
    tween(card.node, "scale", scaled ? FOCUS_SCALE : 1, stays ? motion.scale : null);
  }

  /**
   * Same window and positions as the DOM renderer (homeLayout). Only the rails and the rows layer
   * slide; the rows drawn are the visible ones plus one on each side, and an image is requested
   * only when a card's URL changes (or it is the focused card, to keep its priority).
   */
  function update(rows, focus, options = {}) {
    const { sidebarIndex = -1, hideFocus = false } = options;
    Object.assign(last, { rows, focus, options });
    updateProxy(rows, focus, sidebarIndex, hideFocus);
    if (!scene) return;
    samplePeak();
    const placed = homeLayout(rows, focus, geo);
    const focusIndex = focusedIndex(focus, rows);
    const focusShown = sidebarIndex < 0 && !hideFocus;
    const viewHeight = APP_HEIGHT - MAIN_TOP;
    const visible = placed.rows.map(
      ({ top, height }) => top + placed.offsetY < viewHeight && top + height + placed.offsetY > 0
    );
    const firstRow = visible.indexOf(true) - 1;
    const lastRow = visible.lastIndexOf(true) + 1;
    let ringCard = null;
    placed.rows.forEach(({ row, size, pitch, win, top, height }, rowIndex) => {
      const view = views.get(row.key);
      if (!view) return;
      view.node.y = top;
      if (rowIndex < firstRow || rowIndex > lastRow) return;
      view.track.y = height - size.height - rowLabelHeight(row, geo) - geo.rowGap;
      const loadImages = rowIndex >= focus.row - 1 && rowIndex <= focus.row + 2;
      view.slots.forEach((card) => (card.node.alpha = 0));
      for (let i = win.start; i < win.end; i += 1) {
        const item = row.items[i];
        const card = slotCard(view, slotFor(i, win.poolSize));
        const changed = card.index !== i || card.rowKey !== row.key || card.item !== item;
        if (changed) {
          card.item = item;
          card.index = i;
          card.rowKey = row.key;
          card.title.text = card.fallback.text = String(item.name || item.title || "");
          card.source = cardImage(row, item, size, layout, glImageUrl);
        }
        card.node.alpha = 1;
        const focused = rowIndex === focus.row && i === focusIndex;
        const url = loadImages ? card.source.url : "";
        if (card.wanted !== url || focused) {
          card.wanted = url;
          imageQueue.request(card.image, url, {
            fallbacks: card.source.fallbacks,
            priority: focused
          });
        }
        // No artwork at all: the mobile shows the same text tile (ShelfComponents.kt, imageUrl null).
        if (!card.source.url) card.showTile(true);
        else if (changed) card.showTile(false);
        placeCard(card, i * pitch, Boolean(motion.scale) && focusShown && focused);
        if (focused) ringCard = card;
      }
      // A new row is placed where it belongs, never slid in from the left edge.
      tween(view.track, "x", geo.contentStart + win.offset, view.placed ? motion.rail : null);
      view.placed = true;
    });
    tween(scene.rowsLayer, "y", placed.offsetY, scene.placed ? motion.rail : null);
    scene.placed = true;

    const { ring } = scene;
    if (ringCard && focusShown) {
      if (ring.parent !== ringCard.node) {
        ring.parent = ringCard.node;
        ring.w = ringCard.node.w + 2 * FOCUS_RING;
        ring.h = ringCard.node.h + 2 * FOCUS_RING;
      }
      ring.alpha = 1;
    } else {
      ring.alpha = 0;
    }
  }

  /**
   * Hero image swap: the next image loads in the hidden node over the shown one, fades in once
   * Lightning reports it loaded (200 ms on VIDAA, a cut outside the motion guard), then the old
   * texture is let go. The same image again never restarts a running fade.
   */
  function heroState(slot, state) {
    const hero = scene?.hero;
    if (!hero || slot !== hero.back) return;
    if (state === "loaded") {
      const old = hero.front;
      hero.front = slot;
      hero.back = old;
      hero.shown = hero.wanted;
      slot.node.zIndex = 1;
      old.node.zIndex = 0;
      tween(slot.node, "alpha", 1, motion.hero, () => !closed && heroQueue.request(old, ""));
    } else if (state === "failed") {
      // No backdrop for this title: never keep the previous title's one.
      heroQueue.request(hero.front, "");
      hero.shown = "";
    }
  }

  function setHero(item) {
    last.hero = item;
    if (!scene) return;
    scene.heroTitle.text = item?.name || item?.title || "";
    scene.heroDescription.text = item?.description || "";
    // DOM backdrop order (buildHeroBackdropSources), without the poster: cover would crop it to a strip.
    const display = item ? buildModernHeroPresentation(item) : null;
    const width = engine.variant === "hero-780" ? 780 : 1280;
    const [url = "", ...fallbacks] = [
      ...new Set(
        [display?.backdrop, ...(display?.backdropFallbacks || [])]
          .filter((source) => source && source !== item.poster)
          .map((source) => glImageUrl(source, width))
      )
    ];
    const { hero } = scene;
    if (url === hero.shown) {
      if (hero.wanted !== url) heroQueue.request(hero.back, "");
      hero.wanted = url;
      return;
    }
    // A fade still running ends now, so the node about to load is no longer on screen.
    settle(hero.front.node);
    hero.wanted = url;
    heroQueue.request(hero.back, url, { fallbacks });
    if (!url) {
      heroQueue.request(hero.front, "");
      hero.shown = "";
    }
  }

  function setProfile(profile) {
    const sidebar = container.querySelector(".home-sidebar");
    if (!sidebar) return;
    sidebar.outerHTML = renderLegacySidebar({ selectedRoute: "home", layout, profile });
    sidebarFocused = null;
    if (last.focus)
      updateProxy(last.rows, last.focus, last.options.sidebarIndex ?? -1, last.options.hideFocus);
  }

  function sidebarItems() {
    return Array.from(container.querySelectorAll(".home-sidebar .focusable"));
  }

  keeper
    .acquire(fail)
    .then((ready) => {
      if (closed || failed) return keeper.release(fail);
      engine = ready;
      engine.renderer.targetFPS = 0;
      host.appendChild(engine.canvas);
      scene = buildScene(engine);
      setRows(last.rows);
      if (last.focus) update(last.rows, last.focus, last.options);
      setHero(last.hero);
    })
    .catch((error) => fail(error?.message || "init"));

  return {
    engine: "webgl",
    setRows,
    update,
    setHero,
    setProfile,
    sidebarItems,
    focusedNode: () => sidebarFocused || (proxyFocused ? proxy : null),
    destroy() {
      closed = true;
      heroQueue.clear();
      if (scene) {
        scene.root.destroy();
        // Leaving Home (often for the player): free every texture the scene held.
        engine.renderer.stage.cleanup(true);
        // maxRetryCount 0: a failed texture stays cached as failed for the kept engine's life.
        // Forget failures on leaving Home, so a network blip is retried on the next visit.
        const { txManager } = engine.renderer.stage;
        for (const texture of [...txManager.keyCache.values()])
          if (texture.state === "failed") txManager.removeTextureFromCache(texture);
      }
      scene = null;
      // The kept engine's idle loop would wake 60 times a second while away (e.g. in the player);
      // 4 fps keeps the return to Home under 250 ms. stopLoop() cannot be undone safely.
      if (engine) engine.renderer.targetFPS = 4;
      engine?.canvas.remove();
      keeper.release(fail);
      views.clear();
      sidebarFocused = null;
    }
  };
}
