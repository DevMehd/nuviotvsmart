import {
  personalContext,
  personalSpaceId,
  readPersonal,
  writePersonal
} from "./personalContext.js";
import { PersoCloud } from "./persoCloud.js";

const MAX_SESSIONS = 4000;
export function mergeWatchSessions(...groups) {
  const byId = new Map();
  groups.flat().forEach((session) => {
    if (
      !session?.id ||
      !Number.isFinite(Number(session.watchedMs)) ||
      Number(session.watchedMs) < 0
    )
      return;
    const key =
      session.origin === "Estimated"
        ? `estimated:${session.id}`
        : `${session.deviceId || session.device || ""}:${session.id}`;
    const previous = byId.get(key);
    if (!previous || Number(session.endedAtEpochMs) >= Number(previous.endedAtEpochMs))
      byId.set(key, session);
  });
  return [...byId.values()]
    .sort((a, b) => b.endedAtEpochMs - a.endedAtEpochMs)
    .slice(0, MAX_SESSIONS);
}

// A seek, pause, stalled decoder, or a backgrounded page contributes no time.
// The media delta is bounded by elapsed monotonic time and playback rate.
export function playedDelta(previous, sample) {
  if (
    !previous ||
    sample.paused ||
    sample.seeking ||
    sample.hidden ||
    previous.paused ||
    previous.seeking ||
    previous.hidden
  )
    return 0;
  if (![sample.at, sample.position, previous.at, previous.position].every(Number.isFinite))
    return 0;
  const wall = sample.at - previous.at;
  const media = (sample.position - previous.position) * 1000;
  const rate = Math.max(0.25, Math.min(4, Number(sample.rate || 1)));
  if (wall <= 0 || wall > 5000 || media <= 0 || media > wall * rate + 1000) return 0;
  return Math.min(media, wall * rate);
}

export function statistics(sessions, period = "30", now = Date.now(), facts = {}) {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (period === "year") start.setMonth(0, 1);
  else if (period === "all") start.setTime(0);
  else start.setDate(start.getDate() - (Number(period) || 30) + 1);
  const valid = mergeWatchSessions(sessions).filter(
    (s) =>
      (s.watchedMs >= 60000 || s.origin === "Estimated") &&
      s.startedAtEpochMs >= start.getTime() &&
      s.startedAtEpochMs <= now
  );
  const titles = new Map();
  const daily = new Map();
  const genres = new Map();
  let total = 0,
    estimated = 0;
  const devices = new Set();
  const episodes = new Set();
  const completed = new Set();
  for (const s of valid) {
    const ms = Math.max(0, Number(s.watchedMs) || 0);
    total += ms;
    if (s.origin === "Estimated") estimated += ms;
    devices.add(s.deviceName || s.device || "Appareil");
    const key = `${s.parentMetaType}:${s.parentMetaId}`;
    const row = titles.get(key) || {
      type: s.parentMetaType,
      id: s.parentMetaId,
      name: s.title,
      poster: s.poster,
      watchedMs: 0,
      completed: false
    };
    row.watchedMs += ms;
    row.completed ||= Boolean(s.completed);
    titles.set(key, row);
    if (s.completed) completed.add(`${key}:${s.videoId || s.parentMetaId}`);
    if (s.seasonNumber != null && s.episodeNumber != null)
      episodes.add(`${key}:${s.seasonNumber}:${s.episodeNumber}`);
    const d = new Date(s.startedAtEpochMs);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    daily.set(day, (daily.get(day) || 0) + ms);
    for (const genre of facts[key]?.genres || []) genres.set(genre, (genres.get(genre) || 0) + ms);
  }
  return {
    totalWatchedMs: total,
    sessionCount: valid.length,
    episodeCount: episodes.size,
    movieCount: [...titles.values()].filter((s) => s.type === "movie").length,
    seriesCount: [...titles.values()].filter((s) => s.type !== "movie").length,
    completedCount: completed.size,
    estimatedShare: total ? estimated / total : 0,
    activeDays: daily.size,
    devices: [...devices],
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)),
    genres: [...genres].sort((a, b) => b[1] - a[1]).slice(0, 8),
    top: [...titles.values()].sort((a, b) => b.watchedMs - a.watchedMs).slice(0, 20)
  };
}

