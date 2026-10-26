import { renderLegacySidebar } from "../../../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { loadScript } from "../../../../runtime/loadStreamingLibs.js";
import {
  railWindow,
  slotFor,
  rowsOffset,
  ROW_TITLE_HEIGHT,
  RAIL_VIEWPORT
} from "../../railEngine.js";
import { focusedIndex } from "../../focusModel.js";
import { sizedImageUrl } from "../../imagePipeline.js";
import { cardImageUrl, fillCard, navRowOf, setNavPosition } from "../../renderer.js";
import { markWebglFailed } from "../../newHomeSetting.js";
import { buildSdfAtlas } from "./sdfAtlas.js";

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
const HERO_HEIGHT = 620;
const MAIN_TOP = 560;
const FOCUS_RING = 4;
// Fixed GPU budget: the image windows of renderer.js need about 45 MB (poster ~0.7 MB, hero
// 3.7 MB). Still above it after Lightning's own cleanup means the TV cannot hold the scene.
export const TEXTURE_BUDGET_BYTES = 64 * 1024 * 1024;

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
        platform: L.WebPlatform,
        numImageWorkers: 0,
        clearColor: 0x00000000,
        // Preload about one card or row beyond the clip, like the DOM renderer's margins.
        boundsMargin: 480,
        textureMemory: { criticalThreshold: TEXTURE_BUDGET_BYTES, targetThresholdLevel: 0.5 },
        enableContextSpy: false
      },
      document.createElement("div")
    );
  } catch (_) {
    throw new Error("no-webgl");
  }
  const canvas = renderer.canvas;
  canvas.className = "tv2-gl-canvas";
  canvas.addEventListener("webglcontextlost", () => report("context-lost"));
  renderer.on("criticalCleanupFailed", () => report("texture-budget"));
  const dispose = () => {
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
  return { renderer, canvas, dispose, font };
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
 * Lightning image node behind the element-like surface imagePipeline's queue drives. Lightning
 * paints a node without texture as a white rectangle, so it stays transparent without a URL.
 * The queue slot is released at once: Lightning only loads nodes inside the preload bounds and
 * paces uploads itself, so a node scrolled away would otherwise hold its slot forever. The
 * queue keeps its navigation-busy gate and its latest-URL-per-card rule.
 */
function imageSlot(node, alpha = 1) {
  node.alpha = 0;
  const slot = {
    url: "",
    onload: null,
    onerror: null,
    getAttribute: (name) => (name === "src" && slot.url) || null,
    removeAttribute() {
      slot.url = "";
      node.src = null;
      node.alpha = 0;
    },
    set src(url) {
      slot.url = url;
      node.src = url;
      node.alpha = alpha;
      Promise.resolve().then(() => slot.onload?.());
    }
  };
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
  let engine = null;
  let scene = null;
  let closed = false;
  let failed = false;
  let proxyFocused = false;
  let sidebarFocused = null;

  const sizeFor = (kind) => (kind === "continue" ? geometry.landscape : geometry.poster);

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
      bgSide: themeColor(root, "--bg-color", "#0d0d0d", 0.9),
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
    const heroImage = node({ parent: sceneRoot, w: APP_WIDTH, h: HERO_HEIGHT });
    node({
      parent: sceneRoot,
      w: APP_WIDTH * 0.6,
      h: HERO_HEIGHT,
      colorLeft: colors.bgSide,
      colorRight: colors.bgClear
    });
    node({
      parent: sceneRoot,
      y: HERO_HEIGHT * 0.4,
      w: APP_WIDTH,
      h: HERO_HEIGHT * 0.6,
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
      heroSlot: imageSlot(heroImage, 0.55),
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
      ring: node({ parent: sceneRoot, color: colors.focus, alpha: 0 })
    };
  }

  function setRows(rows) {
    last.rows = rows;
    if (!scene) return;
    const keys = new Set(rows.map((row) => row.key));
    for (const [key, view] of views) {
      if (!keys.has(key)) {
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
            x: RAIL_LEFT,
            y: 10,
            fontSize: 32,
            maxWidth: RAIL_VIEWPORT
          }),
          status: scene.text({
            parent: rowNode,
            x: RAIL_LEFT,
            y: 70,
            fontSize: 24,
            maxWidth: RAIL_VIEWPORT,
            color: scene.colors.tertiary
          }),
          track: scene.group({ parent: rowNode, y: ROW_TITLE_HEIGHT }),
          slots: [],
          kind: row.kind
        };
        views.set(row.key, view);
      }
      view.title.text = row.title || "";
      view.status.text = row.items.length
        ? ""
        : row.status === "loading"
          ? "Chargement…"
          : "Indisponible pour le moment";
    });
  }

  function slotCard(view, slot) {
    let card = view.slots[slot];
    if (!card) {
      const { width, height } = sizeFor(view.kind);
      const cardNode = scene.node({
        parent: view.track,
        w: width,
        h: height,
        color: scene.colors.card,
        zIndex: 1
      });
      card = {
        node: cardNode,
        image: imageSlot(scene.node({ parent: cardNode, w: width, h: height })),
        title: null,
        index: -1,
        rowKey: ""
      };
      scene.node({
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
      view.slots[slot] = card;
    }
    return card;
  }

  function updateProxy(rows, focus, sidebarIndex) {
    const row = rows[focus.row];
    const index = focusedIndex(focus, rows);
    const item = sidebarIndex < 0 ? row?.items[index] : null;
    proxyFocused = Boolean(item);
    if (item) {
      fillCard(proxy, item, index, row);
      setNavPosition(proxy, navRowOf(rows, focus.row), index);
    }
    proxy.className = `${row?.kind === "continue" ? "home-continue-card" : "home-poster-card"} tv2-card focusable${proxyFocused ? " focused" : ""}`;
    sidebarFocused?.classList.remove("focused");
    sidebarFocused = sidebarIndex >= 0 ? sidebarItems()[sidebarIndex] || null : null;
    sidebarFocused?.classList.add("focused");
    root.classList.toggle("tv2-sidebar-open", sidebarIndex >= 0);
    container.querySelector(".home-sidebar")?.classList.toggle("expanded", sidebarIndex >= 0);
  }

  function update(rows, focus, options = {}) {
    const sidebarIndex = options.sidebarIndex ?? -1;
    Object.assign(last, { rows, focus, options });
    updateProxy(rows, focus, sidebarIndex);
    if (!scene) return;
    const heights = [];
    let top = 0;
    let ringCard = null;
    rows.forEach((row, rowIndex) => {
      const size = sizeFor(row.kind);
      const height = size.height + ROW_TITLE_HEIGHT + geometry.gap;
      heights.push(height);
      const view = views.get(row.key);
      if (!view) return;
      view.node.y = top;
      top += height;
      const pitch = size.width + geometry.gap;
      const column = Number(focus.columns[row.key] || 0);
      const win = railWindow({
        count: row.items.length,
        focusIndex: column,
        pitch,
        viewport: RAIL_VIEWPORT
      });
      const loadImages = rowIndex >= focus.row - 1 && rowIndex <= focus.row + 2;
      view.slots.forEach((card) => (card.node.alpha = 0));
      for (let i = win.start; i < win.end; i += 1) {
        const item = row.items[i];
        const card = slotCard(view, slotFor(i, win.poolSize));
        if (card.index !== i || card.rowKey !== row.key || card.item !== item) {
          card.item = item;
          card.index = i;
          card.rowKey = row.key;
          card.title.text = String(item.name || item.title || "");
          card.url = cardImageUrl(row, item, size, layout);
        }
        card.node.alpha = 1;
        card.node.x = i * pitch;
        imageQueue.request(card.image, loadImages ? card.url : "");
        if (rowIndex === focus.row && i === focusedIndex(focus, rows)) ringCard = card;
      }
      view.track.x = RAIL_LEFT + win.offset;
    });
    scene.rowsLayer.y = rowsOffset(heights, focus.row);

    const { ring } = scene;
    if (ringCard && sidebarIndex < 0) {
      ring.parent = ringCard.node.parent;
      ring.x = ringCard.node.x - FOCUS_RING;
      ring.y = -FOCUS_RING;
      ring.w = ringCard.node.w + 2 * FOCUS_RING;
      ring.h = ringCard.node.h + 2 * FOCUS_RING;
      ring.alpha = 1;
    } else {
      ring.alpha = 0;
    }
  }

  function setHero(item) {
    last.hero = item;
    if (!scene) return;
    scene.heroTitle.text = item?.name || item?.title || "";
    scene.heroDescription.text = item?.description || "";
    imageQueue.request(
      scene.heroSlot,
      sizedImageUrl(item?.background || item?.backdrop || item?.poster, 1280)
    );
  }

  function setProfile(profile) {
    const sidebar = container.querySelector(".home-sidebar");
    if (!sidebar) return;
    sidebar.outerHTML = renderLegacySidebar({ selectedRoute: "home", layout, profile });
    sidebarFocused = null;
    if (last.focus) updateProxy(last.rows, last.focus, last.options.sidebarIndex ?? -1);
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
      if (scene) {
        scene.root.destroy();
        // Leaving Home (often for the player): free every texture the scene held.
        engine.renderer.stage.cleanup(true);
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
