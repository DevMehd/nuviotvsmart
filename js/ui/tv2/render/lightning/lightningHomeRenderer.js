import { loadScript } from "../../../../runtime/loadStreamingLibs.js";
import { homeLayout, rowCardSize, rowLabelHeight, slotFor } from "../../railEngine.js";
import { t } from "../../../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { focusedIndex } from "../../focusModel.js";
import { createImageQueue, glImageUrl } from "../../imagePipeline.js";
import { cardImage, fillCard, navRowOf, setNavPosition } from "../../renderer.js";
import {
  getWebglVariant,
  markWebglFailed,
  sessionNewHomeMode,
  setWebglInfoSource
} from "../../newHomeSetting.js";
import { createHomeSidebar } from "../../homeSidebar.js";
import { Platform as AppPlatform } from "../../../../platform/index.js";
import { buildModernHeroPresentation } from "../../../screens/home/homeScreenHelpers-11-build-hero-display-model.js";
import { ATLAS_WEIGHTS, atlasUrls, glText } from "./sdfAtlas.js";
import { createHeroCopy } from "./heroCopy.js";
import { useVidaaHeroTransition } from "../../../screens/home/vidaaHeroTransition.js";
import { isTitleItemWatched } from "../../../components/watchedTitleBadge.js";
import {
  mountTrailerMedia,
  pauseTrailerMedia,
  releaseTrailerMedia
} from "../../../screens/home/homeTrailerLayer.js";

// New TV Home (nuv-091, lot B2), 100 % WebGL prototype on Lightning: hero, rails, text (SDF
// atlases, canvas text for characters outside them) and focus are drawn in one canvas. Same interface as createDomHomeRenderer. The
// sidebar (legacy rail or modern pill) stays the shared DOM one (homeSidebar.js); a hidden DOM proxy of the focused card keeps
// openDetail and the diagnostic driver selectors working. Any failure reports to `onFailure`
// and the screen swaps to the DOM renderer for the rest of the run.

const LIB_URL = "assets/runtime/tv2-lightning.js";
const FONT = "Tv2Sans";
let engineCount = 0;
const APP_WIDTH = 1920;
const APP_HEIGHT = 1080;
// Same layout as css/tv2-home.css.
const MAIN_TOP = 560;
// Focus ring of the DOM card (tv2-home.css .tv2-card.focused box-shadow): 3 px, --focus-color.
const FOCUS_RING = 3;
const FOCUS_SCALE = 1.015;
// The incoming hero image loads at this alpha: Lightning only uploads a visible node's texture.
const HERO_LOADING_ALPHA = 0.01;
// Hero trailer reveal: the DOM trailer layer's opacity transition (components-16.css).
const TRAILER_FADE = { duration: 480, easing: "ease" };
// Fixed GPU budget: the image windows of renderer.js need about 45 MB (poster ~0.7 MB, hero
// 3.7 MB). Still above it after Lightning's own cleanup means the TV cannot hold the scene.
export const TEXTURE_BUDGET_BYTES = 64 * 1024 * 1024;
// Render loop at the display rate while Home is shown: at rest Lightning only polls, draws nothing.
// A throttled idle loop (10 fps, lot W6) delayed the first frame after a key by up to 100 ms, then
// fed it a 100 ms delta that ended the 140 ms slides at once (WF-01). Away from Home: AWAY_FPS.
const AWAY_FPS = 4;
// Rows around the focus whose artwork stays attached off screen (lot W6 warm ring), so a short
// move back finds its textures; rows farther away let theirs go.
const WARM_ROWS = { before: 2, after: 3 };
// Memory outside the image textures: the two SDF font atlases (1024×276 px each, about 1.2 MB as
// RGBA) and the hero copy's few canvas texts. Lightning assumes 26 MB by default, which would
// leave a 40-card window too little room before criticalCleanup.
const BASELINE_BYTES = 5 * 1024 * 1024;
// Mobile text fallback of a failed image (ShelfComponents.kt:194-203): textMuted, 16 sp → 28 px.
const FALLBACK_TEXT = 0x969ca3ff;
// Hero skeleton (lot W3): the DOM loading gradient, shimmering outside constrained runtimes.
const SKELETON = { colorTop: 0x262626ff, colorBottom: 0x101010ff };
const COVER = { resizeMode: { type: "cover" } };
/**
 * Continue Watching card (lot W4a): mobile HomeContinueWatchingSection.kt at the TV sizes of the
 * mobile reference (dp × 2, sp × 1.75–2). Copy stacked bottom-up from `pad`, badge top right,
 * progress pill track 20 px from the sides and 8 px from the bottom.
 */
export const CW_CARD = {
  pad: 24,
  gap: 4,
  // Bottom-up order; keys of continueCardModel.
  lines: [
    { key: "subtitle", fontSize: 22, lineHeight: 30, alpha: 0.72 },
    { key: "title", fontSize: 28, lineHeight: 38, weight: 600 },
    { key: "kicker", fontSize: 22, lineHeight: 30, weight: 600 }
  ],
  // The scrim starts at 45 % of the height (mobile l. 741-761).
  scrimTop: 0.45,
  badge: { inset: 16, padX: 16, padY: 8, fontSize: 20, lineHeight: 28, radius: 8 },
  progress: { side: 20, bottom: 8, h: 6, track: 0x0000004d },
  // Release badges of the mobile (l. 79-81): new episode, new season.
  newEpisode: 0x1d4ed8ff,
  newSeason: 0xb45309ff,
  // tv2-home.css .tv2-continue-card background (145deg #393939 → #111), two stops.
  background: { colorTop: 0x393939ff, colorBottom: 0x111111ff }
};
// Loading row cards (mobile HomeSkeletonLoading.kt): surface #1A1A1A; the row pulses 1 ↔ 0.6.
const ROW_SKELETON = 0x1a1a1aff;
/**
 * Card extras (lot W4b) at the TV sizes of the mobile reference: watched badge (PosterActionSheet.kt,
 * eye on the accent), landscape overlay (ShelfComponents.kt:207-247: logo box, else the title on
 * 2 lines, over a black scrim on the bottom 42 %), folder emoji, card depth (CardDepthEffect.kt).
 */
