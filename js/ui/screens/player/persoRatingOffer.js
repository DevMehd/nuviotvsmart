// End of a film or of a season (≥ 90 % watched): offer a personal rating once (nuv-035).
import { TitleRatings } from "../../../core/perso/titleRatings.js";
import { showRatingDialog } from "../../components/persoRatingOverlays.js";

const SERIES_TYPES = new Set(["series", "tv", "show", "anime"]);

/** Pure decision, unit-tested. */
export function shouldOfferRating({
  itemType,
  positionSec,
  durationSec,
  season,
  episode,
  episodes = [],
  alreadyRated
}) {
  if (alreadyRated) return false;
  if (!(durationSec > 0) || positionSec < durationSec * 0.9) return false;
  if (!SERIES_TYPES.has(String(itemType || "").toLowerCase())) return true;
  const s = Number(season);
  const e = Number(episode);
  if (!Number.isFinite(s) || !Number.isFinite(e) || !Array.isArray(episodes) || !episodes.length)
    return false;
  const last = episodes
    .filter((ep) => Number(ep?.season) === s)
    .reduce((max, ep) => Math.max(max, Number(ep?.episode || 0)), 0);
  return last > 0 && e === last;
}

export function maybeOfferRatingAfterPlayback(screen, video) {
  try {
    const params = screen?.params || {};
    const type = String(params.itemType || "movie");
    const id = String(params.itemId || "");
    if (!id || !video) return;
    const offer = shouldOfferRating({
      itemType: type,
      positionSec: Number(video.currentTime || 0),
      durationSec: Number(video.duration || 0),
      season: params.season,
      episode: params.episode,
      episodes: screen.episodes,
      alreadyRated: TitleRatings.valueOf(SERIES_TYPES.has(type) ? "series" : type, id) != null
    });
    if (!offer) return;
    const name = String(params.itemTitle || params.playerTitle || params.title || id);
    // Shown once the player has left, over the screen it returns to.
    setTimeout(
      () =>
        showRatingDialog({
          type: SERIES_TYPES.has(type) ? "series" : type,
          id,
          name,
          poster: params.poster || params.itemPoster || "",
          fromPlaybackEnd: true
        }),
      600
    );
  } catch (_error) {
    // Never block leaving the player.
  }
}
