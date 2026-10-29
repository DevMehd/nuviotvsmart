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

// Cinemeta posters (images.metahub.space/poster) are the only common artwork host sending no
// CORS header (curl, 29/10), so WebGL cannot read them. TMDB, metahub logos and backgrounds,
// trakt, imgur, fanart and GitHub send one and stay direct. Exact path, no query string: a
// private addon URL never reaches the proxy.
const NO_CORS_POSTER =
  /^https:\/\/images\.metahub\.space\/poster\/(?:small|medium|large)\/tt\d+\/img$/;
// Single width (Vercel Hobby quota): the modern poster is 229 px wide. Must be in vercel.json sizes.
export const GL_PROXY_WIDTH = 256;
const CLOUDINARY_CLOUD = /^[a-z0-9_-]{1,64}$/i;

/**
 * URL the WebGL Home can upload as a texture: sizedImageUrl, except a no-CORS poster, which goes
 * through Cloudinary fetch when a public cloud name is configured, else the same-origin Vercel
 * optimizer on Vercel, else stays as is (it then fails and shows the text tile).
 */
export function glImageUrl(url, width) {
  const value = sizedImageUrl(url, width);
  if (!NO_CORS_POSTER.test(value)) return value;
  const cloud = globalThis.__NUVIO_CLOUDINARY_CLOUD__;
  if (typeof cloud === "string" && CLOUDINARY_CLOUD.test(cloud))
    return `https://res.cloudinary.com/${cloud}/image/fetch/w_${GL_PROXY_WIDTH},q_auto,f_auto/${encodeURIComponent(value)}`;
  if (globalThis.__NUVIO_IMAGE_OPTIMIZATION__ === true)
    return `/_vercel/image?url=${encodeURIComponent(value)}&w=${GL_PROXY_WIDTH}&q=80`;
  return value;
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
    }
  };
}
