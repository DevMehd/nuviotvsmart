import {
  RecommendationEngine as Engine,
  TasteModels,
  emptyTasteModel,
  ratingWeight,
  titleKey
} from "./recommendationEngine.js";
import { computeRecommendationTask } from "./personalRecommendationWorker.js";
import {
  personalContext,
  isCurrentContext,
  readPersonal,
  writePersonal,
  personalSpaceId,
  boundedMap,
  safeArtwork
} from "./personalContext.js";
import { WatchJournal } from "./watchJournal.js";
import { TitleRatings } from "./titleRatings.js";
import { PersoCloud } from "./persoCloud.js";

const REFRESH_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
export const RECOMMENDATION_LIMITS = Object.freeze({
  candidates: 200,
  seen: 200,
  seenDetails: 25,
  candidateDetails: 40,
  catalogs: 14,
  catalogItems: 25,
  concurrency: 2
});
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const words = (value) =>
  list(Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name || ""))
    .filter(Boolean);
const canonicalType = (type) =>
  ["tv", "show", "tvshow"].includes(String(type).toLowerCase())
    ? "series"
    : String(type || "movie").toLowerCase();
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Repository metadata -> the mobile pure-engine format. IDs retain provider prefixes. */
export function featuresOf(meta = {}, base = {}) {
  const value = { ...base, ...meta };
  const type = canonicalType(
    value.type || value.contentType || value.parentMetaType || value.itemType
  );
  const runtime =
    finite(value.runtimeMinutes) ?? finite(String(value.runtime || "").match(/\d+/)?.[0]);
  return {
    type,
    id: String(value.id || value.contentId || value.parentMetaId || value.itemId || ""),
    name: String(value.name || value.title || base.name || ""),
    poster: safeArtwork(value.poster || base.poster) || null,
    genres: words(value.genres).length ? words(value.genres) : words(base.genres),
    directors: words(value.directors || value.director).length
      ? words(value.directors || value.director)
      : list(value.credits?.crew)
          .filter((person) => person.job === "Director")
          .map((person) => person.name)
          .filter(Boolean),
    cast: words(value.cast || value.credits?.cast).slice(0, Engine.MAX_CAST),
    country: value.country || null,
    language: value.language || null,
    year:
      finite(value.year || value.releaseYear) ??
      finite(String(value.releaseInfo || value.released || "").match(/(?:19|20)\d{2}/)?.[0]),
    runtimeMinutes: runtime,
    rating: finite(value.imdbRating) ?? finite(value.rating) ?? finite(value.tmdbRating),
    votes: finite(value.voteCount) ?? finite(value.votes)
  };
}

const unique = (items) => [
  ...new Map(items.filter((item) => item.id).map((item) => [titleKey(item), item])).values()
];
const recommended = (title, reason = "popular") => ({
  type: title.type,
  id: title.id,
  name: title.name,
  poster: title.poster,
  releaseInfo: title.year == null ? null : String(title.year),
  imdbRating: title.rating == null ? null : String(title.rating),
  genres: title.genres,
  runtimeMinutes: title.runtimeMinutes,
  reason
});
const reasonText = (reason) =>
  reason.type === "watched"
    ? `watched:${reason.title}`
    : reason.type === "genre"
      ? `genre:${reason.genre}`
      : "popular";
const emptySnapshot = () => ({
  forYou: [],
  because: [],
  becauseTitle: null,
  model: emptyTasteModel(),
  recentModel: emptyTasteModel(),
  affinities: {},
  computedAtMs: 0,
  sessionCount: 0,
  ratingsStamp: 0,
  signalStamp: "",
  coldStart: true
});