export const CARD_EXTRAS = {
  watched: { size: 40, inset: 12, icon: 24 },
  landscape: {
    scrim: 0.42,
    scrimColor: 0x000000bf,
    pad: 20,
    gap: 4,
    logo: { w: 232, h: 60 },
    title: { fontSize: 24, lineHeight: 30, maxLines: 2, weight: 600 },
    subtitle: { fontSize: 22, lineHeight: 28, alpha: 0.78 }
  },
  emoji: { fontSize: 72, lineHeight: 88, color: 0xffffffff },
  tile: { fontSize: 28, lineHeight: 34, color: FALLBACK_TEXT },
  depth: { edge: 2, sheen: 0.22 }
};
// Material "Visibility" (the mobile watched icon), 24×24 viewBox.
const EYE_PATH =
  "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
const TMDB_ANY_SIZE = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)\//;

/**
 * Next Up blur (lot W4b), the cheap version: TMDB's smallest size (w92) stretched over the card
 * instead of a blur shader. Another host cannot be shrunk (the proxy stays for no-CORS posters at
 * 256), so its card gets the mobile spec's veil in the background color instead (`veil`).
 */
export function blurredSource(source) {
  const tiny = (url) => String(url || "").replace(TMDB_ANY_SIZE, "$1w92/");
  const url = tiny(source.url);
  // A fallback shrunk to the same URL would only retry the one that just failed.
  const fallbacks = [...new Set(source.fallbacks.map(tiny))].filter((value) => value !== url);
  return { ...source, url, fallbacks, veil: url === source.url };
}

/**
 * Hero media fades (components-16.css .home-modern-hero-media ::before and ::after, the framed
 * hero and the full-screen backdrop): [position, background alpha] stops, the left one over
 * `width` of the media.
 */
export const HERO_FADES = {
  framed: {
    width: 0.45,
    left: [
      [0, 1],
      [0.22, 0.86],
      [0.46, 0.56],
      [0.76, 0.16],
      [1, 0]
    ],
    bottom: [
      [0.82, 0],
      [0.892, 0.25],
      [0.955, 0.65],
      [1, 1]
    ]
  },
  fullScreen: {
    width: 0.65,
    left: [
      [0, 1],
      [0.22, 0.9],
      [0.46, 0.8],
      [0.76, 0.42],
      [1, 0]
    ],
    bottom: [
      [0.64, 0],
      [0.748, 0.35],
      [0.856, 0.75],
      [1, 1]
    ]
  }
};

const shimmers = (motion) =>
  Boolean(motion.copy) &&
  !globalThis.document?.documentElement?.classList?.contains("performance-constrained");

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
 * transition mode; the hero copy fades in over 150 ms (mobile). Nothing under reduced motion.
 * `null` means a direct jump.
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
    hero: balanced ? { duration: 200, easing: standard } : null,
    copy: balanced ? { duration: 150, easing: standard } : null
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
  running.set(node, { ctrl, prop, value });
  ctrl.once("stopped", () => {
    if (running.get(node)?.ctrl === ctrl) running.delete(node);
    done?.();
  });
  ctrl.start();
}

/** Ends a running animation of `node` now, at its target (its `done` runs): never half-faded. */
export function settle(node) {
  const run = running.get(node);
  if (!run) return;
  run.ctrl.stop(false);
  node[run.prop] = run.value;
}

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
    // Render loop rate now: 0 (display rate) on Home, AWAY_FPS while Home is away.
    targetFPS: engine.renderer.targetFPS,
    heroBand: null
  };
  if (!gl) return info;
  info.renderer = glRendererName(gl);
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

