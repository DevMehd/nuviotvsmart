// Client of the Nuvio Perso backend (Supabase, schema in the mobile repo
// backend/supabase/schema.sql), mirror of Android PersoCloud.kt / PersoRealtime.android.kt.
// Anonymous device account, spaces joined by secret code, live events over Realtime.
// Every call resolves to null/false when the backend is unreachable so callers can fall back.

export const PERSO_BACKEND = {
  url: "https://iaidimkqmoqilpnptpoq.supabase.co",
  key: "sb_publishable_z_ayBKKFa-9STCYXyp5ciA_juzMxcYV"
};

const SESSION_KEY = "nuvio.perso.cloud_session";
const SPACES_KEY = "nuvio.perso.cloud_spaces";

function defaultStorage() {
  return {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_error) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch (_error) {
        // Private mode or quota: the session simply is not kept.
      }
    }
  };
}

/** Realtime record (perso_events row) → event, or null. */
export function parseRealtimeMessage(text, topic) {
  let message;
  try {
    message = typeof text === "string" ? JSON.parse(text) : text;
  } catch (_error) {
    return null;
  }
  if (!message || message.event !== "postgres_changes") return null;
  if (topic && message.topic && message.topic !== topic) return null;
  const record = message.payload?.data?.record;
  if (!record || typeof record !== "object") return null;
  return eventFromRow(record);
}

export function eventFromRow(row) {
  return {
    id: Number(row.id || 0),
    kind: String(row.kind || ""),
    payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload ?? null),
    sender: String(row.sender || "")
  };
}

export function realtimeJoinMessage(topic, spaceId, token, ref = "1") {
  return {
    topic,
    event: "phx_join",
    ref,
    payload: {
      config: {
        postgres_changes: [
          {
            event: "INSERT",
            schema: "public",
            table: "perso_events",
            filter: `space_id=eq.${spaceId}`
          }
        ]
      },
      access_token: token
    }
  };
}

