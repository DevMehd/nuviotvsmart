import { LocalStore } from "../storage/localStore.js";
import { PersoSpace, fnv1a64Hex } from "./persoSpace.js";
import { PersoCloud } from "./persoCloud.js";

// A context is captured before any async operation. Its scope also separates
// private spaces and accounts; a response never follows the current profile.
export function personalContext() {
  const id = String(LocalStore.get("activeProfileId", "1"));
  const profile = (LocalStore.get("profiles", []) || []).find((p) => String(p.id) === id) || {};
  const storedSpace = PersoSpace.get();
  const space = storedSpace.deviceId ? storedSpace : PersoSpace.set({});
  let account = "guest";
  try {
    const token = localStorage.getItem("access_token") || "";
    const part = token.split(".")[1] || "";
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    account = `${claims.iss || ""}|${claims.sub || "guest"}`;
  } catch (_) {
    /* No account in guest mode. */
  }
  const profileIndex = Number(profile.profileIndex || profile.profile_index || id) || 1;
  const name = String(profile.name || `profile-${profileIndex}`);
  return {
    id,
    profileIndex,
    name,
    space,
    scope: `${fnv1a64Hex(`${account}|${space.spaceCode}`)}:${profileIndex}`,
    statsKey: `stats:${name.trim().toLowerCase() || `profile-${profileIndex}`}`
  };
}

export function isCurrentContext(ctx) {
  return personalContext().scope === ctx.scope;
}
export function readPersonal(ctx, key, fallback = null) {
  return LocalStore.get(`perso.v1:${ctx.scope}:${key}`, fallback);
}
export function writePersonal(ctx, key, value) {
  LocalStore.set(`perso.v1:${ctx.scope}:${key}`, value);
}
export async function personalSpaceId(ctx) {
  if (!ctx.space.spaceCode || !PersoCloud.available) return null;
  return PersoCloud.spaceId(ctx.space.spaceCode, "space", {
    name: ctx.space.deviceName || "TV",
    device: "vidaa"
  });
}
export async function boundedMap(items, limit, callback, valid = () => true) {
  const out = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length && valid()) {
        const slot = index++;
        try {
          out[slot] = await callback(items[slot], slot);
        } catch (_) {
          out[slot] = null;
        }
        // Yield between requests so metadata completion cannot monopolise navigation.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })
  );
  return out.filter(Boolean);
}
export function safeArtwork(value) {
  const text = String(value || "");
  return /^(https?:\/\/|assets\/|\/assets\/)/i.test(text) ? text : "";
}
export function titleIdentity(item = {}) {
  return {
    type: String(item.type || item.contentType || item.parentMetaType || "movie"),
    id: String(item.id || item.contentId || item.parentMetaId || ""),
    name: String(item.name || item.title || ""),
    poster: safeArtwork(item.poster)
  };
}
