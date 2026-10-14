// Nuvio Perso backend client and channel routing (mirror of Android PersoCloud / PersoChannels).
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.document = { documentElement: {} };

const { createPersoCloud, parseRealtimeMessage, realtimeJoinMessage } = await import("../js/core/perso/persoCloud.js");
const { createPersoChannels, ntfyMessageText } = await import("../js/core/perso/persoChannels.js");

// ---- realtime records ----
const topic = "realtime:perso-s1-remote";
const record = { id: 7, space_id: "s1", kind: "remote", payload: { v: 1, type: "cmd", cmd: "ping" }, sender: "u2" };
const event = parseRealtimeMessage(JSON.stringify({ topic, event: "postgres_changes", payload: { data: { record } } }), topic);
assert.deepEqual(event, { id: 7, kind: "remote", payload: JSON.stringify(record.payload), sender: "u2" });
assert.equal(parseRealtimeMessage(JSON.stringify({ topic: "realtime:other", event: "postgres_changes", payload: { data: { record } } }), topic), null);
assert.equal(parseRealtimeMessage(JSON.stringify({ topic, event: "phx_reply", payload: { status: "ok" } }), topic), null);
assert.equal(parseRealtimeMessage("not json", topic), null);
const join = realtimeJoinMessage(topic, "s1", "tok", "1");
assert.equal(join.payload.access_token, "tok");
assert.equal(join.payload.config.postgres_changes[0].filter, "space_id=eq.s1");
assert.equal(join.payload.config.postgres_changes[0].table, "perso_events");

// ---- fake backend ----
function memoryStorage() {
  const data = {};
  return { data, get: (k) => (k in data ? JSON.parse(data[k]) : null), set: (k, v) => { if (v == null) delete data[k]; else data[k] = JSON.stringify(v); } };
}
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function fakeBackend({ anonymousEnabled = true } = {}) {
  const calls = [];
  let signups = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/auth/v1/signup")) {
      if (!anonymousEnabled) return response(422, { code: 422, error_code: "anonymous_provider_disabled" });
      signups += 1;
      return response(200, { access_token: `at${signups}`, refresh_token: `rt${signups}`, expires_in: 3600, user: { id: `user${signups}` } });
    }
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return response(200, { access_token: "at-refreshed", refresh_token: "rt-refreshed", expires_in: 3600, user: { id: "user1" } });
    }
    if (url.endsWith("/rest/v1/rpc/join_space")) return response(200, "space-uuid");
    if (url.endsWith("/rest/v1/perso_events")) return response(201, null);
    if (url.includes("/rest/v1/perso_events?")) return response(200, [record]);
    return response(200, null); // ntfy publish
  };
  return { fetch, calls, signups: () => signups };
}

let clock = 1_000_000;
const now = () => clock;

// Session: created once, cached, refreshed near expiry, kept in storage.
{
  const backend = fakeBackend();
  const storage = memoryStorage();
  const cloud = createPersoCloud({ url: "https://x.supabase.co", key: "pk", fetch: backend.fetch, storage, now });
  assert.equal(await cloud.accessToken(), "at1");
  assert.equal(await cloud.accessToken(), "at1", "cached");
  assert.equal(backend.signups(), 1);
  assert.equal(storage.get("nuvio.perso.cloud_session").userId, "user1");
  clock += 3_600_000;
  assert.equal(await cloud.accessToken(), "at-refreshed", "refreshed before expiry");

  const again = createPersoCloud({ url: "https://x.supabase.co", key: "pk", fetch: backend.fetch, storage, now });
  assert.equal(await again.accessToken(), "at-refreshed", "restored from storage");

  // join_space request shape and per-account cache.
  const id = await cloud.spaceId("abcd efgh jk23", "space", { name: "Salon", device: "vidaa" });
  assert.equal(id, "space-uuid");
  const joinCall = backend.calls.find((c) => c.url.endsWith("/rpc/join_space"));
  assert.deepEqual(joinCall.body, { code: "ABCDEFGHJK23", kind: "space", member_name: "Salon", member_device: "vidaa" });
  assert.equal(joinCall.init.headers.apikey, "pk");
  assert.equal(joinCall.init.headers.Authorization, "Bearer at-refreshed");
  await cloud.spaceId("ABCDEFGHJK23", "space");
  assert.equal(backend.calls.filter((c) => c.url.endsWith("/rpc/join_space")).length, 1, "join cached");
  assert.equal(await cloud.spaceId("SHORT", "space"), null, "invalid codes never reach the server");

  // Events.
  assert.equal(await cloud.sendEvent(id, "remote", JSON.stringify({ v: 1, type: "state" })), true);
  const insert = backend.calls.find((c) => c.url.endsWith("/rest/v1/perso_events"));
  assert.deepEqual(insert.body, { space_id: "space-uuid", kind: "remote", payload: { v: 1, type: "state" }, sender: "user1" });
  const list = await cloud.events(id, "remote", 3);
  assert.equal(list[0].id, 7);
  assert.ok(backend.calls.some((c) => c.url.includes("id=gt.3") && c.url.includes("kind=eq.remote")));
  assert.equal(cloud.realtimeUrl(), "wss://x.supabase.co/realtime/v1/websocket?apikey=pk&vsn=1.0.0");
}

