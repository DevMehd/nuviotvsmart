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
  profileIndex = () => 1
} = {}) {
  let pushTimer = null;
  const listeners = new Set();

  const cacheKey = () => `persoRatings_${profileIndex()}`;
  const docKey = () => `ratings:${profileIndex()}`;
  const all = () => store.get(cacheKey(), null) || {};
  const save = (next) => {
    store.set(cacheKey(), next);
    listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (_error) {
        // Listener errors never break rating.
      }
    });
  };

  async function spaceId() {
    const config = space.get();
    if (!config.spaceCode || !cloud.available) return null;
    return cloud.spaceId(config.spaceCode, "space", {
      name: config.deviceName || "TV",
      device: "vidaa"
    });
  }

  async function push() {
    const id = await spaceId();
    if (!id) return false;
    return cloud.putDoc(id, docKey(), space.get().deviceId || "vidaa", all());
  }

  return {
    all,
    valueOf(type, id) {
      return activeValue(all()[`${type}:${id}`]);
    },
    rate(type, id, name, poster, value) {
      const key = `${type}:${id}`;
      save({ ...all(), [key]: makeStamp(value, name, poster, now()) });
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        push().catch(() => {});
      }, 3000);
    },
    async pull() {
      const id = await spaceId();
      if (!id) return false;
      const docs = await cloud.getDocs(id, docKey());
      if (!docs) return false;
      let merged = all();
      for (const payload of Object.values(docs)) merged = mergeRatings(merged, payload);
      save(merged);
      return true;
    },
    async recommendations() {
      const id = await spaceId();
      if (!id) return [];
      const docs = await cloud.getDocs(id, `reco:${profileIndex()}`);
      const latest = pickLatestReco(docs || {});
      const rated = all();
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
