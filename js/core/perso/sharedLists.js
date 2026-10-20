// Wire v1 mirrors mobile SharedListModels.kt / SharedLists.kt. Invitations stay
// inside the personal-space index; list copies/events use their own list scope.
import { PersoCloud } from "./persoCloud.js";
import { PersoSpace, randomPersoCode } from "./persoSpace.js";
import {
  personalContext,
  personalSpaceId,
  readPersonal,
  writePersonal,
  safeArtwork
} from "./personalContext.js";

const STORAGE_KEY = "shared-lists";
const stamp = (value) => (Number.isSafeInteger(Number(value)) ? Math.max(0, Number(value)) : 0);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const codeOf = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const validCode = (value) => /^[A-Z0-9]{10}$/.test(value);
const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined);

function normalizeItem(value) {
  if (!value || typeof value !== "object" || !value.id || !value.type) return null;
  const likes = Object.fromEntries(
    Object.entries(object(value.likes)).filter(([, n]) => Number.isSafeInteger(n))
  );
  const ratings = Object.fromEntries(
    Object.entries(object(value.ratings))
      .filter(([, r]) => r && (r.v == null || (Number.isInteger(r.v) && r.v >= -2 && r.v <= 2)))
      .map(([id, r]) => [id, { v: r.v ?? null, at: stamp(r.at) }])
  );
  return {
    type: String(value.type),
    id: String(value.id),
    name: String(value.name || ""),
    poster: safeArtwork(value.poster) || null,
    year: value.year == null ? null : String(value.year),
    addedBy: String(value.addedBy || ""),
    addedById: String(value.addedById || ""),
    addedAt: stamp(value.addedAt),
    removedAt: stamp(value.removedAt),
    watchedAt: stamp(value.watchedAt),
    unwatchedAt: stamp(value.unwatchedAt),
    likes,
    ratings
  };
}
export function mergeSharedListItem(a, b) {
  const newer = b.addedAt > a.addedAt ? b : a;
  return {
    ...newer,
    addedAt: Math.max(a.addedAt, b.addedAt),
    removedAt: Math.max(a.removedAt, b.removedAt),
    watchedAt: Math.max(a.watchedAt, b.watchedAt),
    unwatchedAt: Math.max(a.unwatchedAt, b.unwatchedAt),
    likes: Object.fromEntries(
      [...new Set([...Object.keys(a.likes), ...Object.keys(b.likes)])].map((id) => {
        const x = own(a.likes, id) || 0,
          y = own(b.likes, id) || 0;
        return [id, Math.abs(y) > Math.abs(x) ? y : x];
      })
    ),
    ratings: Object.fromEntries(
      [...new Set([...Object.keys(a.ratings), ...Object.keys(b.ratings)])].map((id) => {
        const x = own(a.ratings, id),
          y = own(b.ratings, id);
        return [id, !x || (y && y.at > x.at) ? y : x];
      })
    )
  };
}
function normalizeList(value, code) {
  if (!value || typeof value !== "object" || codeOf(value.code) !== code) return null;
  const items = {};
  for (const valueItem of Object.values(object(value.items))) {
    const item = normalizeItem(valueItem);
    if (item) items[`${item.type}:${item.id}`] = item;
  }
  return {
    code,
    name: String(value.name || "À regarder ensemble"),
    nameAt: stamp(value.nameAt),
    createdAt: stamp(value.createdAt),
    items,
    members: Object.fromEntries(
      Object.entries(object(value.members))
        .filter(([, m]) => m && typeof m === "object")
        .map(([id, m]) => [
          id,
          {
            id,
            name: String(m.name || "?"),
            device: String(m.device || ""),
            lastSeenMs: stamp(m.lastSeenMs)
          }
        ])
    ),
    // Credentials in imported documents are never accepted or redistributed.
    cloudUrl: "",
    cloudKey: "",
    lastSnapshotAt: stamp(value.lastSnapshotAt),
    lastEventId: stamp(value.lastEventId)
  };
}
export function mergeSharedList(a, b) {
  const named = b.nameAt > a.nameAt ? b : a;
  const items = { ...a.items };
  for (const [key, item] of Object.entries(b.items))
    items[key] = own(items, key) ? mergeSharedListItem(items[key], item) : item;
  const dates = [a.createdAt, b.createdAt].filter((n) => n > 0);
  return {
    ...a,
    name: named.name,
    nameAt: named.nameAt,
    createdAt: dates.length ? Math.min(...dates) : 0,
    items,
    members: Object.fromEntries(
      [...new Set([...Object.keys(a.members), ...Object.keys(b.members)])].map((id) => {
        const x = own(a.members, id),
          y = own(b.members, id);
        return [id, !x || (y && y.lastSeenMs > x.lastSeenMs) ? y : x];
      })
    )
  };
}
export const visibleSharedListItems = (list) =>
  Object.values(list?.items || {}).filter((i) => i.addedAt > i.removedAt);
