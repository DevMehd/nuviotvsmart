import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  createAddonDataService,
  validateAddonRequest,
  compactAddonPayload
} from "../server/addonDataService.js";
import { createCatalogSnapshotStore } from "../js/data/local/catalogSnapshotStore.js";
import { BoundedMap } from "../js/core/storage/boundedMap.js";

const allowed = "https://xperience-app.com/config/catalog/movie/popular.json";
for (const url of [
  "http://xperience-app.com/catalog/movie/a.json",
  "https://xperience-app.com.evil.test/catalog/movie/a.json",
  "https://127.0.0.1/catalog/movie/a.json",
  "https://xperience-app.com:4433/catalog/movie/a.json",
  "https://user:secret@xperience-app.com/catalog/movie/a.json",
  "https://xperience-app.com/config/stream/movie/a.json"
]) {
  assert.equal(validateAddonRequest({ url, kind: "catalog" }), null, url);
}
assert.ok(validateAddonRequest({ url: allowed, kind: "catalog" }));
const upstream = {
  metas: [
    {
      id: "tt1",
      name: "Film",
      videos: Array(100).fill({ title: "Unused episode data" }),
      poster: "https://example.test/poster.webp"
    },
    null,
    { id: "tt1", name: "Duplicate" }
  ]
};
const compact = compactAddonPayload(upstream, "catalog");
assert.equal(compact.metas.length, 3, "pagination must count the original response");
assert.equal(compact.metas[0].videos, undefined);
assert.ok(JSON.stringify(compact).length < JSON.stringify(upstream).length / 5);

let calls = 0,
  clock = 1000;
const service = createAddonDataService({
  now: () => clock,
  fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    await new Promise((resolve) => setTimeout(resolve, 15));
    return new Response(JSON.stringify(upstream), {
      headers: { "Content-Type": "application/json" }
    });
  }
});
const request = async (body = { url: allowed, kind: "catalog", profile: "1" }, extra = {}) => {
  const headers = {};
  let response;
  await service(
    {
      method: "POST",
      headers: {
        host: "nuvio-vidaa.vercel.app",
        origin: "https://nuvio-vidaa.vercel.app",
        "content-type": "application/json"
      },
      body,
      ...extra
    },
    {
      setHeader: (k, v) => (headers[k] = v),
      set statusCode(v) {
        headers.status = v;
      },
      end: (text) => (response = text)
    }
  );
  return { headers, response };
};
const pair = await Promise.all([request(), request()]);
assert.equal(calls, 1, "collapse simultaneous identical upstream work");
assert.deepEqual(pair.map((r) => r.headers["X-Nuvio-Data-Cache"]).sort(), ["MISS", "SHARED"]);
assert.equal((await request()).headers["X-Nuvio-Data-Cache"], "HIT");
assert.equal((await request()).headers["Cache-Control"], "private, no-store");
await request({ url: allowed, kind: "catalog", profile: "2" });
assert.equal(calls, 2);
clock += 120001;
await request();
assert.equal(calls, 3);
assert.equal((await request({}, { method: "GET" })).headers.status, 405);
assert.equal(
  (await request({ url: "https://localhost/catalog/a/b.json", kind: "catalog" })).headers.status,
  400
);
assert.equal(
  (await request({}, { headers: { host: "nuvio-vidaa.vercel.app", origin: "https://evil.test" } }))
    .headers.status,
  403
);
assert.ok(!JSON.stringify(pair).includes("/config/"), "no private URL in response/headers");
const failing = createAddonDataService({
  fetchImpl: async () => {
    throw new Error(allowed);
  }
});
let safeError;
await failing(
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { url: allowed, kind: "catalog" }
  },
  { setHeader() {}, end: (s) => (safeError = s) }
);
assert.equal(safeError, '{"error":"addon_service_unavailable"}');

