import {
  getVidaaArtworkUrl,
  getVidaaArtworkOriginal,
  VIDAA_ARTWORK_FALLBACK_HANDLER
} from "./vidaaArtworkOptimization.js";
import { uniqueNonEmptyValues } from "./homeUtils.js";
import { normalizeTmdbBackdropUrl } from "../../../core/tmdb/tmdbImageUrl.js";

/**
 * Builds the ordered list of image candidates used by hero, poster and continue-watching cards.
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroBackdropSources(item = null) {
  return uniqueNonEmptyValues(
    [
      normalizeTmdbBackdropUrl(item?.background),
      normalizeTmdbBackdropUrl(item?.backdrop),
      normalizeTmdbBackdropUrl(item?.backdropUrl),
      normalizeTmdbBackdropUrl(item?.landscapePoster),
      item?.poster,
      item?.thumbnail,
      item?.episodeThumbnail
    ].flatMap((source) => {
      const original = getVidaaArtworkOriginal(source) || source;
      const optimized = getVidaaArtworkUrl(original, 1280);
      return optimized !== original ? [optimized, original] : [original];
    })
  );
}

export function encodeHeroBackdropFallbacks(sources = []) {
  return sources.map((source) => encodeURIComponent(source)).join("|");
}

export function buildImageFallbackErrorHandler() {
  return (
    VIDAA_ARTWORK_FALLBACK_HANDLER +
    "var q=(this.dataset.fallbackSrcs||'').split('|').filter(Boolean);var next=q.shift();if(next){this.dataset.fallbackSrcs=q.join('|');this.src=decodeURIComponent(next);return;}this.removeAttribute('src');this.classList.add('placeholder');"
  );
}
