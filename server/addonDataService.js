import { createHash } from "node:crypto";

// Exact upstreams observed on the personal installation. Private configuration
// stays in POST bodies; this is not a general-purpose URL proxy.
export const ADDON_HOSTS = new Set(["xperience-app.com", "aiostreams.fortheweak.cloud"]);
const MAX_BODY_BYTES = 16384;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const CATALOG_FIELDS = [
  "id",
  "name",
  "type",
  "poster",
  "background",
  "logo",
  "description",
  "releaseInfo",
  "runtime",
  "genres"
];

export function validateAddonRequest(body) {
  if (
    !body ||
    !["catalog", "meta"].includes(body.kind) ||
    typeof body.url !== "string" ||
    body.url.length > 12000
  )
    return null;
  try {
    const url = new URL(body.url);
    if (
      url.protocol !== "https:" ||
      !ADDON_HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    if (!new RegExp(`/${body.kind}/[^/]+/[^/]+(?:/[^/]+)?\\.json$`).test(url.pathname)) return null;
    return { url: url.href, kind: body.kind, profile: String(body.profile || "1").slice(0, 80) };
  } catch {
    return null;
  }
}

export function compactAddonPayload(payload, kind) {
  if (kind === "meta") {
    if (!payload?.meta || typeof payload.meta !== "object") throw new Error("invalid_payload");
    return { meta: payload.meta };
  }
  if (!Array.isArray(payload?.metas)) throw new Error("invalid_payload");
  // Preserve array positions, including invalid entries and duplicates: the
  // client advances pagination by the original count before filtering entries.
  return {
    metas: payload.metas.map((meta) => {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
      return Object.fromEntries(
        CATALOG_FIELDS.filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]])
      );
    })
  };
}

export function createAddonDataService({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;
  function remove(key) {
    const entry = cache.get(key);
    if (entry) cacheBytes -= entry.bytes;
    cache.delete(key);
  }
  async function load(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(input.url, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json" }
      });
      if (!response.ok || Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES)
        throw new Error("upstream_unavailable");
      const reader = response.body.getReader();
      const parts = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            controller.abort();
            throw new Error("response_too_large");
          }
          parts.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.stringify(
        compactAddonPayload(JSON.parse(Buffer.concat(parts).toString("utf8")), input.kind)
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return async function handle(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (status) => {
      res.statusCode = status;
      res.end('{"error":"addon_service_unavailable"}');
    };
    if (req.method !== "POST") return fail(405);
    const origin = req.headers?.origin;
    if (
      origin &&
      origin !== `https://${req.headers.host}` &&
      origin !== `http://${req.headers.host}`
    )
      return fail(403);
    if (!String(req.headers?.["content-type"] || "").startsWith("application/json"))
      return fail(415);
    let body;
    try {
      if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) return fail(413);
      if (req.body !== undefined) {
        const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(text) > MAX_BODY_BYTES) return fail(413);
        body = JSON.parse(text);
      } else {
        const parts = [];
        let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) return fail(413);
          parts.push(Buffer.from(chunk));
        }
        body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      }
    } catch {
      return fail(400);
    }
    const input = validateAddonRequest(body);
    if (!input) return fail(400);
    const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const entry = cache.get(key);
    if (entry && entry.until > now()) {
      cache.delete(key);
      cache.set(key, entry);
      res.setHeader("X-Nuvio-Data-Cache", "HIT");
      return res.end(entry.body);
    }
    remove(key);
    const shared = pending.get(key);
    if (!shared && pending.size >= 8) return fail(503);
    const request =
      shared ||
      load(input)
        .then((text) => {
          const bytes = Buffer.byteLength(text);
          if (bytes <= MAX_CACHE_BYTES / 2) {
            while (cache.size && (cache.size >= 64 || cacheBytes + bytes > MAX_CACHE_BYTES))
              remove(cache.keys().next().value);
            cache.set(key, {
              body: text,
              bytes,
              until: now() + (input.kind === "catalog" ? 120000 : 300000)
            });
            cacheBytes += bytes;
          }
          return text;
        })
        .finally(() => pending.delete(key));
    if (!shared) pending.set(key, request);
    try {
      const text = await request;
      res.setHeader("X-Nuvio-Data-Cache", shared ? "SHARED" : "MISS");
      res.end(text);
    } catch {
      fail(502);
    }
  };
}
