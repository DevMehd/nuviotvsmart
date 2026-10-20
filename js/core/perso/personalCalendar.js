import {
  personalContext,
  isCurrentContext,
  readPersonal,
  writePersonal,
  boundedMap,
  safeArtwork
} from "./personalContext.js";

const DAY_MS = 86_400_000;
export const CALENDAR_LIMITS = Object.freeze({
  pastDays: 7,
  futureDays: 60,
  shows: 80,
  episodes: 500,
  concurrency: 2,
  refreshMs: 6 * 3_600_000
});
const list = (value) => (Array.isArray(value) ? value : []);
const series = (type) => ["series", "tv", "show", "tvshow"].includes(String(type).toLowerCase());
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
export function calendarDayIndex(value) {
  return validDate(value) ? Date.parse(`${value}T00:00:00Z`) / DAY_MS : null;
}

/** Plain dates stay unchanged; an instant belongs to the viewer's local day. */
export function calendarReleaseDate(raw) {
  const value = String(raw || "").trim();
  if (validDate(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    if (!validDate(value.slice(0, 10))) return null;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return localDate(date);
    return null;
  }
  const embedded = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  return embedded && validDate(embedded) ? embedded : null;
}

export function followedCalendarShows(library, progress, nowMs = Date.now()) {
  const shows = new Map();
  function add(item, source) {
    const type = item.type || item.contentType || item.parentMetaType || item.itemType;
    const id = String(item.id || item.contentId || item.parentMetaId || item.itemId || "");
    if (!series(type) || !id) return;
    const previous = shows.get(id) || {
      type: "series",
      id,
      name: item.name || item.title || "",
      poster: safeArtwork(item.poster),
      sources: []
    };
    if (!previous.sources.includes(source)) previous.sources.push(source);
    shows.set(id, previous);
  }
  list(library).forEach((item) => add(item, "Library"));
  list(progress)
    .filter(
      (item) =>
        (item.season ?? item.seasonNumber) != null &&
        nowMs - Number(item.updatedAt || item.lastUpdatedEpochMs || 0) < 120 * DAY_MS
    )
    .forEach((item) => add(item, "InProgress"));
  return [...shows.values()];
}

export function calendarEpisodes(meta, show, nowMs = Date.now()) {
  const today = calendarDayIndex(localDate(new Date(nowMs)));
  return list(meta?.videos).flatMap((video) => {
    if (video.season == null && video.episode == null) return [];
    const releaseDate = calendarReleaseDate(video.released);
    const day = releaseDate ? calendarDayIndex(releaseDate) : null;
    if (day == null || day < today - 7 || day > today + 60) return [];
    const videoId = String(video.id || "");
    if (!videoId) return [];
    return [
      {
        showType: "series",
        showId: show.id,
        showTitle: meta.name || show.name,
        poster: safeArtwork(meta.poster || show.poster) || null,
        thumbnail: safeArtwork(video.thumbnail || meta.background) || null,
        seasonNumber: video.season ?? null,
        episodeNumber: video.episode ?? null,
        episodeTitle: video.title || video.name || null,
        releaseDate,
        sources: [...show.sources],
        videoId
      }
    ];
  });
}

const defaultSources = {
  library: async (_ctx, valid) => {
    const { libraryRepository } = await import("../../data/repository/libraryRepository.js");
    return valid() ? libraryRepository.getItems({ hydrate: false }) : [];
  },
  progress: async (_ctx, valid) => {
    const { watchProgressRepository } =
      await import("../../data/repository/watchProgressRepository.js");
    return valid() ? watchProgressRepository.getAllForContinueWatching() : [];
  },
  meta: async (show, _ctx, valid) => {
    const { metaRepository } = await import("../../data/repository/metaRepository.js");
    if (!valid()) return null;
    const cached = metaRepository.getCachedMeta(show.type, show.id);
    if (cached) return cached;
    const result = await metaRepository.getMetaFromAllAddons(show.type, show.id);
    if (result.status !== "success") throw new Error("Episode metadata unavailable");
    return result.data;
  }
};

/** Per-profile sources only. Never consumes the mobile's unscoped `calendar` document. */
export function createPersonalCalendar(deps = {}) {
  const context = deps.context || personalContext;
  const isCurrent = deps.isCurrent || isCurrentContext;
  const readStore = deps.read || readPersonal;
  const write = deps.write || writePersonal;
  const now = deps.now || Date.now;
  const sources = { ...defaultSources, ...deps.sources };
  const pending = new Map();
  const states = new Map();
  const listeners = new Set();
  const cache = (ctx) =>
    readStore(ctx, "calendar", { episodes: [], refreshedAtMs: 0, sourcesStamp: "" });
  const read = (ctx = context()) => list(cache(ctx).episodes);
  const status = (ctx = context()) =>
    states.get(ctx.scope) || {
      loading: false,
      error: null,
      truncated: false,
      updatedAt: cache(ctx).refreshedAtMs
    };
  function notify(ctx, patch) {
    const previous = status(ctx);
    states.delete(ctx.scope);
    states.set(ctx.scope, { ...previous, ...patch });
    while (states.size > 8) states.delete(states.keys().next().value);
    if (isCurrent(ctx))
      for (const listener of listeners) {
        try {
          listener({ ctx, episodes: read(ctx), status: status(ctx) });
        } catch (_) {
          /* Observer isolation. */
        }
      }
  }
  async function refresh(ctx = context(), { force = false } = {}) {
    if (!isCurrent(ctx)) return read(ctx);
    if (pending.has(ctx.scope)) return pending.get(ctx.scope);
    const work = (async () => {
      const deadline = Date.now() + (deps.budgetMs ?? 90000);
      const valid = () => Date.now() < deadline && isCurrent(ctx);
      const previous = cache(ctx);
      const request = async (callback) => {
        let timer;
        try {
          return await Promise.race([
            Promise.resolve().then(callback),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Calendar timeout")),
                Math.min(deps.timeoutMs ?? 10000, Math.max(1, deadline - Date.now()))
              );
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      notify(ctx, { loading: true, error: null });
      try {
        const [library, progress] = await Promise.all([
          request(() => sources.library(ctx, valid)),
          request(() => sources.progress(ctx, valid))
        ]);
        if (!valid()) throw new Error("Obsolete calendar context");
        const allShows = followedCalendarShows(library, progress, now());
        const shows = allShows.slice(0, CALENDAR_LIMITS.shows);
        const sourcesStamp = shows
          .map((show) => `${show.id}:${show.sources.join(",")}`)
          .sort()
          .join("|");
        if (
          !force &&
          previous.refreshedAtMs &&
          now() - previous.refreshedAtMs < CALENDAR_LIMITS.refreshMs &&
          previous.sourcesStamp === sourcesStamp
        ) {
          notify(ctx, { loading: false });
          return read(ctx);
        }
        const failures = new Set();
        const results = await boundedMap(
          shows,
          CALENDAR_LIMITS.concurrency,
          async (show) => {
            try {
              const meta = await request(() => sources.meta(show, ctx, valid));
              if (!meta) throw new Error("Calendar metadata unavailable");
              return calendarEpisodes(meta, show, now());
            } catch (_) {
              failures.add(show.id);
              return [];
            }
          },
          valid
        );
        if (!valid()) throw new Error("Calendar refresh interrupted");
        // Keep cached rows for temporarily unavailable shows, but remove unfollowed ones.
        const stale = list(previous.episodes)
          .filter((episode) => failures.has(episode.showId))
          .map((episode) => ({
            ...episode,
            sources: shows.find((show) => show.id === episode.showId)?.sources || episode.sources
          }));
        const rows = [...results.flat(), ...stale].filter((episode) => {
          const day = calendarDayIndex(episode.releaseDate),
            today = calendarDayIndex(localDate(new Date(now())));
          return day != null && day >= today - 7 && day <= today + 60;
        });
        const unique = [
          ...new Map(
            rows.map((episode) => [`${episode.showId}:${episode.videoId}`, episode])
          ).values()
        ].sort(
          (a, b) =>
            a.releaseDate.localeCompare(b.releaseDate) ||
            a.showTitle.localeCompare(b.showTitle) ||
            (a.seasonNumber || 0) - (b.seasonNumber || 0) ||
            (a.episodeNumber || 0) - (b.episodeNumber || 0)
        );
        const next = {
          episodes: unique.slice(0, CALENDAR_LIMITS.episodes),
          refreshedAtMs: failures.size ? 0 : now(),
          sourcesStamp
        };
        write(ctx, "calendar", next);
        notify(ctx, {
          loading: false,
          error: failures.size ? "Certaines séries n’ont pas pu être actualisées." : null,
          truncated: allShows.length > shows.length || unique.length > CALENDAR_LIMITS.episodes,
          updatedAt: next.refreshedAtMs
        });
        return next.episodes;
      } catch (_) {
        notify(ctx, {
          loading: false,
          error: isCurrent(ctx)
            ? "Actualisation indisponible. Le calendrier enregistré reste disponible."
            : null
        });
        return read(ctx);
      }
    })();
    pending.set(ctx.scope, work);
    try {
      return await work;
    } finally {
      if (pending.get(ctx.scope) === work) pending.delete(ctx.scope);
    }
  }
  return {
    read,
    refresh,
    status,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
export const Calendar = createPersonalCalendar();
