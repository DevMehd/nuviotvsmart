// Personal 5-level ratings, shared with Android through the personal space
// (parite-plateformes.fr.md#nuv-035): document "ratings:<profileIndex>", one row per device,
// payload {"type:id": {value?, atMs, name, poster}}; the latest atMs wins per title,
// an absent value means the rating was removed.
import { LocalStore } from "../storage/localStore.js";
import { PersoSpace } from "./persoSpace.js";
import { PersoCloud } from "./persoCloud.js";

export const RATING_SCALE = [
  { value: -2, emoji: "👎👎", key: "perso_rating_hated", fallback: "Détesté" },
  { value: -1, emoji: "👎", key: "perso_rating_disliked", fallback: "Pas pour moi" },
  { value: 0, emoji: "😐", key: "perso_rating_okay", fallback: "Correct" },
  { value: 1, emoji: "👍", key: "perso_rating_liked", fallback: "J'aime" },
  { value: 2, emoji: "💜", key: "perso_rating_loved", fallback: "J'adore" }
];

export function ratingFor(value) {
  return RATING_SCALE.find((entry) => entry.value === value) || null;
}

/** Same rule as Android RatingMerge: the latest stamp wins for each title. */
export function mergeRatings(a = {}, b = {}) {
  const out = { ...a };
  for (const [key, stamp] of Object.entries(b || {})) {
    if (!stamp || typeof stamp !== "object") continue;
    const current = out[key];
    if (!current || Number(stamp.atMs || 0) > Number(current.atMs || 0)) out[key] = stamp;
  }
  return out;
}

/** Stamp as written to the document: value omitted when the rating is removed. */
export function makeStamp(value, name, poster, atMs) {
  const stamp = { atMs, name: String(name || "") };
  if (Number.isInteger(value) && value >= -2 && value <= 2) stamp.value = value;
  if (poster) stamp.poster = String(poster);
  return stamp;
}

export function activeValue(stamp) {
  return stamp && Number.isInteger(stamp.value) ? stamp.value : null;
}

/** Most recent "reco:<profile>" document of all devices (published by the phone). */
export function pickLatestReco(docs = {}) {
  let best = null;
  for (const payload of Object.values(docs || {})) {
    if (!payload || !Array.isArray(payload.forYou)) continue;
    if (!best || Number(payload.updatedAt || 0) > Number(best.updatedAt || 0)) best = payload;
  }
  return best;
}

export function createTitleRatings({
  store = LocalStore,
  space = PersoSpace,
  cloud = PersoCloud,
  now = () => Date.now(),
  profileIndex = () => 1,
  timeoutMs = 10000,
  pushDelayMs = 3000
} = {}) {
  const pushTimers = new Map();
  const pendingPulls = new Map();
  const timeout = async (callback) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(callback),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Rating synchronization timeout")), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const listeners = new Set();

  const capture = () => ({ profileIndex: profileIndex(), space: { ...space.get() } });
  const contextKey = (ctx) => `${ctx.space.spaceCode || ""}:${ctx.profileIndex}`;
  const sameSpace = (ctx) => ctx.space.spaceCode === space.get().spaceCode;
  const cacheKey = (ctx) => `persoRatings_${ctx?.profileIndex ?? profileIndex()}`;
  const docKey = (ctx) => `ratings:${ctx?.profileIndex ?? profileIndex()}`;
  const all = (ctx) => store.get(cacheKey(ctx), null) || {};
  const save = (next, ctx) => {
    store.set(cacheKey(ctx), next);
    if (ctx && (ctx.profileIndex !== profileIndex() || !sameSpace(ctx))) return;
    listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (_error) {
        // Listener errors never break rating.
      }
    });
  };

  async function spaceId(ctx) {
    const config = ctx?.space || space.get();
    if (!config.spaceCode || !cloud.available) return null;
    return timeout(() =>
      cloud.spaceId(config.spaceCode, "space", {
        name: config.deviceName || "TV",
        device: "vidaa"
      })
    );
  }

  async function push(ctx) {
    const id = await spaceId(ctx);
    if (!id || !sameSpace(ctx)) return false;
    return timeout(() => cloud.putDoc(id, docKey(ctx), ctx.space.deviceId || "vidaa", all(ctx)));
  }

  return {
    all,
    valueOf(type, id) {
      return activeValue(all()[`${type}:${id}`]);
    },
    rate(type, id, name, poster, value) {
      const ctx = capture();
      const key = `${type}:${id}`;
      save({ ...all(ctx), [key]: makeStamp(value, name, poster, now()) }, ctx);
      const timerKey = contextKey(ctx);
      clearTimeout(pushTimers.get(timerKey));
      pushTimers.set(
        timerKey,
        setTimeout(() => {
          pushTimers.delete(timerKey);
          push(ctx).catch(() => {});
        }, pushDelayMs)
      );
    },
    async pull(ctx = capture()) {
      const key = contextKey(ctx);
      if (pendingPulls.has(key)) return pendingPulls.get(key);
      const work = (async () => {
        try {
          const id = await spaceId(ctx);
          if (!id || !sameSpace(ctx)) return false;
          const docs = await timeout(() => cloud.getDocs(id, docKey(ctx)));
          if (!docs || !sameSpace(ctx)) return false;
          let merged = all(ctx);
          for (const payload of Object.values(docs)) merged = mergeRatings(merged, payload);
          save(merged, ctx);
          return true;
        } catch (_) {
          return false;
        }
      })();
      pendingPulls.set(key, work);
      try {
        return await work;
      } finally {
        pendingPulls.delete(key);
      }
    },
    async recommendations() {
      const ctx = capture();
      const id = await spaceId(ctx);
      if (!id) return [];
      const docs = await timeout(() => cloud.getDocs(id, `reco:${ctx.profileIndex}`));
      if (ctx.profileIndex !== profileIndex() || ctx.space.spaceCode !== space.get().spaceCode)
        return [];
      const latest = pickLatestReco(docs || {});
      const rated = all(ctx);
      return (latest?.forYou || []).filter(
        (title) => title && title.id && activeValue(rated[`${title.type}:${title.id}`]) == null
      );
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/** profileIndex of the active profile: profiles come from the same Nuvio account as Android. */
export function activeProfileIndex(store = LocalStore) {
  const activeId = String(store.get("activeProfileId", null) ?? "1");
  const profiles = store.get("profiles", null);
  if (Array.isArray(profiles)) {
    const match = profiles.find((profile) => String(profile?.id) === activeId);
    const index = Number(match?.profileIndex || match?.profile_index || 0);
    if (Number.isFinite(index) && index > 0) return Math.trunc(index);
  }
  const fallback = Number(activeId);
  return Number.isFinite(fallback) && fallback > 0 ? Math.trunc(fallback) : 1;
}

export const TitleRatings = createTitleRatings({ profileIndex: () => activeProfileIndex() });