/** GL renderer string (unmasked when the TV allows it), as the Diagnostic shows it. */
function glRendererName(gl) {
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/**
 * Lot W6: a software WebGL (SwiftShader, llvmpipe) draws on the CPU, slower than the DOM Home, so
 * VIDAA refuses it as "no-webgl:<renderer>" (kept in homeEngineFallback). Other platforms accept it
 * (desktop checks and the SwiftShader fixture run there). Returns the refusal reason, or "".
 */
export function softwareWebglRefusal(rendererName, vidaa) {
  return vidaa && /swiftshader|llvmpipe|softpipe/i.test(rendererName)
    ? `no-webgl:${rendererName}`
    : "";
}

let libLoad = null;
/** tv2-lightning.js once per run; preloaded during startup in WebGL mode (lot W6). */
export function loadLightning() {
  if (globalThis.NuvioLightning) return Promise.resolve();
  libLoad ||= loadScript(LIB_URL).catch(() => {
    libLoad = null;
  });
  return libLoad;
}

/** Startup (app.js): fetch and parse the WebGL library while the app boots, WebGL mode only. */
export function preloadWebglHome() {
  if (sessionNewHomeMode() === "webgl") void loadLightning();
}

async function createEngine(report) {
  await loadLightning();
  const L = globalThis.NuvioLightning;
  if (!L) throw new Error("lightning-missing");
  const variant = getWebglVariant();
  // Lightning keeps SDF fonts in a module cache: a rebuilt engine needs its own family name.
  engineCount += 1;
  const font = `${FONT}${engineCount}`;
  const fonts = Object.fromEntries(ATLAS_WEIGHTS.map((weight) => [weight, `${font}-${weight}`]));
  const Platform =
    variant === "platform-legacy" && L.WebPlatformLegacy ? L.WebPlatformLegacy : L.WebPlatform;
  // Variant trailer-above (lot W5 fallback): the trailer goes over the canvas, which can be opaque.
  // The first getContext call fixes the attributes; Lightning's own call then gets this context.
  class OpaquePlatform extends Platform {
    createContext() {
      this.canvas?.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      });
      return super.createContext();
    }
  }
  let renderer;
  try {
    renderer = new L.RendererMain(
      {
        appWidth: APP_WIDTH,
        appHeight: APP_HEIGHT,
        deviceLogicalPixelRatio: (globalThis.innerWidth || APP_WIDTH) / APP_WIDTH,
        devicePhysicalPixelRatio: 1,
        renderEngine: L.WebGlCoreRenderer,
        // Canvas text only for a text the atlases lack (glText): one texture per node.
        fontEngines: [L.SdfTextRenderer, L.CanvasTextRenderer].filter(Boolean),
        platform: variant === "trailer-above" ? OpaquePlatform : Platform,
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
  const gl = renderer.canvas.getContext("webgl");
  const refusal = gl ? softwareWebglRefusal(glRendererName(gl), AppPlatform.isVidaa()) : "";
  if (refusal) {
    try {
      renderer.close();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch (_) {}
    throw new Error(refusal);
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
      Object.values(fonts).forEach((family) => L.SdfTextRenderer.font.unloadFont(family));
      renderer.close();
    } catch (_) {}
    canvas.remove();
    // Free the GPU context now, not at GC, so a rebuild never piles up contexts.
    try {
      canvas.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch (_) {}
  };
  try {
    await Promise.all(
      ATLAS_WEIGHTS.map((weight) =>
        renderer.stage.preloadFont("sdf", {
          fontFamily: fonts[weight],
          // Absolute: Lightning decodes images in a blob worker, where a relative URL fails.
          ...Object.fromEntries(
            Object.entries(atlasUrls(weight)).map(([key, url]) => [
              key,
              new URL(url, document.baseURI).href
            ])
          )
        })
      )
    );
  } catch (_) {
    dispose();
    throw new Error("font-atlas");
  }
  liveEngine = { renderer, canvas, dispose, fonts, variant };
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

/**
 * Pooled card of a row in `parent` (its track). Posters carry no title (D2, mobile): a failed or
 * missing image shows the mobile text tile instead (a folder's emoji when it has no cover).
 * Landscape posters carry the logo or title overlay instead of the tile. Continue Watching cards
 * carry the scrim, badge, copy and progress of CW_CARD and keep them when the image fails, as
 * the DOM card does. Catalog cards get the watched badge; cards get the depth when it is on.
 * `scene`: node, group, text, retext, shader, colors, watchedTexture and depth of buildScene.
 */
export function createGlCard(scene, parent, kind, { width, height }) {
  const continueCard = kind === "continue";
  const node = scene.node({
    parent,
    w: width,
    h: height,
    ...(continueCard ? CW_CARD.background : { color: scene.colors.card }),
    pivot: 0.5,
    zIndex: 1
  });
  const image = scene.node({ parent: node, w: width, h: height, textureOptions: COVER });
  const card = {
    node,
    kind,
    index: -1,
    rowKey: "",
    x: null,
    item: null,
    cw: null,
    fallback: null,
    landscape: null,
    watched: null
  };
  if (continueCard) card.cw = continueParts(scene, node, width, height);
  else if (kind === "poster" && width > height)
    card.landscape = landscapeParts(scene, node, width, height);
  else
    card.fallback = scene.text({
      parent: node,
      x: 28,
      y: height / 2,
      mountY: 0.5,
      ...CARD_EXTRAS.tile,
      maxWidth: width - 56,
      maxLines: 3,
      textAlign: "center",
      alpha: 0
    });
  if (kind === "poster") {
    const { size, inset } = CARD_EXTRAS.watched;
    card.watched = scene.node({
      parent: node,
      x: width - inset - size,
      y: inset,
      w: size,
      h: size,
      texture: scene.watchedTexture,
      alpha: 0
    });
  }
  if (scene.depth?.[continueCard ? "continue" : "posters"]) depthParts(scene, node, width, height);
  card.showTile = (on) => card.fallback && (card.fallback.alpha = on ? 1 : 0);
  card.image = imageSlot(image, 1, (state) => {
    card.showTile(state === "failed");
    // Given back (out of bounds, freed) or cleared: the next update asks again.
    if (state === "empty") card.wanted = null;
  });
  return card;
}

// Mobile depth (top edge and sheen over the top 22 %), white at the user's strengths.
function depthParts(scene, parent, width, height) {
  const { edge, sheen } = scene.depth;
  scene.node({
    parent,
    w: width,
    h: Math.round(height * CARD_EXTRAS.depth.sheen),
    colorTop: sheen,
    colorBottom: 0xffffff00
  });
  scene.node({ parent, w: width, h: CARD_EXTRAS.depth.edge, color: edge });
}

/** Landscape overlay: logo fitted bottom left once loaded, else the title; subtitle under it. */
function landscapeParts(scene, parent, width, height) {
  const L = CARD_EXTRAS.landscape;
  const top = Math.round(height * (1 - L.scrim));
  scene.node({
    parent,
    y: top,
    w: width,
    h: height - top,
    colorTop: 0x00000000,
    colorBottom: L.scrimColor
  });
  const logoNode = scene.node({ parent, x: L.pad, mountY: 1, w: L.logo.w, h: L.logo.h });
  const maxWidth = width - 2 * L.pad;
  const parts = {
    url: "",
    failed: false,
    logoNode,
    title: scene.text({ parent, x: L.pad, mountY: 1, maxWidth, ...L.title }),
    subtitle: scene.text({ parent, x: L.pad, maxWidth, ...L.subtitle })
  };
  parts.logo = imageSlot(logoNode, 1, (state) => {
    if (state === "loaded") {
      const { w = L.logo.w, h = L.logo.h } = logoNode.texture?.dimensions || {};
      const scale = Math.min(L.logo.w / w, L.logo.h / h);
      logoNode.w = Math.round(w * scale);
      logoNode.h = Math.round(h * scale);
    }
    parts.failed = state === "failed";
    // The title stands in while there is no logo, or once it failed.
    parts.title.alpha = parts.url && !parts.failed ? 0 : 1;
  });
  return parts;
}

/** Watched badge texture shared by every card: accent circle, eye in the on-accent color. */
function watchedBadgeTexture(renderer, fill, glyph) {
  const { size, icon } = CARD_EXTRAS.watched;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
  ctx.fill();
  ctx.translate((size - icon) / 2, (size - icon) / 2);
  ctx.scale(icon / 24, icon / 24);
  ctx.fillStyle = glyph;
  ctx.fill(new Path2D(EYE_PATH));
  return renderer.createTexture("ImageTexture", { src: canvas });
}

function continueParts(scene, parent, width, height) {
  const C = CW_CARD;
  // Next Up veil for artwork that cannot be shrunk (blurredSource), under the scrim and copy.
  const veil = scene.node({ parent, w: width, h: height, color: scene.colors.veil, alpha: 0 });
  const top = Math.round(height * C.scrimTop);
  scene.node({
    parent,
    y: top,
    w: width,
    h: height - top,
    colorTop: scene.colors.bgClear,
    colorBottom: scene.colors.scrim
  });
  const badge = scene.node({
    parent,
    x: width - C.badge.inset,
    y: C.badge.inset,
    mountX: 1,
    h: C.badge.lineHeight + 2 * C.badge.padY,
    color: scene.colors.cwBadge,
    shader: scene.shader({ radius: C.badge.radius, "border-w": 0 })
  });
  const parts = { veil, badge, badgeText: null };
  parts.badgeText = measureBadge(
    parts,
    scene.text({
      parent: badge,
      x: C.badge.padX,
      y: C.badge.padY,
      fontSize: C.badge.fontSize,
      lineHeight: C.badge.lineHeight,
      weight: 600,
      contain: "none",
      // Cards are not clipped: a long badge (German, small posters) ends with "…" inside the card.
      maxWidth: width - 2 * (C.badge.inset + C.badge.padX)
    })
  );
  C.lines.forEach((line) => {
    const { key, weight = 400, ...props } = line;
    parts[key] = scene.text({ parent, x: C.pad, weight, maxWidth: width - 2 * C.pad, ...props });
  });
  parts.track = scene.node({
    parent,
    x: C.progress.side,
    y: height - C.progress.bottom - C.progress.h,
    w: width - 2 * C.progress.side,
    h: C.progress.h,
    color: C.progress.track
  });
  parts.fill = scene.node({
    parent: parts.track,
    w: 0,
    h: C.progress.h,
    color: scene.colors.accent
  });
  return parts;
}

// The badge frame takes the width its text reports once laid out.
function measureBadge(parts, textNode) {
  textNode.on("loaded", (_, payload) => {
    if (parts.badgeText === textNode)
      parts.badge.w = (payload?.dimensions?.w || 0) + 2 * CW_CARD.badge.padX;
  });
  return textNode;
}

/**
 * Card content for `item` from cardImage's `source`: the text tile's title (a folder's emoji
 * without cover), the landscape overlay, the watched badge (`watchedIds`, isTitleItemWatched),
 * or the Continue Watching model `source.cw`.
 */
export function fillGlCard(scene, card, item, source, watchedIds = null) {
  const cw = source.cw;
  if (card.watched)
    card.watched.alpha =
      source.model && isTitleItemWatched(source.model.normalized, watchedIds) ? 1 : 0;
  if (card.landscape) return fillLandscape(scene, card.landscape, source.model);
  if (!cw) {
    const emoji = card.kind === "collection" && !source.url ? item.coverEmoji || "" : "";
    card.fallback = scene.retext(card.fallback, emoji || String(item.name || item.title || ""));
    Object.assign(card.fallback, emoji ? CARD_EXTRAS.emoji : CARD_EXTRAS.tile);
    return;
  }
  const parts = card.cw;
  parts.veil.alpha = cw.blur && source.veil ? 1 : 0;
  let bottom = card.node.h - CW_CARD.pad;
  CW_CARD.lines.forEach(({ key, lineHeight }) => {
    parts[key] = scene.retext(parts[key], cw[key] || "");
    if (!cw[key]) return;
    bottom -= lineHeight;
    parts[key].y = bottom;
    bottom -= CW_CARD.gap;
  });
  const badgeText = scene.retext(parts.badgeText, cw.badge || "");
  if (badgeText !== parts.badgeText) parts.badgeText = measureBadge(parts, badgeText);
  const { isNextUp, isReleaseAlert, isNewSeasonRelease } = cw.normalized || {};
  parts.badge.color =
    isNextUp && isReleaseAlert
      ? isNewSeasonRelease
        ? CW_CARD.newSeason
        : CW_CARD.newEpisode
      : scene.colors.cwBadge;
  parts.fill.w = Math.round(
    (Math.max(0, Math.min(100, cw.progressPct || 0)) / 100) * parts.track.w
  );
}

// The logo URL is only chosen here: update() requests it last, at the lowest priority.
function fillLandscape(scene, parts, model) {
  const L = CARD_EXTRAS.landscape;
  const normalized = model?.normalized || {};
  const url = normalized.logo ? glImageUrl(normalized.logo, L.logo.w) : "";
  if (url !== parts.url) {
    parts.url = url;
    parts.failed = false;
    parts.logoNode.w = L.logo.w;
    parts.logoNode.h = L.logo.h;
  }
  parts.title = scene.retext(parts.title, normalized.name || "Untitled");
  parts.subtitle = scene.retext(parts.subtitle, model?.subtitle || "");
  parts.title.alpha = parts.url && !parts.failed ? 0 : 1;
  let bottom = parts.logoNode.parent.h - L.pad;
  if (parts.subtitle.text) {
    parts.subtitle.y = bottom - L.subtitle.lineHeight;
    bottom -= L.subtitle.lineHeight + L.gap;
  }
  parts.title.y = parts.logoNode.y = bottom;
}

/**
 * `count` loading cards in the row's track (DOM setSkeletons), at the card size and pitch; the
 * whole row pulses (one animation, not one per card) when `pulse`. Count 0 removes them.
 */
export function setRowSkeletons(scene, view, count, gap, pulse) {
  const current = view.skeleton;
  if ((current?.count || 0) === count) return;
  if (current) {
    current.ctrl?.stop(false);
    current.group.destroy();
    view.skeleton = null;
  }
  if (!count) return;
  const { width, height } = view.size;
  const group = scene.group({ parent: view.track });
  for (let i = 0; i < count; i += 1)
    scene.node({ parent: group, x: i * (width + gap), w: width, h: height, color: ROW_SKELETON });
  view.skeleton = { count, group, ctrl: null };
  if (!pulse) return;
  view.skeleton.ctrl = group.animate(
    { alpha: 0.6 },
    { duration: 1200, easing: "ease-in-out", loop: true, stopMethod: "reverse" }
  );
  view.skeleton.ctrl.start();
}

export function createLightningHomeRenderer(
  container,
  { geometry, imageQueue, layout = {}, onFailure }
) {
  const sidebar = createHomeSidebar(container, layout);
  container.innerHTML = `
    <div class="tv2-home tv2-home-webgl">
      ${sidebar.markup()}
      <div class="tv2-gl-trailer home-hero-trailer-layer"></div>
      <div class="tv2-gl-host"></div>
      <img class="tv2-gl-gif" alt="" decoding="async" />
      <div class="home-main tv2-gl-proxy"><article class="home-poster-card tv2-card focusable" data-action="openDetail" data-engine="webgl"><div class="tv2-card-title"></div></article></div>
    </div>`;
  const root = container.querySelector(".tv2-home");
  const host = container.querySelector(".tv2-gl-host");
  const proxy = container.querySelector(".tv2-gl-proxy .tv2-card");
  const gifImage = container.querySelector(".tv2-gl-gif");
  const trailerLayer = container.querySelector(".tv2-gl-trailer");
  // On the WebGL hero media rectangle (or the full screen), at the canvas scale innerWidth / 1920.
  const heroRect = heroNodeProps(layout);
  const px = (value) => `${(value * (globalThis.innerWidth || APP_WIDTH)) / APP_WIDTH}px`;
  Object.assign(trailerLayer.style, {
    left: px(heroRect.x),
    top: px(heroRect.y),
    width: px(heroRect.w),
    height: px(heroRect.h)
  });
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
  let rowsVersion = 0;
  let watchedIds = null;
  let watchedVersion = 0;
  // Focused card on screen once the rails stop (app pixels), and the folder focus GIF over it.
  let focusRect = null;
  const gif = { url: "", id: "", key: "", timer: null };
  let stopTrailer = null;
  let trailerShown = false;
  const motion = homeMotion(root);

  function fail(reason) {
    if (failed) return;
    failed = true;
    scene = null;
    markWebglFailed(reason);
    keeper.release(fail);
    keeper.drop();
    if (!closed) onFailure?.(reason);
  }

  function buildScene({ renderer, fonts, variant }) {
    const colors = {
      bg: themeColor(root, "--bg-color", "#0d0d0d"),
      bgClear: themeColor(root, "--bg-color", "#0d0d0d", 0),
      text: themeColor(root, "--text-color", "#ffffff"),
      secondary: themeColor(root, "--text-secondary", "#b3b3b3"),
      tertiary: themeColor(root, "--text-tertiary", "#808080"),
      card: themeColor(root, "--card-bg", "#222222"),
      focus: themeColor(root, "--focus-color", "#ffffff"),
      // Mobile hero meta: dots at alpha 0.7, badge outline at 0.55 (HomeHeroMetaRows.kt).
      dot: themeColor(root, "--text-color", "#ffffff", 0.7),
      badge: themeColor(root, "--focus-color", "#ffffff", 0.55),
      // Continue Watching (mobile): scrim to the background at 0.95, badge at 0.80, accent progress.
      scrim: themeColor(root, "--bg-color", "#0d0d0d", 0.95),
      cwBadge: themeColor(root, "--bg-color", "#0d0d0d", 0.8),
      accent: themeColor(root, "--secondary-color", "#f5f5f5"),
      // Next Up veil (mobile spec): the background at 0.6.
      veil: themeColor(root, "--bg-color", "#0d0d0d", 0.6)
    };
    const css = getComputedStyle(root);
    const html = document.documentElement;
    // Current Home cardDepthEnabled (LayoutPreferences applyCardDepthPresentation), read per mount.
    const depthAlpha = (name, fallback) => {
      const value = parseFloat(getComputedStyle(html).getPropertyValue(name));
      return (0xffffff00 | Math.round((Number.isFinite(value) ? value : fallback) * 255)) >>> 0;
    };
    const depth =
      html.dataset.cardDepth === "true"
        ? {
            posters: html.dataset.cardDepthPosters === "true",
            continue: html.dataset.cardDepthContinueWatching === "true",
            edge: depthAlpha("--card-depth-edge", 0.28),
            sheen: depthAlpha("--card-depth-sheen", 0.1)
          }
        : null;
    const shader = (props) => renderer.createShader("RoundedWithBorder", props);
    const node = (props) => renderer.createNode(props);
    // Lightning paints any sized node white unless its color is 0: containers stay transparent.
    const group = (props) => renderer.createNode({ color: 0, ...props });
    /**
     * Text node in the SDF atlas of `weight` (400 or 600); a text with a character outside the
     * atlases goes to the canvas renderer with the system sans-serif instead of showing "?".
     */
    const text = ({ weight = 400, ...props }) => {
      const { text: value, canvas } = glText(props.text);
      const created = renderer.createTextNode({
        fontFamily: fonts[weight],
        color: colors.text,
        contain: "width",
        maxLines: 1,
        overflowSuffix: "…",
        ...props,
        text: value,
        ...(canvas
          ? { textRendererOverride: "canvas", fontFamily: "sans-serif", fontStyle: String(weight) }
          : {})
      });
      created.glProps = { weight, ...props };
      created.glCanvas = canvas;
      return created;
    };
    /** Sets a text node's text; returns the node to keep (a new one when the renderer changes). */
    const retext = (current, value) => {
      const { text: normalized, canvas } = glText(value);
      if (canvas === current.glCanvas) {
        current.text = normalized;
        return current;
      }
      const { x, y, alpha, parent } = current;
      const next = text({ ...current.glProps, parent, x, y, alpha, text: value });
      current.destroy();
      return next;
    };
    // Transparent (lot W5): the hero trailer plays under the canvas, .tv2-home paints the background.
    const sceneRoot = node({
      parent: renderer.root,
      w: APP_WIDTH,
      h: APP_HEIGHT,
      color: variant === "trailer-above" ? colors.bg : 0
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
    // Over the hero images until the first backdrop is loaded (setHero loading).
    const skeleton = node({ parent: sceneRoot, ...hero, ...SKELETON, alpha: 0 });
    // Left and bottom fades of the hero media: one gradient node per pair of CSS stops.
    const fades = HERO_FADES[layout.modernHeroFullScreenBackdropEnabled ? "fullScreen" : "framed"];
    const bgAt = (alpha) => themeColor(root, "--bg-color", "#0d0d0d", alpha);
    const segments = (stops, place) =>
      stops.slice(1).forEach(([to, alpha], i) => {
        const [from, previous] = stops[i];
        node({ parent: sceneRoot, ...place(from, to, bgAt(previous), bgAt(alpha)) });
      });
    const leftW = hero.w * fades.width;
    segments(fades.left, (from, to, colorLeft, colorRight) => ({
      x: hero.x + from * leftW,
      y: hero.y,
      w: (to - from) * leftW,
      h: hero.h,
      colorLeft,
      colorRight
    }));
    segments(fades.bottom, (from, to, colorTop, colorBottom) => ({
      x: hero.x,
      y: hero.y + from * hero.h,
      w: hero.w,
      h: (to - from) * hero.h,
      colorTop,
      colorBottom
    }));
    const rowsClip = group({
      parent: sceneRoot,
      y: MAIN_TOP,
      w: APP_WIDTH,
      h: APP_HEIGHT - MAIN_TOP,
      clipping: true
    });
    const heroCopy = createHeroCopy({
      parent: sceneRoot,
      node,
      text,
      shader,
      slot: imageSlot,
      tween,
      settle,
      colors,
      fade: motion.copy,
      // With the rails: after the legacy rail (220) or at the pill's inset (104).
      x: geometry.contentStart
    });
    return {
      renderer,
      colors,
      depth,
      // shortcut: the accent is solid, not the DOM's --player-accent-gradient; a gradient needs a canvas gradient.
      watchedTexture: watchedBadgeTexture(
        renderer,
        css.getPropertyValue("--secondary-color").trim() || "#f5f5f5",
        css.getPropertyValue("--on-secondary").trim() || "#000000"
      ),
      node,
      group,
      text,
      retext,
      shader,
      root: sceneRoot,
      heroLayer,
      rowsClip,
      hero: { front: heroSlots[0], back: heroSlots[1], shown: "", wanted: "" },
      skeleton: { node: skeleton, on: false, ctrl: null },
      heroCopy,
      rowsLayer: group({ parent: rowsClip }),
      // Child of the focused card, so it follows its slide and scale; transparent inside.
      ring: node({
        parent: sceneRoot,
        x: -FOCUS_RING,
        y: -FOCUS_RING,
        color: 0,
        alpha: 0,
        shader: shader({
          radius: (geometry.radius ?? 24) + FOCUS_RING,
          "border-w": FOCUS_RING,
          "border-color": colors.focus
        })
      })
    };
  }

  function setRows(rows) {
    last.rows = rows;
    // Bumped by every row emit: continue cards refill then, their release labels depend on time.
    rowsVersion += 1;
    if (!scene) return;
    const kept = new Map(
      rows.map((row) => [row.key, { ...rowCardSize(row, geometry), kind: row.kind }])
    );
    for (const [key, view] of views) {
      const size = kept.get(key);
      // A row whose card shape changed (kind, tile shape) gets new pooled cards.
      if (
        !size ||
        size.kind !== view.kind ||
        size.width !== view.size.width ||
        size.height !== view.size.height
      ) {
        // The ring may sit on one of its cards; the next update puts it back on the focus.
        scene.ring.parent = scene.root;
        scene.ring.alpha = 0;
        setRowSkeletons(scene, view, 0);
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
            x: geometry.contentStart,
            y: 10,
            fontSize: 32,
            maxWidth: geometry.viewport
          }),
          status: scene.text({
            parent: rowNode,
            x: geometry.contentStart,
            y: 70,
            fontSize: 24,
            maxWidth: geometry.viewport,
            color: scene.colors.tertiary
          }),
          track: scene.group({ parent: rowNode }),
          slots: [],
          kind: row.kind,
          size: kept.get(row.key),
          skeleton: null,
          placed: false
        };
        views.set(row.key, view);
      }
      view.title = scene.retext(view.title, row.title || "");
      // A loading row shows its skeleton cards, or the loading text without a count (D1: no error text).
      const skeletons = row.items.length || row.status !== "loading" ? 0 : row.loadingCount || 0;
      setRowSkeletons(scene, view, skeletons, geometry.gap, shimmers(motion));
      view.status.text =
        row.items.length || skeletons || row.status !== "loading"
          ? ""
          : t("common.loading", {}, "Loading");
    });
  }

  function slotCard(view, slot) {
    view.slots[slot] ||= createGlCard(scene, view.track, view.kind, view.size);
    return view.slots[slot];
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
    sidebarFocused = sidebarIndex >= 0 && !hideFocus ? sidebar.items()[sidebarIndex] || null : null;
    sidebarFocused?.classList.add("focused");
    sidebar.setOpen(sidebarIndex >= 0);
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
    const placed = homeLayout(rows, focus, geometry);
    const focusIndex = focusedIndex(focus, rows);
    const focusShown = sidebarIndex < 0 && !hideFocus;
    const viewHeight = APP_HEIGHT - MAIN_TOP;
    const visible = placed.rows.map(
      ({ top, height }) => top + placed.offsetY < viewHeight && top + height + placed.offsetY > 0
    );
    const firstRow = visible.indexOf(true) - 1;
    const lastRow = visible.lastIndexOf(true) + 1;
    let ringCard = null;
    focusRect = null;
    const logos = [];
    placed.rows.forEach(({ row, size, pitch, win, top, height }, rowIndex) => {
      const view = views.get(row.key);
      if (!view) return;
      view.node.y = top;
      const warm =
        rowIndex >= focus.row - WARM_ROWS.before && rowIndex <= focus.row + WARM_ROWS.after;
      if (rowIndex < firstRow || rowIndex > lastRow) {
        // Off screen: outside the warm ring its artwork goes once, as outside the DOM renderer's
        // loading window; inside it, the textures stay for a move back.
        if (warm) return;
        view.slots.forEach((card) => {
          if (card.landscape) imageQueue.request(card.landscape.logo, "");
          if (!card.wanted) return;
          card.wanted = "";
          imageQueue.request(card.image, "");
        });
        return;
      }
      view.track.y = height - size.height - rowLabelHeight(row, geometry) - geometry.rowGap;
      const loadImages = rowIndex >= focus.row - 1 && rowIndex <= focus.row + 2;
      view.slots.forEach((card) => (card.node.alpha = 0));
      for (let i = win.start; i < win.end; i += 1) {
        const item = row.items[i];
        const card = slotCard(view, slotFor(i, win.poolSize));
        // As the DOM: watched changes refill every card, row emits the continue ones.
        const version =
          row.kind === "continue" ? `${watchedVersion}:${rowsVersion}` : String(watchedVersion);
        const changed =
          card.index !== i ||
          card.rowKey !== row.key ||
          card.item !== item ||
          card.version !== version;
        if (changed) {
          card.item = item;
          card.index = i;
          card.rowKey = row.key;
          card.version = version;
          card.source = cardImage(row, item, size, layout, glImageUrl);
          if (card.source.cw?.blur) card.source = blurredSource(card.source);
          fillGlCard(scene, card, item, card.source, watchedIds);
          // A recycled card never shows the previous title's logo while its own one waits.
          const logo = card.landscape;
          if (logo && logo.logo.url !== logo.url) imageQueue.request(logo.logo, "");
        }
        card.node.alpha = 1;
        const focused = rowIndex === focus.row && i === focusIndex;
        // Outside the loading window, a warm row keeps what it has but loads nothing new.
        const url = loadImages ? card.source.url : warm && !changed ? card.wanted : "";
        if (card.wanted !== url || focused) {
          card.wanted = url;
          imageQueue.request(card.image, url, {
            fallbacks: card.source.fallbacks,
            priority: focused
          });
        }
        // No artwork at all: the mobile shows the same text tile (ShelfComponents.kt, imageUrl null).
        if (!card.source.url) card.showTile(true);
        // A refill keeping a failed image's URL keeps its tile; a new request reports its own state.
        else if (changed && card.wanted !== card.source.url) card.showTile(false);
        if (card.landscape && (loadImages || !warm))
          logos.push([card.landscape, loadImages ? card.landscape.url : ""]);
        const scaled = Boolean(motion.scale) && focusShown && focused;
        placeCard(card, i * pitch, scaled);
        if (focused) ringCard = card;
        if (focused && focusShown) {
          const grow = scaled ? (FOCUS_SCALE - 1) / 2 : 0;
          focusRect = {
            id: `${row.key}:${i}`,
            collection: row.kind === "collection",
            x: geometry.contentStart + win.offset + i * pitch - size.width * grow,
            y: MAIN_TOP + placed.offsetY + top + view.track.y - size.height * grow,
            w: size.width * (1 + 2 * grow),
            h: size.height * (1 + 2 * grow)
          };
        }
      }
      // A new row is placed where it belongs, never slid in from the left edge.
      tween(view.track, "x", geometry.contentStart + win.offset, view.placed ? motion.rail : null);
      view.placed = true;
    });
    tween(scene.rowsLayer, "y", placed.offsetY, scene.placed ? motion.rail : null);
    scene.placed = true;
    // Landscape logos after every artwork: the lowest priority in the same bounded queue.
    logos.forEach(([parts, url]) => imageQueue.request(parts.logo, url));
    placeGif();

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
    // A cleared slot ("empty") is not an end of loading: setHero(null, { loading }) clears it.
    if (state === "loaded" || state === "failed") setSkeleton(false);
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

  /** DOM home-modern-hero-media-loading: the gradient shimmers (static when constrained). */
  function setSkeleton(on) {
    const skeleton = scene?.skeleton;
    if (!skeleton || skeleton.on === on) return;
    skeleton.on = on;
    skeleton.ctrl?.stop(false);
    skeleton.ctrl = null;
    skeleton.node.alpha = on ? 1 : 0;
    if (!on || !shimmers(motion)) return;
    skeleton.ctrl = skeleton.node.animate(
      { alpha: 0.55 },
      { duration: 1100, easing: "ease-in-out", loop: true, stopMethod: "reverse" }
    );
    skeleton.ctrl.start();
  }

  function setHero(item, { loading = false } = {}) {
    last.hero = item;
    last.heroLoading = loading;
    if (!scene) return;
    const display = item ? buildModernHeroPresentation(item) : null;
    if (!item) setSkeleton(loading);
    scene.heroCopy.set(display);
    // DOM backdrop order (buildHeroBackdropSources), without the poster: cover would crop it to a strip.
    const width = engine.variant === "hero-780" ? 780 : 1280;
    const [url = "", ...fallbacks] = [
      ...new Set(
        [display?.backdrop, ...(display?.backdropFallbacks || [])]
          .filter((source) => source && source !== item.poster)
          .map((source) => glImageUrl(source, width))
      )
    ];
    // No backdrop at all for this title: nothing will end the skeleton.
    if (item && !url) setSkeleton(false);
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

  /** Watched title ids (homeModel onWatched): visible cards refill at the next update. */
  function setWatched(ids) {
    // The same set again (route return, refresh): visible cards keep their fill.
    if (
      ids &&
      watchedIds &&
      ids.size === watchedIds.size &&
      [...ids].every((id) => watchedIds.has(id))
    )
      return;
    watchedIds = ids;
    watchedVersion += 1;
  }

  /**
   * Folder focus GIF (decision 3): one DOM <img> over the focused folder card, since WebGL only
   * decodes a GIF's first frame. Through the card queue as the DOM; "" clears it.
   */
  function setFocusGif(url = "") {
    const rect = url && focusRect?.collection ? focusRect : null;
    gif.url = rect ? url : "";
    gif.id = rect?.id || "";
    gif.key = "";
    imageQueue.request(gifImage, gif.url, { priority: true });
    placeGif();
  }

  /**
   * Keeps the GIF on its card's final rectangle, hidden while the rails slide there; the focus
   * leaving that card (or the sidebar, a hold menu) clears it.
   */
  function placeGif() {
    if (gif.url && focusRect?.id !== gif.id) {
      gif.url = "";
      imageQueue.request(gifImage, "");
    }
    const rect = gif.url ? focusRect : null;
    const key = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : "";
    if (key === gif.key) return;
    gif.key = key;
    clearTimeout(gif.timer);
    gifImage.classList.remove("is-active");
    if (!rect) return;
    // The canvas is drawn at innerWidth / 1920 (deviceLogicalPixelRatio).
    const ratio = (globalThis.innerWidth || APP_WIDTH) / APP_WIDTH;
    Object.assign(gifImage.style, {
      left: `${rect.x * ratio}px`,
      top: `${rect.y * ratio}px`,
      width: `${rect.w * ratio}px`,
      height: `${rect.h * ratio}px`
    });
    gif.timer = setTimeout(() => gifImage.classList.add("is-active"), motion.rail?.duration || 0);
  }

  /**
   * Trailer shown (lot W5): the hero images fade out over the DOM video under the canvas, the
   * WebGL fades stay over it; full screen also fades the rails and the hero meta, as the DOM.
   */
  function revealTrailer(on) {
    trailerShown = on;
    // Destroyed: the scene goes with its nodes, nothing to fade back.
    if (!scene || closed) return;
    tween(scene.heroLayer, "alpha", on ? 0 : 1, TRAILER_FADE);
    if (!layout.modernHeroFullScreenBackdropEnabled) return;
    tween(scene.rowsClip, "alpha", on ? 0 : 1, TRAILER_FADE);
    scene.heroCopy.hideMeta(on, TRAILER_FADE);
  }

  /** Current Home hero_media trailer (or folder hero video) in the DOM layer, as the DOM renderer. */
  function playHeroTrailer(source) {
    stopHeroTrailer();
    // A deferred stop's paused media leaves at once, as the current Home's mount does.
    releaseTrailerMedia(trailerLayer);
    stopTrailer = mountTrailerMedia(
      trailerLayer,
      source,
      () => revealTrailer(true),
      () => stopHeroTrailer()
    );
  }

  /** `deferred`: paused now, unloaded once idle (constrained TVs, as the current Home). */
  function stopHeroTrailer({ deferred = false } = {}) {
    if (trailerShown) revealTrailer(false);
    stopTrailer?.({ deferred });
    stopTrailer = null;
  }

  /** Home hidden or destroyed: trailer media unloaded now (no audio), focus GIF cleared. */
  function suspend() {
    stopHeroTrailer();
    pauseTrailerMedia(trailerLayer);
    releaseTrailerMedia(trailerLayer);
    setFocusGif("");
  }

  function setProfile(profile) {
    sidebar.setProfile(profile);
    // The sidebar nodes were replaced: focus the new one.
    sidebarFocused = null;
    if (last.focus)
      updateProxy(last.rows, last.focus, last.options.sidebarIndex ?? -1, last.options.hideFocus);
  }

  keeper
    .acquire(fail)
    .then((ready) => {
      if (closed || failed) return keeper.release(fail);
      engine = ready;
      engine.renderer.targetFPS = 0;
      host.appendChild(engine.canvas);
      root.classList.toggle("tv2-gl-trailer-above", engine.variant === "trailer-above");
      scene = buildScene(engine);
      setRows(last.rows);
      if (last.focus) update(last.rows, last.focus, last.options);
      setHero(last.hero, { loading: last.heroLoading });
      if (trailerShown) revealTrailer(true);
    })
    .catch((error) => fail(error?.message || "init"));

  return {
    engine: "webgl",
    setRows,
    update,
    setWatched,
    setHero,
    playHeroTrailer,
    stopHeroTrailer,
    setFocusGif,
    setProfile,
    setSidebarPill: sidebar.setPill,
    sidebarItems: sidebar.items,
    focusedNode: () => sidebarFocused || (proxyFocused ? proxy : null),
    suspend,
    destroy() {
      closed = true;
      // Leaving Home (newHomeScreen cleanup destroys a WebGL view): the trailer's audio stops here.
      suspend();
      heroQueue.clear();
      if (scene) {
        views.forEach((view) => setRowSkeletons(scene, view, 0));
        // Leaving Home (often for the player). No full cleanup (lot W6): the released textures
        // stay cached until Lightning's own threshold cleanup (oldest first), so a return from
        // the player finds the focused row's artwork without reloading it.
        scene.root.destroy();
        // maxRetryCount 0: a failed texture stays cached as failed for the kept engine's life.
        // Forget failures on leaving Home, so a network blip is retried on the next visit.
        const { txManager } = engine.renderer.stage;
        for (const texture of [...txManager.keyCache.values()])
          if (texture.state === "failed") txManager.removeTextureFromCache(texture);
      }
      scene = null;
      // The kept engine's idle loop would wake 60 times a second while away (e.g. in the player).
      // stopLoop() cannot be undone safely.
      if (engine) engine.renderer.targetFPS = AWAY_FPS;
      engine?.canvas.remove();
      keeper.release(fail);
      views.clear();
      sidebarFocused = null;
    }
  };
}
