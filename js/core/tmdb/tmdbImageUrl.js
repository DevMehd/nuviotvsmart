const TMDB_IMAGE_HOST_PATTERN = /^(?:https?:)?\/\/image\.tmdb\.org\//i;

/**
 * Keep Home artwork within the source sizes used by Android TV.
 * Keep unrelated artwork URLs byte-for-byte unchanged.
 */
export function normalizeTmdbBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)(?:original|w780)\//i, "$1w1280/");
}

/** Use a card-sized backdrop without enlarging already smaller artwork. */
export function normalizeTmdbCardBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) return normalized;
  return normalized.replace(/(\/t\/p\/)(?:original|w1280)\//i, "$1w780/");
}

export function normalizeTmdbPosterUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)original\//i, "$1w500/");
}
