import { createDomHomeRenderer, cardImageUrl, heroImageUrl } from "../../renderer.js";
import { homeLayout, ROW_TITLE_HEIGHT } from "../../railEngine.js";

// Hybrid TV Home renderer (nuv-091, lot B2): a WebGL canvas under the DOM renderer draws the
// posters and the hero backdrop; the DOM layer keeps text, focus, badges and the sidebar, with its
// images switched off. Same interface as the DOM renderer.

// Same boxes as css/tv2-home.css: .tv2-main top and left padding, .tv2-hero, .tv2-card radius.
const MAIN_TOP = 560;
const MAIN_LEFT = 220;
const HERO_HEIGHT = 620;
const HERO_ALPHA = 0.55;
const CARD_RADIUS = 16;

/** Quads of the on-screen cards, at the very positions the DOM layer gives the same cards. */
export function cardQuads(rows, focus, geometry, { width = 1920, height = 1080, color } = {}) {
  const layout = homeLayout(rows, focus, geometry);
  const quads = [];
  for (const { row, size, pitch, win, top } of layout.rows) {
    const y = MAIN_TOP + layout.offsetY + top + ROW_TITLE_HEIGHT;
    if (y >= height || y + size.height <= MAIN_TOP) continue;
    for (let i = win.start; i < win.end; i += 1) {
      const x = MAIN_LEFT + win.offset + i * pitch;
      if (x >= width || x + size.width <= 0) continue;
      quads.push({
        x,
        y,
        w: size.width,
        h: size.height,
        url: cardImageUrl(row, row.items[i], size),
        color,
        radius: CARD_RADIUS,
        clipTop: MAIN_TOP
      });
    }
  }
  return quads;
}

/** Premultiplied RGBA of a CSS color variable, for the cards still waiting for their texture. */
function cssColor(root, variable) {
  const probe = document.createElement("i");
  probe.style.color = `var(${variable})`;
  root.appendChild(probe);
  const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number);
  probe.remove();
  if (parts.length < 3) return [0.1, 0.1, 0.1, 1];
  const alpha = parts[3] ?? 1;
  return [(parts[0] / 255) * alpha, (parts[1] / 255) * alpha, (parts[2] / 255) * alpha, alpha];
}

/** `onFallback(reason)` asks the screen to switch to the DOM renderer: "lost" or "budget". */
export function createHybridHomeRenderer(
  container,
  { geometry, imageQueue, layout, glLayer, onFallback }
) {
  // The DOM <img> only shows what WebGL could not read (cross-origin without CORS).
  const domQueue = {
    request: (node, url) => imageQueue.request(node, glLayer.state(url) === "failed" ? url : ""),
    clear: () => imageQueue.clear()
  };
  const dom = createDomHomeRenderer(container, { geometry, imageQueue: domQueue, layout });
  const root = container.querySelector(".tv2-home");
  root.classList.add("tv2-hybrid");
  glLayer.canvas.className = "tv2-gl";
  root.insertBefore(glLayer.canvas, root.firstChild);
  const color = cssColor(root, "--card-bg");
  const load = (image, url) => imageQueue.request(image, url);
  let last = null;
  let hero = null;
  let frameRequest = 0;

  function draw() {
    frameRequest = 0;
    const width = glLayer.canvas.clientWidth || 1920;
    const height = glLayer.canvas.clientHeight || 1080;
    const quads = last ? cardQuads(last.rows, last.focus, geometry, { width, height, color }) : [];
    const heroUrl = heroImageUrl(hero);
    if (heroUrl)
      quads.unshift({ x: 0, y: 0, w: width, h: HERO_HEIGHT, url: heroUrl, alpha: HERO_ALPHA });
    glLayer.draw(quads, load);
  }

  const schedule = () => {
    if (!frameRequest) frameRequest = requestAnimationFrame(draw);
  };

  glLayer.onEvent = (type) => {
    if (type === "ready") return schedule();
    if (type === "failed") {
      // Hand the image to the DOM layer.
      if (last) dom.update(last.rows, last.focus, last.options);
      dom.setHero(hero);
      return schedule();
    }
    if (type === "budget") glLayer.clear();
    onFallback(type);
  };

  return {
    ...dom,
    update(rows, focus, options) {
      dom.update(rows, focus, options);
      last = { rows, focus, options };
      schedule();
    },
    setHero(item) {
      dom.setHero(item);
      hero = item;
      schedule();
    },
    destroy() {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      glLayer.onEvent = null;
      glLayer.canvas.remove();
      dom.destroy();
    }
  };
}