export function createWatchJournal(deps = {}) {
  const context = deps.context || personalContext;
  const readStore = deps.read || readPersonal;
  const write = deps.write || writePersonal;
  const spaceId = deps.spaceId || personalSpaceId;
  const cloud = deps.cloud || PersoCloud;
  const now = deps.now || Date.now;
  const request = async (callback) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(callback),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Journal synchronization timeout")),
            deps.timeoutMs ?? 10000
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    pending: new Map(),
    read(ctx = context()) {
      return readStore(ctx, "journal", { version: 1, sessions: [], facts: {} });
    },
    rememberMetadata(ctx, titles) {
      const journal = this.read(ctx);
      const facts = { ...journal.facts };
      for (const title of titles) {
        if (!title.id || !title.genres?.length) continue;
        facts[`${title.type}:${title.id}`] = {
          type: title.type,
          id: title.id,
          name: title.name,
          genres: title.genres,
          releaseYear: title.year,
          runtimeMinutes: title.runtimeMinutes,
          poster: title.poster,
          fetchedAtEpochMs: now()
        };
      }
      const bounded = Object.fromEntries(
        Object.entries(facts)
          .sort(([, a], [, b]) => Number(b.fetchedAtEpochMs) - Number(a.fetchedAtEpochMs))
          .slice(0, 1000)
      );
      write(ctx, "journal", { ...journal, facts: bounded });
    },
    start(params, ctx = context()) {
      if (!params?.itemId) return null;
      const startedAt = now();
      return {
        ctx,
        previous: null,
        lastSaved: startedAt,
        record: {
          id: `vidaa-${startedAt}-${Math.random().toString(36).slice(2, 10)}`,
          contentType: params.itemType || "movie",
          parentMetaId: params.itemId,
          parentMetaType: params.itemType || "movie",
          videoId: params.videoId || params.itemId,
          title: params.itemTitle || params.playerTitle || params.title || params.itemId,
          poster: params.poster || params.itemPoster || null,
          seasonNumber: params.season ?? null,
          episodeNumber: params.episode ?? null,
          startedAtEpochMs: startedAt,
          endedAtEpochMs: startedAt,
          watchedMs: 0,
          durationMs: 0,
          completed: false,
          origin: "Player",
          device: "vidaa",
          deviceId: ctx.space.deviceId || "vidaa-local"
        }
      };
    },
    tick(run, sample) {
      if (!run) return;
      run.record.watchedMs += playedDelta(run.previous, sample);
      run.record.durationMs = Math.max(0, Number(sample.duration || 0) * 1000);
      run.record.endedAtEpochMs = now();
      run.record.completed ||= sample.duration > 0 && sample.position >= sample.duration * 0.9;
      run.previous = sample;
      if (now() - run.lastSaved > 30000) this.save(run);
    },
    save(run) {
      if (!run || run.record.watchedMs < 1000) return;
      const journal = this.read(run.ctx);
      write(run.ctx, "journal", {
        ...journal,
        sessions: mergeWatchSessions(journal.sessions, [{ ...run.record }])
      });
      run.lastSaved = now();
    },
    finish(run) {
      this.save(run);
      if (run) void this.sync(run.ctx).catch(() => {});
    },
    async sync(ctx = context()) {
      if (this.pending.has(ctx.scope)) return this.pending.get(ctx.scope);
      const work = (async () => {
        const id = await request(() => spaceId(ctx));
        if (!id) return { configured: false, ok: true };
        const journal = this.read(ctx);
        const device = ctx.space.deviceId || "vidaa-local";
        const pushed = await request(() =>
          cloud.putDoc(id, ctx.statsKey, device, {
            version: 1,
            device,
            deviceName: ctx.space.deviceName || "TV",
            updatedAtEpochMs: now(),
            sessions: journal.sessions.filter((s) => s.deviceId === device),
            facts: journal.facts
          })
        );
        const docs = await request(() => cloud.getDocs(id, ctx.statsKey));
        if (!docs) return { configured: true, ok: false };
        const latest = this.read(ctx);
        const peers = Object.entries(docs).filter(
          ([key, doc]) => key !== device && doc?.version === 1
        );
        const facts = { ...latest.facts };
        peers.forEach(([, doc]) => {
          for (const [key, fact] of Object.entries(doc.facts || {})) {
            if ((fact?.fetchedAtEpochMs || 0) > (facts[key]?.fetchedAtEpochMs || 0))
              facts[key] = fact;
          }
        });
        write(ctx, "journal", {
          ...latest,
          facts,
          sessions: mergeWatchSessions(
            latest.sessions,
            ...peers.map(([peerDevice, doc]) =>
              (Array.isArray(doc.sessions) ? doc.sessions : []).map((session) => ({
                ...session,
                deviceId: session.deviceId || peerDevice,
                deviceName: doc.deviceName || session.deviceName
              }))
            )
          )
        });
        return { configured: true, ok: pushed, devices: peers.length + 1 };
      })();
      this.pending.set(ctx.scope, work);
      try {
        return await work;
      } catch (_) {
        return { configured: Boolean(ctx.space.spaceCode), ok: false };
      } finally {
        if (this.pending.get(ctx.scope) === work) this.pending.delete(ctx.scope);
      }
    }
  };
}

export const WatchJournal = createWatchJournal();
