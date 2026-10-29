import { getVidaaArtworkUrl } from "../screens/home/vidaaArtworkOptimization.js";

// Images of the new TV Home (nuv-091): requested at the displayed size, decoded a few at a time.

// TMDB widths matching the current Home's card caps (w342 portrait, w500 landscape) and hero.
const TMDB_SIZES = [342, 500, 780, 1280];
// TMDB logo widths (its logo_sizes) for the card logos, ~200 px wide.
export const TMDB_LOGO_SIZES = [300, 500];
// Decoded card artwork, logos and folder GIFs of the Home (natural pixels; the hero is outside
// the queue): ~8 Mpx at card sizes for the loaded rows; oversized sources are capped, far first.
export const HOME_IMAGE_BUDGET_PX = 10e6;
// Anchored like tmdbImageUrl.js: a TMDB URL embedded in a proxy or a look-alike host is left as is.
const TMDB_SIZE = /^((?:https?:)?\/\/image\.tmdb\.org\/t\/p\/)(original|w(\d+))\//i;

// Cinemeta artwork (images.metahub.space): widths of its size slots, measured on 2026-10-29
// (poster small 300x450 WebP, medium 500x750, large 780x1170; background small 480x270, medium
// and large 1920x1080). A card asking a 1920 px background decoded 2 Mpx for ~0.1 Mpx shown.
const METAHUB_SIZE =
  /^(https:\/\/images\.metahub\.space\/(poster|background)\/)(small|medium|large)\//i;
const METAHUB_SLOTS = {
  poster: [
    ["small", 300],
    ["medium", 500],
    ["large", 780]
  ],
  background: [
    ["small", 480],
    ["medium", 1920],
    ["large", 1920]
  ]
};

/**
 * URL for a display width: TMDB or Cinemeta size slot (never upsized), nuvio-art through the
 * Vercel optimizer, others as is.
 */
export function sizedImageUrl(url, width, sizes = TMDB_SIZES) {
  const value = String(url || "");
  if (!value) return "";
  const match = value.match(TMDB_SIZE);
  if (match) {
    const size = sizes.find((candidate) => candidate >= width) || sizes[sizes.length - 1];
    return match[3] && Number(match[3]) <= size ? value : value.replace(TMDB_SIZE, `$1w${size}/`);
  }
  const metahub = value.match(METAHUB_SIZE);
  if (metahub) {
    const slots = METAHUB_SLOTS[metahub[2].toLowerCase()];
    const current = slots.find(([name]) => name === metahub[3].toLowerCase());
    const [name, slotWidth] =
      slots.find(([, candidate]) => candidate >= width) || slots[slots.length - 1];
    return slotWidth < current[1] ? value.replace(METAHUB_SIZE, `$1${name}/`) : value;
  }
  return getVidaaArtworkUrl(value, width <= 640 ? 640 : 1280);
}

/**
 * At most `concurrency` images load at once; a node asking again replaces its pending request,
 * so a recycled card never shows an image it no longer represents. A failed image tries its
 * `fallbacks` in turn in the same slot. Requests load by `rank` (lower first; a `priority`
 * request, the focused card, before all). Decoded pixels (natural size) stay under `budgetPx`:
 * over it, a request evicts the loaded images of a worse rank, or waits if its rank is above 0.
 */
export function createImageQueue({
  concurrency = 3,
  isBusy = () => false,
  retryMs = 120,
  budgetPx = Infinity
} = {}) {
  const pending = new Map();
  // Loaded nodes: natural pixels and the rank of their latest request.
  const decoded = new Map();
  const ranks = new WeakMap();
  let decodedPx = 0;
  // Nodes holding a slot. Changing or removing src mid-load cancels it without load/error events.
  const loading = new Set();
  // Last URL each node was given, so a node showing one of its fallbacks is not reloaded.
  const requested = new WeakMap();
  let timer = null;

  function release(node) {
    node.onload = node.onerror = null;
    loading.delete(node);
  }

  function forget(node) {
    decodedPx -= decoded.get(node) || 0;
    decoded.delete(node);
  }

  // Over budget: drop loaded images ranked after `rank`, worst first. True once under budget.
  function makeRoom(rank) {
    if (decodedPx < budgetPx) return true;
    const victims = [...decoded.keys()]
      .filter((node) => ranks.get(node) > rank)
      .sort((a, b) => ranks.get(b) - ranks.get(a));
    for (const node of victims) {
      forget(node);
      requested.delete(node);
      node.removeAttribute?.("src");
      if (decodedPx < budgetPx) return true;
    }
    return false;
  }

  function pump() {
    timer = null;
    if (isBusy()) {
      timer = setTimeout(pump, retryMs);
      return;
    }
    const order = [...pending].sort((a, b) => a[1].rank - b[1].rank);
    for (const [node, entry] of order) {
      // A node already loading reuses its own slot.
      if (!loading.has(node) && loading.size >= concurrency) continue;
      // Rank 0 or better (the focused card, unranked callers such as the WebGL renderer) never waits.
      if (!makeRoom(entry.rank) && entry.rank > 0) continue;
      pending.delete(node);
      loading.add(node);
      requested.set(node, entry.url);
      forget(node);
      load(node, entry.url, entry.fallbacks);
    }
  }

  // A failed image keeps its slot and tries the next fallback.
  function load(node, url, fallbacks) {
    node.onload = () => {
      release(node);
      const pixels = (node.naturalWidth || 0) * (node.naturalHeight || 0);
      decoded.set(node, pixels);
      decodedPx += pixels;
      pump();
    };
    node.onerror = () => {
      if (fallbacks.length) return load(node, fallbacks[0], fallbacks.slice(1));
      release(node);
      pump();
    };
    node.src = url;
  }

  return {
    request(node, url, { fallbacks = [], priority = false, rank = 0 } = {}) {
      if (!node) return;
      const order = priority ? -1 : rank;
      ranks.set(node, order);
      if (!url) {
        pending.delete(node);
        requested.delete(node);
        forget(node);
        if (node.getAttribute?.("src")) node.removeAttribute("src");
        if (loading.has(node)) {
          release(node);
          if (!timer) pump();
        }
        return;
      }
      pending.delete(node);
      if (node.getAttribute?.("src") && requested.get(node) === url) return;
      pending.set(node, { url, fallbacks, rank: order });
      if (!timer) pump();
    },
    clear() {
      pending.clear();
      // In-flight loads are cancelled (a hidden kept view loads nothing); its next request
      // reloads them with their fallbacks.
      loading.forEach((node) => {
        requested.delete(node);
        release(node);
        node.removeAttribute?.("src");
      });
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get pendingCount() {
      return pending.size;
    },
    /** Natural pixels of the loaded images (the Diagnostic's decoded-image measure). */
    get decodedPx() {
      return decodedPx;
    }
  };
}
