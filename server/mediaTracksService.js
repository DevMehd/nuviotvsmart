import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { createVidaaEmbeddedTextProvider } from "../js/platform/vidaa/vidaaEmbeddedTextProvider.js";
import { normalizeEnvProperties } from "../scripts/envProperties.mjs";

// Reads only the header of a media file for the VIDAA player when the media host refuses CORS:
// returns the audio track names, never the bytes. Not a general proxy: Range GETs only, public
// addresses only, bounded in bytes, time and concurrency. Errors are categories, never the URL.
export const MEDIA_TRACKS_LIMITS = Object.freeze({
  bodyBytes: 8 * 1024,
  readBytes: 1024 * 1024,
  deadlineMs: 8000,
  redirects: 5,
  concurrent: 4,
  authTimeoutMs: 3000
});

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved and broadcast
])
  blocked.addSubnet(address, prefix, "ipv4");
// No ::ffff:0:0/96 rule: BlockList maps IPv4-mapped addresses to the IPv4 rules, and such a
// rule would also match every IPv4 address checked as "ipv4".
for (const [address, prefix] of [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // ULA
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
])
  blocked.addSubnet(address, prefix, "ipv6");

export function isBlockedAddress(address, family = net.isIP(address) === 6 ? "ipv6" : "ipv4") {
  const type = family === 6 || family === "IPv6" || family === "ipv6" ? "ipv6" : "ipv4";
  return !net.isIP(address) || blocked.check(address, type);
}

function fail(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

export function parseMediaUrl(value) {
  if (typeof value !== "string" || !value || value.length > MEDIA_TRACKS_LIMITS.bodyBytes)
    return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * fetch() subset for createVidaaEmbeddedTextProvider: GET with one "bytes=a-b" Range, every
 * resolved address checked before connecting, redirects followed by hand and rechecked, the
 * whole read capped in bytes and time. close() destroys every socket.
 */
export function createGuardedFetch({
  lookup = dns.lookup,
  isBlocked = isBlockedAddress,
  deadlineMs = MEDIA_TRACKS_LIMITS.deadlineMs,
  readBytes = MEDIA_TRACKS_LIMITS.readBytes
} = {}) {
  const requests = new Set();
  let received = 0;
  let category = "";
  // Last refusal of a single request (blocked, redirects...): reported, not sticky.
  let refusal = "";
  const stop = (reason) => {
    category ||= reason;
    for (const request of requests) request.destroy(fail(reason));
    requests.clear();
  };
  const timer = setTimeout(() => stop("timeout"), deadlineMs);
  const guardedLookup = (hostname, options, callback) =>
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(fail("dns"));
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
      if (!list.length || list.some((item) => isBlocked(item.address, item.family)))
        return callback(fail("blocked"));
      if (options?.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });

  function once(url, range, own) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlocked(host)) return Promise.reject(fail("blocked"));
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "GET",
        agent: false,
        lookup: guardedLookup,
        headers: { Range: range, "Accept-Encoding": "identity", "User-Agent": "Nuvio" }
      });
      requests.add(request);
      own.add(request);
      request.on("error", (error) => {
        requests.delete(request);
        reject(fail(error?.category || category || "network"));
      });
      request.on("response", resolve);
      request.end();
    });
  }

  async function guardedFetch(input, { headers, redirect = "error", signal } = {}) {
    const range = new Headers(headers).get("Range") || "";
    if (!/^bytes=\d+-\d+$/.test(range)) throw fail("range-only");
    if (category) throw fail(category);
    if (signal?.aborted) throw fail("superseded");
    // The provider aborts each finished range: only this call's sockets go.
    const own = new Set();
    const abort = () => own.forEach((request) => request.destroy(fail("superseded")));
    signal?.addEventListener?.("abort", abort, { once: true });
    try {
      let url = parseMediaUrl(String(input));
      if (!url) throw fail("invalid-url");
      for (let hop = 0; ; hop++) {
        const response = await once(url, range, own);
        const location = response.headers.location;
        if (![301, 302, 303, 307, 308].includes(response.statusCode) || !location)
          return toResponse(response, url, hop > 0);
        response.destroy();
        if (redirect !== "follow") throw fail("redirect");
        if (hop >= MEDIA_TRACKS_LIMITS.redirects) throw fail("redirects");
        try {
          url = parseMediaUrl(new URL(location, url).href);
        } catch {
          url = null;
        }
        if (!url) throw fail("redirect");
      }
    } catch (error) {
      if (error?.category !== "superseded") refusal ||= error?.category || "network";
      throw error;
    } finally {
      signal?.removeEventListener?.("abort", abort);
    }
  }

  function toResponse(response, url, redirected) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers))
      if (key !== "set-cookie") headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const body = new ReadableStream({
      start(controller) {
        const error = (reason) => {
          try {
            controller.error(fail(reason));
          } catch {}
        };
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > readBytes) {
            stop("budget");
            return error("budget");
          }
          try {
            controller.enqueue(new Uint8Array(chunk));
          } catch {}
        });
        response.on("end", () => {
          try {
            controller.close();
          } catch {}
        });
        response.on("error", () => error(category || "network"));
        response.on("close", () => !response.complete && error(category || "network"));
      },
      cancel() {
        response.destroy();
      }
    });
    return {
      status: response.statusCode,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      headers,
      redirected,
      url: url.href,
      type: "basic",
      body
    };
  }

  return {
    fetch: guardedFetch,
    get category() {
      return category || refusal;
    },
    close() {
      clearTimeout(timer);
      stop(category || "closed");
    }
  };
}

