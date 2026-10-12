import { Platform } from "../../platform/index.js";

const PUBLIC_BADGE =
  /^https:\/\/cdn\.xperience-app\.com\/badges\/(?:elite|nardbadges)\/[a-z0-9_-]+\.webp$/i;

export function getVidaaBadgeImageUrl(value) {
  const source = getVidaaBadgeImageOriginal(value) || String(value || "").trim();
  if (
    !Platform.isVidaa() ||
    globalThis.__NUVIO_IMAGE_OPTIMIZATION__ !== true ||
    !PUBLIC_BADGE.test(source)
  )
    return source;
  return `/_vercel/image?url=${encodeURIComponent(source)}&w=128&q=80`;
}

export function getVidaaBadgeImageOriginal(value) {
  try {
    const url = new URL(String(value || ""), "https://nuvio.invalid");
    if (url.origin !== "https://nuvio.invalid" || url.pathname !== "/_vercel/image") return "";
    const source = url.searchParams.get("url") || "";
    return PUBLIC_BADGE.test(source) ? source : "";
  } catch (_) {
    return "";
  }
}

export function buildVidaaBadgeFallbackAttributes(value) {
  const original = getVidaaBadgeImageOriginal(value);
  if (!original) return "";
  return ` data-original-src="${original}" onerror="if(this.dataset.originalSrc){var s=this.dataset.originalSrc;delete this.dataset.originalSrc;this.src=s;}"`;
}