export function sharedListConsensus(item) {
  const ratings = Object.values(item.ratings || {})
    .map((r) => r.v)
    .filter((v) => v != null);
  const mean = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  return (
    mean -
    (ratings.some((v) => v <= -2) ? 2 : 0) +
    0.25 * Object.values(item.likes || {}).filter((v) => v > 0).length
  );
}

export function createSharedLists(deps = {}) {
  const cloud = deps.cloud || PersoCloud;
  const context = deps.context || personalContext;
  const read = deps.read || readPersonal,
    write = deps.write || writePersonal;
  const spaceId = deps.spaceId || personalSpaceId;
  const now = deps.now || Date.now;
  const randomCode = deps.randomCode || (() => randomPersoCode(10));
  const setTimer = deps.setTimeout || setTimeout,
    clearTimer = deps.clearTimeout || clearTimeout;
  const inflight = new Map(),
    timers = new Map();
  function state(ctx) {
    const saved = read(ctx, STORAGE_KEY, {}) || {};
    const lists = Object.fromEntries(
      Object.entries(object(saved.lists))
        .filter(([code]) => validCode(code))
        .map(([code, value]) => [code, normalizeList(value, code)])
        .filter(([, value]) => value)
    );
    return { lists, outbox: object(saved.outbox), revision: stamp(saved.revision) };
  }
  function save(ctx, next) {
    write(ctx, STORAGE_KEY, next);
  }
  function myId(ctx) {
    if (ctx.space.deviceId) return ctx.space.deviceId;
    // Initialize the device identity without changing its personal-space code.
    const id = deps.deviceId ? deps.deviceId() : PersoSpace.set({}).deviceId;
    ctx.space = { ...ctx.space, deviceId: id };
    return id;
  }
  function member(ctx, at) {
    return {
      id: myId(ctx),
      name: ctx.name || ctx.space.deviceName || "TV",
      device: "vidaa",
      lastSeenMs: at
    };
  }
  function schedule(ctx, delay = 250) {
    if (timers.has(ctx.scope)) clearTimer(timers.get(ctx.scope));
    const timer = setTimer(() => {
      timers.delete(ctx.scope);
      void api.sync(ctx);
    }, delay);
    timer?.unref?.();
    timers.set(ctx.scope, timer);
  }
  function enqueue(ctx, code, list, message) {
    const current = state(ctx),
      revision = current.revision + 1;
    const queue = own(current.outbox, code) || { events: {} };
    const key = message.type === "op" ? `${message.item.type}:${message.item.id}` : "hello";
    save(ctx, {
      ...current,
      revision,
      lists: { ...current.lists, [code]: list },
      outbox: {
        ...current.outbox,
        [code]: { revision, events: { ...queue.events, [key]: { revision, payload: message } } }
      }
    });
    schedule(ctx);
  }
  function message(ctx, at, extra) {
    const me = member(ctx, at);
    return { v: 1, from: me.id, name: me.name, device: me.device, at, ...extra };
  }
  function fresh(code, name, at = 0) {
    return normalizeList({ code, name, nameAt: at, createdAt: at }, code);
  }
  function applyEvent(list, event) {
    let msg;
    try {
      msg = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    } catch (_) {
      return list;
    }
    if (!msg || (msg.v ?? 1) !== 1 || !["hello", "op", "snap"].includes(msg.type)) return list;
    const incoming = fresh(list.code, msg.listName || list.name, stamp(msg.nameAt));
    incoming.createdAt = 0;
    for (const raw of [msg.item, ...(Array.isArray(msg.items) ? msg.items : [])]) {
      const item = normalizeItem(raw);
      if (item) incoming.items[`${item.type}:${item.id}`] = item;
    }
    if (typeof msg.from === "string" && msg.from)
      incoming.members = {
        [msg.from]: {
          id: msg.from,
          name: String(msg.name || list.members[msg.from]?.name || "?"),
          device: String(msg.device || ""),
          lastSeenMs: stamp(msg.at)
        }
      };
    const merged = mergeSharedList(list, incoming);
    if (msg.type === "snap") merged.lastSnapshotAt = Math.max(list.lastSnapshotAt, stamp(msg.at));
    return merged;
  }
  async function syncList(code, ctx) {
    const id = await cloud.spaceId(code, "list", { name: ctx.name || "TV", device: "vidaa" });
    if (!id) return false;
    const docs = await cloud.getDocs(id, "list");
    if (!docs) return false;
    let current = state(ctx),
      list = current.lists[code];
    if (!list) return true;
    for (const raw of Object.values(docs)) {
      const peer = normalizeList(raw, code);
      if (peer) list = mergeSharedList(list, peer);
    }
    save(ctx, { ...current, lists: { ...current.lists, [code]: list } });
    let eventsOk = true;
    // Bounded batches: repeated refreshes resume at the persisted cursor.
    for (let page = 0; page < 3; page++) {
      const after = state(ctx).lists[code].lastEventId;
      const batch = await cloud.events(id, "list", after, 200);
      if (!batch) {
        eventsOk = false;
        break;
      }
      current = state(ctx);
      list = current.lists[code];
      for (const event of batch) {
        list = applyEvent(list, event);
        list.lastEventId = Math.max(list.lastEventId, stamp(event.id));
      }
      save(ctx, { ...current, lists: { ...current.lists, [code]: list } });
      if (batch.length < 200 || list.lastEventId <= after) break;
    }
    current = state(ctx);
    list = current.lists[code];
    const queue = own(current.outbox, code);
    const pushed = await cloud.putDoc(id, "list", myId(ctx), {
      ...list,
      lastSnapshotAt: 0,
      lastEventId: 0
    });
    if (!pushed) return false;
    let sent = true;
    for (const [key, entry] of Object.entries(queue?.events || {})) {
      const ok = await cloud.sendEvent(id, "list", entry.payload);
      sent &&= ok;
      if (ok) {
        const latest = state(ctx),
          pending = own(latest.outbox, code);
        if (pending?.events?.[key]?.revision === entry.revision) {
          const events = { ...pending.events };
          delete events[key];
          save(ctx, { ...latest, outbox: { ...latest.outbox, [code]: { ...pending, events } } });
        }
      }
    }
    const latest = state(ctx);
    if (
      queue &&
      latest.outbox[code]?.revision === queue.revision &&
      !Object.keys(latest.outbox[code].events).length
    ) {
      const outbox = { ...latest.outbox };
      delete outbox[code];
      save(ctx, { ...latest, outbox });
    }
    return sent && eventsOk;
  }
  const api = {
    all(ctx = context()) {
      return state(ctx).lists;
    },
    myId(ctx = context()) {
      return myId(ctx);
    },
    visibleItems: visibleSharedListItems,
    consensus: sharedListConsensus,
    likedTitles(ctx = context()) {
      const id = myId(ctx),
        titles = new Map();
      for (const list of Object.values(state(ctx).lists))
        for (const item of visibleSharedListItems(list)) {
          if ((item.likes[id] || 0) > 0) titles.set(`${item.type}:${item.id}`, item);
        }
      return [...titles.values()];
    },
    create(name, ctx = context()) {
      let code;
      for (let n = 0; n < 20; n++) {
        code = randomCode();
        if (validCode(code) && !state(ctx).lists[code]) break;
        code = null;
      }
      if (!code) return null;
      const at = now(),
        list = fresh(code, String(name || "").trim() || "À regarder ensemble", at);
      list.members = { [myId(ctx)]: member(ctx, at) };
      enqueue(
        ctx,
        code,
        list,
        message(ctx, at, { type: "hello", listName: list.name, nameAt: at })
      );
      return code;
    },
    join(value, ctx = context()) {
      const code = codeOf(value);
      if (!validCode(code)) return null;
      const at = now(),
        list = state(ctx).lists[code] || fresh(code, "À regarder ensemble");
      list.members = { ...list.members, [myId(ctx)]: member(ctx, at) };
      enqueue(ctx, code, list, message(ctx, at, { type: "hello" }));
      return code;
    },
    mutate(valueCode, key, action, value, ctx = context()) {
      const code = codeOf(valueCode),
        list = state(ctx).lists[code];
      if (!list || !["like", "watched", "rating", "remove", "add"].includes(action)) return false;
      const old = own(list.items, key);
      let item = old;
      if (action === "add") {
        const candidate = normalizeItem(value);
        if (!candidate || `${candidate.type}:${candidate.id}` !== key) return false;
        item = old || candidate;
      }
      if (!item) return false;
      if (
        action === "rating" &&
        value !== null &&
        (!Number.isInteger(value) || value < -2 || value > 2)
      )
        return false;
      if (["like", "watched"].includes(action) && typeof value !== "boolean") return false;
      const id = myId(ctx);
      const at = Math.max(
        now(),
        item.addedAt + 1,
        item.removedAt + 1,
        item.watchedAt + 1,
        item.unwatchedAt + 1,
        Math.abs(item.likes[id] || 0) + 1,
        (item.ratings[id]?.at || 0) + 1
      );
      item = { ...item };
      if (action === "add")
        item = {
          ...item,
          name: String(value.name || item.name),
          poster: safeArtwork(value.poster) || item.poster,
          year: value.year == null ? item.year : String(value.year),
          addedBy: ctx.name || "TV",
          addedById: id,
          addedAt: at
        };
      if (action === "remove") item.removedAt = at;
      if (action === "watched") item[value ? "watchedAt" : "unwatchedAt"] = at;
      if (action === "like") item.likes = { ...item.likes, [id]: value ? at : -at };
      if (action === "rating") item.ratings = { ...item.ratings, [id]: { v: value, at } };
      const next = {
        ...list,
        items: { ...list.items, [key]: item },
        members: { ...list.members, [id]: member(ctx, at) }
      };
      enqueue(ctx, code, next, message(ctx, at, { type: "op", item }));
      return true;
    },
    async sync(ctx = context()) {
      if (inflight.has(ctx.scope)) return inflight.get(ctx.scope);
      if (timers.has(ctx.scope)) {
        clearTimer(timers.get(ctx.scope));
        timers.delete(ctx.scope);
      }
      const work = (async () => {
        if (!cloud.available) return { configured: false, ok: false };
        let ok = true;
        const personalId = await spaceId(ctx);
        if (ctx.space.spaceCode && !personalId) ok = false;
        if (personalId) {
          const docs = await cloud.getDocs(personalId, "lists-index");
          if (!docs) ok = false;
          else {
            const current = state(ctx),
              lists = { ...current.lists };
            for (const doc of Object.values(docs))
              for (const entry of Array.isArray(doc?.lists) ? doc.lists : []) {
                const code = codeOf(entry?.code);
                if (validCode(code) && !lists[code]) lists[code] = fresh(code, entry.name);
              }
            save(ctx, { ...current, lists });
          }
        }
        for (const code of Object.keys(state(ctx).lists)) {
          ok = (await syncList(code, ctx)) && ok;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (personalId) {
          const lists = Object.values(state(ctx).lists).map((list) => ({
            code: list.code,
            name: list.name,
            count: visibleSharedListItems(list).length
          }));
          ok = (await cloud.putDoc(personalId, "lists-index", myId(ctx), { lists })) && ok;
        }
        return {
          configured: Boolean(personalId),
          ok,
          pending: Object.keys(state(ctx).outbox).length
        };
      })().catch(() => ({ configured: Boolean(ctx.space.spaceCode), ok: false }));
      inflight.set(ctx.scope, work);
      try {
        const result = await work;
        if (!result.ok || Object.keys(state(ctx).outbox).length)
          schedule(ctx, result.ok ? 250 : 30000);
        return result;
      } finally {
        inflight.delete(ctx.scope);
      }
    },
    stop() {
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
    }
  };
  return api;
}
export const SharedLists = createSharedLists();
