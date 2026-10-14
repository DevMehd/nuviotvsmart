// Live channels of the personal features (hand-off, remote), mirror of Android PersoChannels.kt.
// Primary path: the Nuvio Perso backend (members only). Fallback: the public ntfy topic
// derived from the code, used when the backend refuses or cannot be reached; the backend is
// tried again on every reconnect, every code change and every few minutes.
import { PersoCloud } from "./persoCloud.js";

export const BACKEND_RETRY_MS = 5 * 60 * 1000;

const channels = new Map();
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(PersoChannels.status());
    } catch (_error) {
      // Listeners are UI refreshes.
    }
  });
}

/** Inner message of an ntfy SSE "message" event, or null. */
export function ntfyMessageText(rawData) {
  let event;
  try {
    event = JSON.parse(rawData);
  } catch (_error) {
    return null;
  }
  if (!event || event.event !== "message" || typeof event.message !== "string") return null;
  return event.message;
}

export function createPersoChannels(deps = {}) {
  const cloud = deps.cloud || PersoCloud;
  const EventSourceImpl = deps.EventSource || (typeof EventSource !== "undefined" ? EventSource : null);
  const fetchImpl = deps.fetch || ((...args) => fetch(...args));
  const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || ((id) => clearTimeout(id));
  const onChange = deps.onChange || notify;
  const registry = deps.registry || channels;

  async function tryBackend(entry) {
    if (!cloud.available) return false;
    const id = await cloud.spaceId(entry.code, "space", entry.member);
    const token = id ? await cloud.accessToken() : null;
    if (entry.closed || !id || !token) return false;
    entry.handle?.close();
    entry.mode = "cloud";
    entry.connected = false;
    entry.handle = cloud.subscribe({
      spaceId: id,
      kind: entry.kind,
      token,
      onEvent: (event) => entry.onMessage(event.payload),
      onConnection: (connected) => {
        entry.connected = connected;
        onChange();
        entry.onConnection?.(connected);
      }
    });
    onChange();
    return true;
  }

  function openNtfy(entry) {
    entry.handle?.close();
    entry.mode = "ntfy";
    entry.connected = false;
    if (!EventSourceImpl) {
      entry.handle = null;
      onChange();
      return;
    }
    const source = new EventSourceImpl(`${entry.server.replace(/\/+$/, "")}/${entry.ntfyTopic}/sse`);
    source.onopen = () => {
      entry.connected = true;
      onChange();
      entry.onConnection?.(true);
    };
    source.onerror = () => {
      entry.connected = false;
      onChange();
    };
    source.onmessage = (event) => {
      const text = ntfyMessageText(event.data);
      if (text) entry.onMessage(text);
    };
    entry.handle = { close: () => source.close() };
    // Keep trying the secure backend: switch as soon as it accepts us.
    entry.retryTimer = setTimer(async function again() {
      entry.retryTimer = null;
      if (entry.closed || entry.mode !== "ntfy") return;
      if (!(await tryBackend(entry)) && !entry.closed) entry.retryTimer = setTimer(again, BACKEND_RETRY_MS);
    }, BACKEND_RETRY_MS);
    onChange();
  }

  return {
    /** Opens [channel]; [onMessage] receives the JSON text of each message. */
    async connect({ channel, kind, code, ntfyTopic, server, member, onMessage, onConnection }) {
      this.disconnect(channel);
      const entry = { channel, kind, code, ntfyTopic, server, member, onMessage, onConnection, mode: "connecting", connected: false, closed: false, handle: null, retryTimer: null };
      registry.set(channel, entry);
      onChange();
      if (!(await tryBackend(entry)) && !entry.closed) openNtfy(entry);
      return entry.mode;
    },
    disconnect(channel) {
      const entry = registry.get(channel);
      if (!entry) return;
      entry.closed = true;
      if (entry.retryTimer) clearTimer(entry.retryTimer);
      entry.handle?.close();
      registry.delete(channel);
      onChange();
    },
    /** Backend first, ntfy topic when the backend refuses. Resolves to "cloud" or "ntfy". */
    async publish({ kind, code, ntfyTopic, server, member, payload }) {
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      if (cloud.available) {
        const id = await cloud.spaceId(code, "space", member);
        if (id && await cloud.sendEvent(id, kind, text)) return "cloud";
      }
      try {
        await fetchImpl(`${server.replace(/\/+$/, "")}/${ntfyTopic}`, { method: "POST", body: text });
      } catch (_error) {
        // Best effort, like Android.
      }
      return "ntfy";
    },
    mode(channel) {
      return registry.get(channel)?.mode || null;
    }
  };
}

export const PersoChannels = {
  ...createPersoChannels(),
  /** "cloud" when a channel is on the secure backend, "ntfy" when one fell back, else null. */
  status() {
    const modes = Array.from(channels.values()).map((entry) => entry.mode);
    if (modes.includes("cloud")) return "cloud";
    if (modes.includes("ntfy")) return "ntfy";
    if (modes.includes("connecting")) return "connecting";
    return null;
  },
  onStatusChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
