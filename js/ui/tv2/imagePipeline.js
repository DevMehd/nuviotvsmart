import { getVidaaArtworkUrl } from "../screens/home/vidaaArtworkOptimization.js";

// Images of the new TV Home (nuv-091): requested at the displayed size, decoded a few at a time.

// TMDB widths matching the current Home's card caps (w342 portrait, w500 landscape) and hero.
const TMDB_SIZES = [342, 500, 780, 1280];
// Anchored like tmdbImageUrl.js: a TMDB URL embedded in a proxy or a look-alike host is left as is.
const TMDB_SIZE = /^((?:https?:)?\/\/image\.tmdb\.org\/t\/p\/)(original|w(\d+))\//i;

/** URL for a display width: TMDB size bucket (never upsized), nuvio-art through the Vercel optimizer, others as is. */
export function sizedImageUrl(url, width) {
  const value = String(url || "");
  if (!value) return "";
  const match = value.match(TMDB_SIZE);
  if (match) {
    const size =
      TMDB_SIZES.find((candidate) => candidate >= width) || TMDB_SIZES[TMDB_SIZES.length - 1];
    return match[3] && Number(match[3]) <= size ? value : value.replace(TMDB_SIZE, `$1w${size}/`);
  }
  return getVidaaArtworkUrl(value, width <= 640 ? 640 : 1280);
}

/**
 * At most `concurrency` images load at once; a node asking again replaces its pending request,
 * so a recycled card never shows an image it no longer represents. A failed image tries its
 * `fallbacks` in turn in the same slot; a `priority` request (the focused card) goes first.
 */
export function createImageQueue({ concurrency = 3, isBusy = () => false, retryMs = 120 } = {}) {
  const pending = new Map();
  // Nodes holding a slot. Changing or removing src mid-load cancels it without load/error events.
  const loading = new Set();
  // Last URL each node was given, so a node showing one of its fallbacks is not reloaded.
  const requested = new WeakMap();
  let timer = null;

  function release(node) {
    node.onload = node.onerror = null;
    loading.delete(node);
  }

  function pump() {
    timer = null;
    if (isBusy()) {
      timer = setTimeout(pump, retryMs);
      return;
    }
    for (const [node, entry] of pending) {
      if (!loading.has(node) && loading.size >= concurrency) return;
      pending.delete(node);
      loading.add(node);
      requested.set(node, entry.url);
      load(node, entry.url, entry.fallbacks);
    }
  }

  // A failed image keeps its slot and tries the next fallback.
  function load(node, url, fallbacks) {
    node.onload = () => {
      release(node);
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
    request(node, url, { fallbacks = [], priority = false } = {}) {
      if (!node) return;
      if (!url) {
        pending.delete(node);
        requested.delete(node);
        if (node.getAttribute?.("src")) node.removeAttribute("src");
        if (loading.has(node)) {
          release(node);
          if (!timer) pump();
        }
        return;
      }
      pending.delete(node);
      if (node.getAttribute?.("src") && requested.get(node) === url) return;
      const entry = { url, fallbacks };
      if (priority) {
        const rest = [...pending];
        pending.clear();
        pending.set(node, entry);
        rest.forEach(([other, value]) => pending.set(other, value));
      } else {
        pending.set(node, entry);
      }
      if (!timer) pump();
    },
    clear() {
      pending.clear();
      // An interrupted load lost its handlers (fallbacks): a kept view's next request reloads it.
      loading.forEach((node) => {
        requested.delete(node);
        release(node);
      });
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get pendingCount() {
      return pending.size;
    }
  };
}