/** Bounded catalog plan: at most four genre catalogs, three genres, four defaults, 14 total. */
export function recommendationCatalogRequests(
  addons,
  genres,
  types = new Set(["movie", "series"])
) {
  const catalogs = list(addons)
    .filter((addon) => addon.enabled !== false)
    .flatMap((addon) =>
      list(addon.catalogs)
        .filter((catalog) => types.has(canonicalType(catalog.apiType || catalog.type)))
        .map((catalog) => ({ addon, catalog }))
    );
  const requests = [];
  const add = (addon, catalog, genre) =>
    requests.push({
      addonBaseUrl: addon.baseUrl || addon.transportUrl,
      addonId: addon.id,
      addonName: addon.name,
      catalogId: catalog.id,
      catalogName: catalog.name,
      type: catalog.apiType || catalog.type,
      skip: 0,
      supportsSkip: false,
      extraArgs: genre == null ? {} : { genre }
    });
  const required = (extra) => extra.isRequired || extra.required;
  for (const { addon, catalog } of catalogs
    .filter(
      ({ catalog }) =>
        list(catalog.extra).some((extra) => extra.name === "genre") &&
        !list(catalog.extra).some((extra) => required(extra) && extra.name !== "genre")
    )
    .slice(0, 4)) {
    const options = list(catalog.extra).find((extra) => extra.name === "genre").options || [];
    for (const genre of genres.slice(0, 3)) {
      const option =
        options.find((value) => String(value).toLowerCase() === genre.toLowerCase()) ??
        (options.length ? null : genre);
      if (option != null) add(addon, catalog, option);
    }
  }
  catalogs
    .filter(({ catalog }) => !list(catalog.extra).some(required))
    .slice(0, 4)
    .forEach(({ addon, catalog }) => add(addon, catalog, null));
  return requests.slice(0, RECOMMENDATION_LIMITS.catalogs);
}

/** Lazy imports preserve the existing repository transports and avoid startup work. */
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
  addons: async (_ctx, valid) => {
    const { addonRepository } = await import("../../data/repository/addonRepository.js");
    return valid() ? addonRepository.getInstalledAddons({ timeoutMs: 5000 }) : [];
  },
  liked: async (ctx, valid) => {
    const { SharedLists } = await import("./sharedLists.js");
    return valid() ? SharedLists.likedTitles(ctx) : [];
  },
  catalog: async (request, _ctx, valid, signal) => {
    const { catalogRepository } = await import("../../data/repository/catalogRepository.js");
    if (!valid()) return [];
    const result = await catalogRepository.getCatalog({ ...request, signal });
    if (result.status !== "success") throw new Error("Catalog unavailable");
    return list(result.data?.items);
  },
  meta: async (title, _ctx, valid, signal) => {
    const { metaRepository } = await import("../../data/repository/metaRepository.js");
    if (!valid()) return null;
    let meta = metaRepository.getCachedMeta(title.type, title.id);
    if (!meta) {
      const result = await metaRepository.getMetaFromAllAddons(title.type, title.id);
      meta = result.status === "success" ? result.data : null;
    }
    if (!valid()) return null;
    const [{ TmdbSettingsStore }, { TmdbService }, { TmdbMetadataService }] = await Promise.all([
      import("../../data/local/tmdbSettingsStore.js"),
      import("../tmdb/tmdbService.js"),
      import("../tmdb/tmdbMetadataService.js")
    ]);
    if (!valid() || !TmdbSettingsStore.get().enabled) return meta;
    const tmdbId = await TmdbService.ensureTmdbId(meta?.id || title.id, title.type, { signal });
    if (!valid() || !tmdbId) return meta;
    const enrichment = await TmdbMetadataService.fetchEnrichment({
      tmdbId,
      contentType: title.type,
      signal
    });
    return enrichment
      ? {
          ...meta,
          ...enrichment,
          type: title.type,
          id: title.id,
          name: meta?.name || title.name,
          cast: enrichment.credits?.cast || meta?.cast,
          director: list(enrichment.credits?.crew)
            .filter((person) => person.job === "Director")
            .map((person) => person.name)
        }
      : meta;
  },
  similar: async (title, _ctx, valid) => {
    if (Array.isArray(title.moreLikeThis) && title.moreLikeThis.length) return title.moreLikeThis;
    const [{ TmdbService }, { TmdbMetadataService }] = await Promise.all([
      import("../tmdb/tmdbService.js"),
      import("../tmdb/tmdbMetadataService.js")
    ]);
    if (!valid()) return [];
    const tmdbId = await TmdbService.ensureTmdbId(title.id, title.type);
    return valid() && tmdbId
      ? TmdbMetadataService.fetchRecommendations({ tmdbId, contentType: title.type })
      : [];
  }
};

function defaultWorker() {
  if (typeof Worker === "undefined" || typeof document === "undefined") return null;
  return new Worker(new URL("assets/runtime/personal-recommendations-worker.js", document.baseURI));
}