const bearer = (req) => /^Bearer ([^\s,]{1,4096})$/i.exec(req.headers?.authorization || "")?.[1];

export function createMediaTracksService({
  env = normalizeEnvProperties(process.env),
  users = process.env.NUVIO_MEDIA_TRACKS_USERS || "",
  authFetch = (...args) => fetch(...args),
  lookup,
  isBlocked,
  deadlineMs
} = {}) {
  const allowed = new Set(
    String(users)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
  const backend = String(env.NUVIO_SUPABASE_URL || "").replace(/\/+$/, "");
  let active = 0;

  // Signed-in Nuvio account on the allowlist. 403, never 401: the TV signs out on a 401.
  async function authorized(token) {
    if (!token || !allowed.size || !backend) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_TRACKS_LIMITS.authTimeoutMs);
    try {
      const response = await authFetch(`${backend}/auth/v1/user`, {
        headers: { apikey: env.NUVIO_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) return false;
      const user = await response.json();
      // An e-mail counts only once confirmed: an unconfirmed sign-up must not borrow it.
      return [user?.id, user?.email_confirmed_at ? user.email : ""].some(
        (value) => typeof value === "string" && allowed.has(value.trim().toLowerCase())
      );
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(req) {
    if (Number(req.headers?.["content-length"] || 0) > MEDIA_TRACKS_LIMITS.bodyBytes) return 413;
    let text;
    if (req.body !== undefined) {
      text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    } else {
      const parts = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > MEDIA_TRACKS_LIMITS.bodyBytes) return 413;
        parts.push(Buffer.from(chunk));
      }
      text = Buffer.concat(parts).toString("utf8");
    }
    if (Buffer.byteLength(text) > MEDIA_TRACKS_LIMITS.bodyBytes) return 413;
    return JSON.parse(text);
  }

  async function read(url, budgetMs) {
    const guard = createGuardedFetch({ lookup, isBlocked, deadlineMs: budgetMs });
    const provider = createVidaaEmbeddedTextProvider({ fetchImpl: guard.fetch });
    let backstop;
    try {
      const tracks = await Promise.race([
        provider.getTracks(url, { audioOnly: true }),
        new Promise((resolve) => {
          backstop = setTimeout(() => resolve([]), budgetMs + 500);
        })
      ]);
      const audio = tracks.map((track) => ({
        name: String(track.name || ""),
        language: String(track.language || ""),
        codecId: String(track.codecId || ""),
        codec: String(track.codec || ""),
        channels: Number(track.channels) || 0
      }));
      // The transport's own refusal (blocked, timeout, budget) explains more than "cors".
      const result = audio.length
        ? "ok"
        : guard.category || provider.diagnostics().audio?.result || "parse";
      return { result, audio };
    } finally {
      clearTimeout(backstop);
      guard.close();
      provider.dispose();
    }
  }

  return async function handle(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (status, payload) => {
      res.statusCode = status;
      res.end(JSON.stringify(payload));
    };
    const refuse = (status, error) => reply(status, { error });
    if (req.method !== "POST") return refuse(405, "method");
    const origin = req.headers?.origin;
    if (
      origin &&
      origin !== `https://${req.headers.host}` &&
      origin !== `http://${req.headers.host}`
    )
      return refuse(403, "origin");
    if (!String(req.headers?.["content-type"] || "").startsWith("application/json"))
      return refuse(415, "content-type");
    const token = bearer(req);
    if (!token || !allowed.size) return refuse(403, "forbidden");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return refuse(400, "body");
    }
    if (body === 413) return refuse(413, "body");
    const url = parseMediaUrl(body?.url);
    if (!url) return refuse(400, "url");
    // One deadline for the account check and the read: both fit in maxDuration (10 s).
    const ends = Date.now() + (deadlineMs ?? MEDIA_TRACKS_LIMITS.deadlineMs);
    // Account first: unauthenticated calls never take a read slot.
    if (!(await authorized(token))) return refuse(403, "forbidden");
    if (active >= MEDIA_TRACKS_LIMITS.concurrent) return refuse(503, "busy");
    active++;
    try {
      reply(200, await read(url.href, Math.max(0, ends - Date.now())));
    } catch {
      refuse(502, "unavailable");
    } finally {
      active--;
    }
  };
}
