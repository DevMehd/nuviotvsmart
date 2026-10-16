const TMDB_IMAGE_HOST_PATTERN = /^(?:https?:)?\/\/image\.tmdb\.org\//i;

// These widths are used by TMDB's poster/backdrop image endpoints. A caller
// can cap small card artwork without changing the full-screen hero policy.
const TMDB_IMAGE_WIDTHS = new Set([92, 154, 185, 300, 342, 500, 780, 1280]);

export function limitTmdbImageWidth(value, maxWidth) {
  if (
    typeof value !== "string" ||
    !TMDB_IMAGE_HOST_PATTERN.test(value) ||
    !TMDB_IMAGE_WIDTHS.has(maxWidth)
  ) {
    return value;
  }
  return value.replace(
    /^((?:https?:)?\/\/image\.tmdb\.org\/t\/p\/)(original|w(\d+))\//i,
    (match, prefix, size, width) =>
      size.toLowerCase() === "original" || Number(width) > maxWidth
        ? `${prefix}w${maxWidth}/`
        : match
  );
}

/**
 * Keep Home artwork within the source sizes used by Android TV.
 * Keep unrelated artwork URLs byte-for-byte unchanged.
 */
export function normalizeTmdbBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(
    /^((?:https?:)?\/\/image\.tmdb\.org\/t\/p\/)(?:original|w780)\//i,
    "$1w1280/"
  );
}

export function normalizeTmdbPosterUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/^((?:https?:)?\/\/image\.tmdb\.org\/t\/p\/)original\//i, "$1w500/");
}