function computeRunner(workerFactory) {
  let worker = null;
  let failed = false;
  let sequence = 0;
  const close = () => {
    worker?.terminate();
    worker = null;
  };
  return {
    close,
    async run(task, payload, valid) {
      if (!valid()) throw new Error("Obsolete personal context");
      if (!failed) {
        try {
          worker ||= workerFactory();
          if (worker) {
            const result = await new Promise((resolve, reject) => {
              const id = ++sequence;
              const timer = setTimeout(() => reject(new Error("Worker timeout")), 10000);
              worker.onmessage = ({ data }) => {
                if (data.id !== id) return;
                clearTimeout(timer);
                if (data.error) reject(new Error(data.error));
                else resolve(data.result);
              };
              worker.onerror = () => {
                clearTimeout(timer);
                reject(new Error("Worker unavailable"));
              };
              try {
                worker.postMessage({ id, task, payload });
              } catch (error) {
                clearTimeout(timer);
                reject(error);
              }
            });
            if (!valid()) throw new Error("Obsolete personal context");
            return result;
          }
        } catch (_) {
          failed = true;
          close();
        }
      }
      await yieldTurn();
      if (!valid()) throw new Error("Obsolete personal context");
      return computeRecommendationTask(task, payload);
    }
  };
}

/** Injectable sources make profile races and failure retention testable without network. */
export function createRecommendations(deps = {}) {
  const context = deps.context || personalContext;
  const isCurrent = deps.isCurrent || isCurrentContext;
  const read = deps.read || readPersonal;
  const write = deps.write || writePersonal;
  const journal = deps.journal || WatchJournal;
  const ratings = deps.ratings || TitleRatings;
  const cloud = deps.cloud || PersoCloud;
  const spaceId = deps.spaceId || personalSpaceId;
  const now = deps.now || Date.now;
  const sources = { ...defaultSources, ...deps.sources };
  const pending = new Map();
  const states = new Map();
  const listeners = new Set();
  const snapshots = new Map();
  const snapshot = (ctx = context()) => {
    if (!snapshots.has(ctx.scope)) {
      snapshots.set(ctx.scope, { ...emptySnapshot(), ...read(ctx, "recommendations", {}) });
      while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
    }
    return snapshots.get(ctx.scope);
  };
  const status = (ctx = context()) =>
    states.get(ctx.scope) || { loading: false, error: null, updatedAt: snapshot(ctx).computedAtMs };
  function notify(ctx, patch) {
    const previous = status(ctx);
    states.delete(ctx.scope);
    states.set(ctx.scope, { ...previous, ...patch });
    while (states.size > 8) states.delete(states.keys().next().value);
    if (isCurrent(ctx))
      for (const listener of listeners) {
        try {
          listener({ ctx, snapshot: snapshot(ctx), status: status(ctx) });
        } catch (_) {
          /* UI observers are isolated. */
        }
      }
  }
  const signalStamp = (ctx) => {
    const sessions = list(journal.read(ctx).sessions);
    const stamps = Object.values(ratings.all(ctx));
    return `${sessions.length}:${sessions.reduce((latest, session) => Math.max(latest, Number(session.endedAtEpochMs) || 0), 0)}:${stamps.reduce((latest, stamp) => Math.max(latest, Number(stamp.atMs) || 0), 0)}`;
  };

  async function refresh({ ctx = context(), force = false } = {}) {
    if (!isCurrent(ctx)) return snapshot(ctx);
    if (pending.has(ctx.scope)) return pending.get(ctx.scope);
    const cached = snapshot(ctx);
    if (
      !force &&
      cached.computedAtMs &&
      now() - cached.computedAtMs < REFRESH_MS &&
      cached.signalStamp === signalStamp(ctx)
    )
      return cached;
    const work = (async () => {
      const deadline = Date.now() + (deps.budgetMs ?? 90000);
      let timedOut = false;
      const controllers = new Set();
      const valid = () => !timedOut && Date.now() < deadline && isCurrent(ctx);
      const runner = computeRunner(deps.workerFactory || defaultWorker);
      async function request(callback, abortRun = false) {
        if (!valid()) throw new Error("Obsolete personal context");
        const controller = new AbortController();
        controllers.add(controller);
        let timer;
        try {
          return await Promise.race([
            Promise.resolve().then(() => callback(controller.signal)),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => {
                  if (abortRun) timedOut = true;
                  controller.abort();
                  reject(new Error("Personal request timeout"));
                },
                Math.min(deps.timeoutMs ?? 10000, Math.max(1, deadline - Date.now()))
              );
            })
          ]);
        } finally {
          clearTimeout(timer);
          controllers.delete(controller);
        }
      }
      notify(ctx, { loading: true, error: null });
      try {
        await Promise.allSettled([
          request(() => journal.sync(ctx), false),
          request(() => ratings.pull(ctx), false)
        ]);
        if (!valid()) throw new Error("Personal refresh interrupted");
        const stampedRatings = { ...ratings.all(ctx) };
        const journalData = journal.read(ctx);
        const usedSignalStamp = signalStamp(ctx);
        const sessions = list(journalData.sessions).slice(0, 4000);
        const results = await Promise.allSettled([
          request(() => sources.library(ctx, valid)),
          request(() => sources.progress(ctx, valid)),
          request(() => sources.addons(ctx, valid)),
          request(() => sources.liked(ctx, valid))
        ]);
        if (!valid()) throw new Error("Personal refresh interrupted");
        if (
          results[0].status === "rejected" ||
          results[1].status === "rejected" ||
          results[2].status === "rejected"
        )
          throw new Error("Personal sources unavailable");
        const library = list(results[0].value)
          .slice(0, 1000)
          .map((item) => featuresOf(item));
        const progress = list(results[1].value)
          .slice(0, 1000)
          .map((item) => featuresOf(item));
        const addons = list(results[2].value);
        const liked =
          results[3].status === "fulfilled"
            ? list(results[3].value).map((item) => featuresOf(item))
            : [];
        const explicit = Object.fromEntries(
          Object.entries(stampedRatings).flatMap(([key, stamp]) =>
            ratingWeight(stamp.value) == null ? [] : [[key, ratingWeight(stamp.value)]]
          )
        );
        const weights = Engine.interactionWeights(
          sessions.map((session) => ({
            key: `${canonicalType(session.parentMetaType)}:${session.parentMetaId}`,
            watchedMs: Number(session.watchedMs) || 0,
            durationMs: Number(session.durationMs) || 0,
            completed: Boolean(session.completed),
            endedAtMs: Number(session.endedAtEpochMs) || 0
          })),
          now(),
          new Set(library.map(titleKey)),
          new Set(liked.map(titleKey)),
          explicit
        );
        const known = new Map(
          [
            ...library,
            ...liked,
            ...sessions.map((session) =>
              featuresOf({ ...session, id: session.parentMetaId, type: session.parentMetaType })
            )
          ].map((item) => [titleKey(item), item])
        );
        const metadata = new Map();
        const detail = async (title) => {
          const key = titleKey(title);
          if (!metadata.has(key))
            metadata.set(
              key,
              request((signal) => sources.meta(title, ctx, valid, signal)).catch(() => null)
            );
          return metadata.get(key);
        };
        const keys = Object.entries(weights)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, RECOMMENDATION_LIMITS.seen)
          .map(([key]) => key);
        const seen = await boundedMap(
          keys,
          RECOMMENDATION_LIMITS.concurrency,
          async (key, index) => {
            const split = key.indexOf(":");
            const base = featuresOf({
              ...known.get(key),
              ...journalData.facts?.[key],
              ...stampedRatings[key],
              type: key.slice(0, split),
              id: key.slice(split + 1)
            });
            const meta = index < RECOMMENDATION_LIMITS.seenDetails ? await detail(base) : null;
            return featuresOf(meta || base, base);
          },
          valid
        );
        if (!valid()) throw new Error("Personal refresh interrupted");
        journal.rememberMetadata?.(ctx, seen);
        const coldStart = Engine.isColdStart(weights);
        const libraryGenres = Engine.genreCounts(library);
        const seenIdf = Engine.idf(seen);
        const genres = coldStart
          ? Object.entries(libraryGenres)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([key]) => key)
          : Engine.topGenres(
              Engine.profile(
                weights,
                Object.fromEntries(
                  seen.map((item) => [titleKey(item), Engine.vector(item, seenIdf)])
                )
              ),
              3
            );
        const seeds = seen.filter((item) => (weights[titleKey(item)] || 0) > 0).slice(0, 6);
        const similar = await boundedMap(
          seeds,
          2,
          async (seed) => {
            const meta = await detail(seed);
            return {
              seed,
              items: list(await request(() => sources.similar(meta || seed, ctx, valid)))
                .slice(0, 25)
                .map((item) => featuresOf(item))
            };
          },
          valid
        );
        let catalogsSucceeded = 0;
        const pages = await boundedMap(
          recommendationCatalogRequests(addons, genres),
          2,
          async (descriptor) => {
            const items = await request((signal) =>
              sources.catalog(descriptor, ctx, valid, signal)
            );
            catalogsSucceeded += 1;
            return list(items)
              .slice(0, RECOMMENDATION_LIMITS.catalogItems)
              .map((item) => featuresOf(item));
          },
          valid
        );
        if (!valid()) throw new Error("Personal refresh interrupted");
        const exclude = [
          ...new Set([...Object.keys(weights), ...progress.map(titleKey), ...library.map(titleKey)])
        ];
        const candidates = unique([...similar.flatMap((row) => row.items), ...pages.flat()])
          .filter((item) => !exclude.includes(titleKey(item)))
          .slice(0, RECOMMENDATION_LIMITS.candidates);
        if (!catalogsSucceeded && !similar.some((row) => row.items.length) && cached.forYou.length)
          throw new Error("Recommendations temporarily unavailable");
        const rankPayload = {
          weights,
          seen,
          candidates,
          exclude,
          currentYear: new Date(now()).getFullYear(),
          libraryGenres
        };
        const preliminary = await runner.run(
          "rank",
          { ...rankPayload, limit: RECOMMENDATION_LIMITS.candidateDetails },
          valid
        );
        const enriched = await boundedMap(
          preliminary,
          2,
          async ({ title }) => featuresOf((await detail(title)) || title, title),
          valid
        );
        const enrichedKeys = new Set(enriched.map(titleKey));
        const ranked = await runner.run(
          "rank",
          {
            ...rankPayload,
            candidates: [
              ...enriched,
              ...candidates.filter((item) => !enrichedKeys.has(titleKey(item)))
            ],
            limit: 20
          },
          valid
        );
        const recentKeys = [
          ...new Set([
            ...sessions
              .filter((session) => session.endedAtEpochMs >= now() - 90 * DAY_MS)
              .map((session) => `${canonicalType(session.parentMetaType)}:${session.parentMetaId}`),
            ...Object.entries(stampedRatings)
              .filter(([, stamp]) => stamp.atMs >= now() - 90 * DAY_MS)
              .map(([key]) => key)
          ])
        ];
        const models = await runner.run("models", { weights, seen, recentKeys, now: now() }, valid);
        const because = similar
          .map(({ seed, items }) => ({
            seed,
            items: unique(items)
              .filter((item) => !exclude.includes(titleKey(item)))
              .slice(0, 15)
          }))
          .find((row) => row.items.length >= 5);
        const next = {
          ...models,
          forYou: ranked.map((rec) => recommended(rec.title, reasonText(rec.reason))),
          because: because?.items.map((item) => recommended(item)) || [],
          becauseTitle: because?.seed.name || null,
          computedAtMs: now(),
          sessionCount: sessions.length,
          ratingsStamp: Math.max(
            0,
            ...Object.values(stampedRatings).map((stamp) => Number(stamp.atMs) || 0)
          ),
          signalStamp: usedSignalStamp,
          coldStart
        };
        if (!valid()) throw new Error("Personal refresh interrupted");
        write(ctx, "recommendations", next);
        snapshots.set(ctx.scope, next);
        notify(ctx, { loading: false, error: null, updatedAt: next.computedAtMs });
        // Keep the existing mobile wire contract; the full taste model remains local.
        try {
          const id = await request(() => spaceId(ctx), false);
          if (id && valid())
            await request(
              () =>
                cloud.putDoc(id, `reco:${ctx.profileIndex}`, ctx.space.deviceId || "vidaa-local", {
                  updatedAt: next.computedAtMs,
                  forYou: next.forYou
                }),
              false
            );
        } catch (_) {
          /* Local recommendations remain available without the cloud. */
        }
        return next;
      } catch (_) {
        notify(ctx, {
          loading: false,
          error: isCurrent(ctx)
            ? "Actualisation indisponible. Les dernières recommandations restent disponibles."
            : null
        });
        return snapshot(ctx);
      } finally {
        runner.close();
        controllers.forEach((controller) => controller.abort());
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
    snapshot,
    status,
    refresh,
    featuresOf,
    predict(meta, ctx = context()) {
      return TasteModels.predict(snapshot(ctx).model, featuresOf(meta));
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

export const Recommendations = createRecommendations();
