import { getVidaaArtworkUrl } from "../screens/home/vidaaArtworkOptimization.js";

// Images of the new TV Home (nuv-091): requested at the displayed size, decoded a few at a time.

const TMDB_SIZES = [342, 780, 1280];

/** URL for a display width: TMDB size bucket, nuvio-art through the Vercel optimizer, others as is. */
export function sizedImageUrl(url, width) {
  const value = String(url || "");
  if (!value) return "";
  if (/image\.tmdb\.org\/t\/p\/[^/]+\//.test(value)) {
    const size =
      TMDB_SIZES.find((candidate) => candidate >= width) || TMDB_SIZES[TMDB_SIZES.length - 1];
    return value.replace(/\/t\/p\/[^/]+\//, `/t/p/w${size}/`);
  }
  return getVidaaArtworkUrl(value, width <= 640 ? 640 : 1280);
}

/**
 * At most `concurrency` images load at once; a node asking again replaces its pending request,
 * so a recycled card never shows an image it no longer represents.
 */
export function createImageQueue({ concurrency = 3, isBusy = () => false, retryMs = 120 } = {}) {
  const pending = new Map();
  let active = 0;
  let timer = null;

  function pump() {
    timer = null;
    if (isBusy()) {
      timer = setTimeout(pump, retryMs);
      return;
    }
    for (const [node, url] of pending) {
      if (active >= concurrency) return;
      pending.delete(node);
      active += 1;
      const done = () => {
        node.onload = node.onerror = null;
        active -= 1;
        pump();
      };
      node.onload = done;
      node.onerror = done;
      node.src = url;
    }
  }

  return {
    request(node, url) {
      if (!node) return;
      if (!url) {
        pending.delete(node);
        if (node.getAttribute?.("src")) node.removeAttribute("src");
        return;
      }
      pending.delete(node);
      if (node.getAttribute?.("src") === url) return;
      pending.set(node, url);
      if (!timer) pump();
    },
    clear() {
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get pendingCount() {
      return pending.size;
    }
  };
}