// ---- channels: backend first, ntfy fallback ----
class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; FakeSocket.last = this; queueMicrotask(() => this.onopen?.()); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
class FakeEventSource {
  static last = null;
  constructor(url) { this.url = url; FakeEventSource.last = this; }
  close() { this.closed = true; }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const noTimers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };

{
  const backend = fakeBackend();
  const cloud = createPersoCloud({ url: "https://x.supabase.co", key: "pk", fetch: backend.fetch, storage: memoryStorage(), now, WebSocket: FakeSocket, ...noTimers });
  const channels = createPersoChannels({ cloud, EventSource: FakeEventSource, fetch: backend.fetch, onChange() {}, registry: new Map(), ...noTimers });
  const received = [];
  let connected = false;
  const mode = await channels.connect({
    channel: "remote", kind: "remote", code: "ABCDEFGHJK23", ntfyTopic: "nuvio-remote-v1-x", server: "https://ntfy.sh",
    onMessage: (text) => received.push(JSON.parse(text)), onConnection: (ok) => { connected = ok; }
  });
  assert.equal(mode, "cloud");
  await tick();
  const socket = FakeSocket.last;
  assert.equal(socket.sent[0].event, "phx_join");
  assert.equal(socket.sent[0].topic, "realtime:perso-space-uuid-remote");
  socket.receive({ topic: "realtime:perso-space-uuid-remote", event: "phx_reply", payload: { status: "ok" } });
  assert.equal(connected, true);
  socket.receive({ topic: "realtime:perso-space-uuid-remote", event: "postgres_changes", payload: { data: { record } } });
  socket.receive({ topic: "realtime:perso-space-uuid-remote", event: "postgres_changes", payload: { data: { record: { ...record, kind: "handoff" } } } });
  assert.deepEqual(received, [record.payload], "only this kind is delivered");
  assert.equal(await channels.publish({ kind: "remote", code: "ABCDEFGHJK23", ntfyTopic: "t", server: "https://ntfy.sh", payload: { v: 1 } }), "cloud");
  assert.equal(backend.calls.some((c) => c.url.startsWith("https://ntfy.sh")), false, "nothing leaks to ntfy while the backend works");
  channels.disconnect("remote");
  assert.equal(socket.closed, true);
}

{
  // Anonymous sign-ins disabled (422) → ntfy fallback, and a later retry is scheduled.
  const backend = fakeBackend({ anonymousEnabled: false });
  const cloud = createPersoCloud({ url: "https://x.supabase.co", key: "pk", fetch: backend.fetch, storage: memoryStorage(), now, WebSocket: FakeSocket, ...noTimers });
  const timers = [];
  const channels = createPersoChannels({ cloud, EventSource: FakeEventSource, fetch: backend.fetch, onChange() {}, registry: new Map(), setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  const received = [];
  const mode = await channels.connect({
    channel: "handoff", kind: "handoff", code: "ABCDEFGHJK23", ntfyTopic: "nuvio-handoff-v1-x", server: "https://ntfy.sh/",
    onMessage: (text) => received.push(text)
  });
  assert.equal(mode, "ntfy");
  assert.equal(cloud.lastError, "anonymous_provider_disabled");
  assert.equal(FakeEventSource.last.url, "https://ntfy.sh/nuvio-handoff-v1-x/sse");
  FakeEventSource.last.onmessage({ data: JSON.stringify({ event: "message", message: "{\"v\":1}" }) });
  assert.deepEqual(received, ["{\"v\":1}"]);
  assert.equal(timers.length, 1, "backend retried later");
  assert.equal(await channels.publish({ kind: "handoff", code: "ABCDEFGHJK23", ntfyTopic: "nuvio-handoff-v1-x", server: "https://ntfy.sh", payload: "{}" }), "ntfy");
  assert.ok(backend.calls.some((c) => c.url === "https://ntfy.sh/nuvio-handoff-v1-x"));
}

assert.equal(ntfyMessageText(JSON.stringify({ event: "keepalive" })), null);
assert.equal(ntfyMessageText(JSON.stringify({ event: "message", message: "x" })), "x");

console.log("perso cloud tests passed");