export function createPersoCloud(options = {}) {
  const url = String(options.url ?? PERSO_BACKEND.url).replace(/\/+$/, "");
  const key = String(options.key ?? PERSO_BACKEND.key);
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  const storage = options.storage || defaultStorage();
  const now = options.now || (() => Date.now());
  const WebSocketImpl = options.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || ((id) => clearTimeout(id));
  const setRepeat = options.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clearRepeat = options.clearInterval || ((id) => clearInterval(id));

  let session = storage.get(SESSION_KEY);
  let spaces = storage.get(SPACES_KEY) || {};
  let pendingToken = null;
  /** Last failure reason, for the settings screen ("anonymous_provider_disabled"…). */
  let lastError = "";

  const available = url.startsWith("https://") && Boolean(key);

  async function request(path, init = {}, token = null) {
    const headers = { apikey: key, "Content-Type": "application/json", ...(init.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetchImpl(`${url}${path}`, { ...init, headers });
  }

  async function readSession(response) {
    if (!response || !response.ok) {
      try {
        const body = await response.json();
        lastError = String(body?.error_code || body?.code || response.status);
      } catch (_error) {
        lastError = String(response?.status || "network");
      }
      return null;
    }
    const body = await response.json();
    if (!body?.access_token || !body?.refresh_token || !body?.user?.id) return null;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAtMs: now() + Number(body.expires_in || 3600) * 1000,
      userId: body.user.id
    };
  }

  async function signUp() {
    try {
      return await readSession(
        await request("/auth/v1/signup", {
          method: "POST",
          body: JSON.stringify({ data: { app: "nuvio-perso" } })
        })
      );
    } catch (_error) {
      lastError = "network";
      return null;
    }
  }

  async function refresh(refreshToken) {
    try {
      return await readSession(
        await request("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken })
        })
      );
    } catch (_error) {
      lastError = "network";
      return null;
    }
  }

  async function accessToken() {
    if (!available) return null;
    if (session && session.expiresAtMs - now() > 60000) return session.accessToken;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const next = (session ? await refresh(session.refreshToken) : null) || (await signUp());
      session = next;
      storage.set(SESSION_KEY, next);
      return next?.accessToken || null;
    })();
    try {
      return await pendingToken;
    } finally {
      pendingToken = null;
    }
  }

  function normalizeCode(code) {
    return String(code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  async function spaceId(code, kind, member = {}) {
    const normalized = normalizeCode(code);
    if (normalized.length < 10 || normalized.length > 16) return null;
    const token = await accessToken();
    if (!token) return null;
    // Keyed by account too: a new session must join again.
    const cacheKey = `${url}|${session?.userId}|${kind}|${normalized}`;
    if (spaces[cacheKey]) return spaces[cacheKey];
    try {
      const response = await request(
        "/rest/v1/rpc/join_space",
        {
          method: "POST",
          body: JSON.stringify({
            code: normalized,
            kind,
            member_name: member.name || "TV",
            member_device: member.device || "vidaa"
          })
        },
        token
      );
      if (!response.ok) {
        lastError = `join_${response.status}`;
        return null;
      }
      const id = await response.json();
      if (typeof id !== "string" || !id) return null;
      spaces = { ...spaces, [cacheKey]: id };
      storage.set(SPACES_KEY, spaces);
      return id;
    } catch (_error) {
      lastError = "network";
      return null;
    }
  }

  async function sendEvent(id, kind, payload) {
    const token = await accessToken();
    if (!token || !id) return false;
    let body;
    try {
      body = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (_error) {
      return false;
    }
    try {
      const response = await request(
        "/rest/v1/perso_events",
        {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ space_id: id, kind, payload: body, sender: session?.userId || "" })
        },
        token
      );
      return Boolean(response.ok);
    } catch (_error) {
      return false;
    }
  }

  async function events(id, kind, afterId = 0, limit = 200) {
    const token = await accessToken();
    if (!token || !id) return null;
    const query = `?space_id=eq.${encodeURIComponent(id)}&kind=eq.${encodeURIComponent(kind)}&id=gt.${Number(afterId) || 0}&order=id.asc&limit=${limit}&select=id,kind,payload,sender`;
    try {
      const response = await request(`/rest/v1/perso_events${query}`, {}, token);
      if (!response.ok) return null;
      return (await response.json()).map(eventFromRow);
    } catch (_error) {
      return null;
    }
  }

  function realtimeUrl() {
    return `${url.replace(/^https:\/\//, "wss://")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
  }

  /** Live inserts of perso_events for one space and kind. Returns { close }. */
  function subscribe({ spaceId: id, kind, token, onEvent, onConnection }) {
    if (!WebSocketImpl) {
      onConnection?.(false);
      return { close() {} };
    }
    const topic = `realtime:perso-${id}-${kind}`;
    let closed = false;
    let socket = null;
    let heartbeat = null;
    let retryTimer = null;
    let attempt = 0;
    let ref = 0;

    function open(currentToken) {
      if (closed) return;
      socket = new WebSocketImpl(realtimeUrl());
      socket.onopen = () => {
        socket.send(JSON.stringify(realtimeJoinMessage(topic, id, currentToken, String(++ref))));
        heartbeat = setRepeat(() => {
          try {
            socket.send(
              JSON.stringify({
                topic: "phoenix",
                event: "heartbeat",
                payload: {},
                ref: String(++ref)
              })
            );
          } catch (_error) {
            // The close handler reconnects.
          }
        }, 25000);
      };
      socket.onmessage = (message) => {
        let parsed;
        try {
          parsed = JSON.parse(message.data);
        } catch (_error) {
          return;
        }
        if (parsed?.event === "phx_reply" && parsed.topic === topic) {
          const ok = parsed.payload?.status === "ok";
          if (ok) attempt = 0;
          onConnection?.(ok);
          return;
        }
        const event = parseRealtimeMessage(parsed, topic);
        if (event && event.kind === kind) onEvent(event);
      };
      socket.onclose = () => retry();
      socket.onerror = () => {
        try {
          socket.close();
        } catch (_error) {
          retry();
        }
      };
    }

    function retry() {
      if (heartbeat) clearRepeat(heartbeat);
      heartbeat = null;
      if (closed || retryTimer) return;
      onConnection?.(false);
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
      attempt += 1;
      retryTimer = setTimer(async () => {
        retryTimer = null;
        // The token may have expired while disconnected.
        const fresh = (await accessToken()) || token;
        open(fresh);
      }, delay);
    }

    open(token);
    return {
      close() {
        closed = true;
        if (heartbeat) clearRepeat(heartbeat);
        if (retryTimer) clearTimer(retryTimer);
        try {
          socket?.close();
        } catch (_error) {
          // Already closed.
        }
      }
    };
  }

  return {
    get available() {
      return available;
    },
    get userId() {
      return session?.userId || null;
    },
    get lastError() {
      return lastError;
    },
    accessToken,
    spaceId,
    sendEvent,
    events,
    subscribe,
    realtimeUrl,
    resetSession() {
      session = null;
      spaces = {};
      storage.set(SESSION_KEY, null);
      storage.set(SPACES_KEY, null);
    }
  };
}

export const PersoCloud = createPersoCloud();
