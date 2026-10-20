import { isWatchProgressCompleted } from "../../../domain/model/watchProgress.js";
import { isCurrentContext } from "../../../core/perso/personalContext.js";

// Same policy as mobile: use the latest episode per show and cached metadata.
// No new metadata fan-out is needed to open the time-budget picker.
export function episodesFromProgress(progress, cachedMeta) {
  const shows = new Map();
  for (const entry of [...progress].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))) {
    const season = entry.season ?? entry.seasonNumber;
    const episode = entry.episode ?? entry.episodeNumber;
    const id = entry.contentId || entry.parentMetaId;
    const type = entry.contentType || entry.parentMetaType || "series";
    const key = `${type}:${id}`;
    if (!id || season == null || episode == null || shows.has(key)) continue;
    shows.set(key, { entry, id, type, season: Number(season), episode: Number(episode) });
  }
  return [...shows.values()].slice(0, 8).flatMap(({ entry, id, type, season, episode }) => {
    const meta = cachedMeta(type, id);
    if (!meta) return [];
    const complete = isWatchProgressCompleted(entry);
    const next = (meta.videos || [])
      .filter((video) => Number(video.season) > 0 && video.episode != null)
      .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode))
      .find((video) =>
        complete
          ? Number(video.season) > season ||
            (Number(video.season) === season && Number(video.episode) > episode)
          : Number(video.season) === season && Number(video.episode) === episode
      );
    if (!next) return [];
    const remaining =
      !complete && entry.durationMs > 0
        ? Math.max(1, Math.floor((entry.durationMs - entry.positionMs) / 60000))
        : Number(next.runtime) || 45;
    return [
      {
        type,
        id,
        name: meta.name || entry.title,
        poster: meta.poster || entry.poster,
        runtimeMinutes: remaining,
        subtitle: `S${next.season} E${next.episode} · ${remaining} min${complete ? "" : " restantes"}`
      }
    ];
  });
}

export async function nextEpisodeSuggestions(ctx) {
  const [{ watchProgressRepository }, { metaRepository }] = await Promise.all([
    import("../../../data/repository/watchProgressRepository.js"),
    import("../../../data/repository/metaRepository.js")
  ]);
  if (!isCurrentContext(ctx)) return [];
  let timer;
  try {
    const progress = await Promise.race([
      watchProgressRepository.getAllForContinueWatching(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve([]), 8000);
      })
    ]);
    return isCurrentContext(ctx)
      ? episodesFromProgress(progress, (type, id) => metaRepository.getCachedMeta(type, id))
      : [];
  } finally {
    clearTimeout(timer);
  }
}
