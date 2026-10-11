import { Platform } from "../../../platform/index.js";

// Only the public artwork repository observed in this personal fork is eligible.
// Never forward authenticated addon URLs, query strings or arbitrary hosts.
const PUBLIC_ARTWORK =
  /^https:\/\/raw\.githubusercontent\.com\/ImKaptain\/nuvio-art\/main\/[^?#]+\.(?:png|jpe?g|webp)$/i;

export function getVidaaArtworkUrl(value, width = 640) {
  const source = getVidaaArtworkOriginal(value) || String(value || "").trim();
  if (
    !Platform.isVidaa() ||
    globalThis.__NUVIO_IMAGE_OPTIMIZATION__ !== true ||
    !PUBLIC_ARTWORK.test(source)
  )
    return source;
  const safeWidth = width === 1280 ? 1280 : 640;
  return `/_vercel/image?url=${encodeURIComponent(source)}&w=${safeWidth}&q=80`;
}

export function getVidaaArtworkOriginal(value) {
  try {
    const url = new URL(String(value || ""), "https://nuvio.invalid");
    if (url.origin !== "https://nuvio.invalid" || url.pathname !== "/_vercel/image") return "";
    const source = url.searchParams.get("url") || "";
    return PUBLIC_ARTWORK.test(source) ? source : "";
  } catch {
    return "";
  }
}

export function buildVidaaArtworkFallbackAttributes(source) {
  const original = getVidaaArtworkOriginal(source);
  if (!original) return "";
  return ` data-original-src="${original.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;
}

// Retire the original before assigning src so a failed fallback cannot loop.
export const VIDAA_ARTWORK_FALLBACK_HANDLER =
  "if(this.dataset.originalSrc){var s=this.dataset.originalSrc;delete this.dataset.originalSrc;this.src=s;return;}";