const memory = new Map();
const storage = {
  getItem: (k) => memory.get(k) || null,
  setItem: (k, v) => memory.set(k, v),
  removeItem: (k) => memory.delete(k)
};
const snapshots = createCatalogSnapshotStore(
  () => storage,
  () => clock
);
const row = {
  addonBaseUrl: "https://example.test/private",
  addonId: "addon",
  addonName: "Addon",
  apiType: "movie",
  items: [{ id: "tt1", name: "Film", addonBaseUrl: "https://example.test/private" }],
  nextSkip: 100
};
snapshots.put("profile1/configA", row);
snapshots.flush();
const restored = createCatalogSnapshotStore(
  () => storage,
  () => clock
);
assert.equal(restored.get("profile1/configA").items[0].addonBaseUrl, row.addonBaseUrl);
assert.equal(restored.get("profile1/configA").nextSkip, 100);
assert.equal(restored.get("profile2/configA"), null);
assert.equal(restored.get("profile1/configB"), null);
clock += 86400001;
assert.equal(restored.get("profile1/configA"), null);
const bounded = new BoundedMap(2);
bounded.set("a", 1).set("b", 2);
bounded.get("a");
bounded.set("c", 3);
assert.equal(bounded.has("b"), false);

// Real worker source: warm versioned scripts never hit fetch; HTML still does.
const handlers = {};
let fetches = 0;
let cachedResponse = { cached: true };
const ctx = {
  URL,
  Request,
  console,
  self: {
    location: { origin: "https://nuvio-vidaa.vercel.app" },
    addEventListener: (n, fn) => (handlers[n] = fn)
  },
  caches: { open: async () => ({ match: async () => cachedResponse, put: async () => {} }) },
  fetch: async () => {
    fetches++;
    return {
      ok: true,
      status: 200,
      clone() {
        return this;
      }
    };
  }
};
vm.runInNewContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), ctx);
async function swRequest(path, destination = "script") {
  let result;
  const event = {
    request: {
      method: "GET",
      url: `https://nuvio-vidaa.vercel.app${path}`,
      destination,
      headers: { get: () => null }
    },
    respondWith: (p) => (result = p),
    waitUntil() {}
  };
  handlers.fetch(event);
  return result ? await result : null;
}
assert.equal((await swRequest("/app.bundle.1234567890abcdef.js")).cached, true);
assert.equal(fetches, 0);
// VIDAA module chunks carry esbuild content hashes: cache first, no network per launch.
assert.equal((await swRequest("/m/metaDetailsScreen-ABCD2345.js")).cached, true);
assert.equal((await swRequest("/m/chunk-Z7QW3X4Y.js")).cached, true);
assert.equal(fetches, 0);
await swRequest("/vidaa.html", "document");
assert.equal(fetches, 1);
await swRequest("/api/addon-data", "empty");
assert.equal(fetches, 1);
cachedResponse = null;
await swRequest("/app.bundle.ffffffffffffffff.js");
assert.equal(fetches, 2);

// Hosted transport uses POST only, avoids direct work on hits, falls back and cancels.
globalThis.localStorage = storage;
globalThis.__NUVIO_ADDON_DATA_SERVICE__ = true;
const { requestAddonData } = await import("../js/core/network/vidaaAddonTransport.js");
let directCalls = 0;
const direct = async () => {
  directCalls++;
  return { metas: [] };
};
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/addon-data");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  return new Response('{"metas":[]}');
};
await requestAddonData(allowed, "catalog", {}, direct);
assert.equal(directCalls, 0);
globalThis.fetch = async (_url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
const start = Date.now();
await requestAddonData(allowed, "catalog", {}, direct);
assert.equal(directCalls, 1);
assert.ok(Date.now() - start < 1500);
const controller = new AbortController();
const aborted = requestAddonData(allowed, "catalog", { signal: controller.signal }, direct);
controller.abort();
await assert.rejects(aborted, { name: "AbortError" });
console.log(
  "PASS: private server cache, payload compaction, allowlist, pagination, profile snapshots, bounded cache, immutable shell and hedged transport"
);
