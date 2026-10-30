// Server header read of audio names (server/mediaTracksService.js) against local HTTP fixtures:
// MKV/MP4 parsing through the VIDAA provider, SSRF refusals with zero hits, account allowlist,
// Range-only transport, byte/time/redirect limits, and no URL in any response or log.
// Desktop only: the Vercel deployment and the TV are checked separately.
import assert from "node:assert/strict";
import http from "node:http";
import {
  MEDIA_TRACKS_LIMITS,
  createGuardedFetch,
  createMediaTracksService,
  isBlockedAddress
} from "../server/mediaTracksService.js";
import {
  AUDIO_TRACKS,
  createMkvAudioFixture,
  createMp4AudioFixture
} from "./helpers/vidaaAudioTrackFixture.mjs";

const mkv = createMkvAudioFixture({ tracksOffset: 300 * 1024 });
const mp4 = createMp4AudioFixture({ moovAtEnd: true });
const big = Buffer.alloc(3 * 1024 * 1024, 1);

function fixture(host) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ path: req.url, range: req.headers.range });
    const redirect = /^\/redirect\/(\d+)$/.exec(req.url);
    if (redirect) {
      const left = Number(redirect[1]);
      res.writeHead(302, { Location: left ? `/redirect/${left - 1}` : "/a.mkv" });
      return res.end();
    }
    if (req.url === "/to-v6") {
      res.writeHead(302, { Location: `http://[::1]:${v6.port}/a.mkv` });
      return res.end();
    }
    if (req.url === "/hang") return;
    if (req.url === "/big") {
      // Ignores the Range: the transport must stop at its byte cap.
      res.writeHead(206, { "Content-Range": `bytes 0-${big.length - 1}/${big.length + 1}` });
      return res.end(big);
    }
    const file = req.url === "/a.mp4" ? mp4 : mkv;
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "") || [];
    if (first === undefined) {
      res.writeHead(200);
      return res.end(file);
    }
    const start = Number(first);
    const end = Math.min(Number(last), file.length - 1);
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${file.length}`,
      "Content-Length": String(end - start + 1),
      ETag: '"fixture"'
    });
    res.end(file.subarray(start, end + 1));
  });
  return new Promise((resolve) =>
    server.listen(0, host, () => resolve({ server, hits, port: server.address().port }))
  );
}
const v4 = await fixture("127.0.0.1");
const v6 = await fixture("::1");
const base = `http://127.0.0.1:${v4.port}`;

// Only the fixture's 127.0.0.1 is reachable in the "open" services; every other rule applies.
const openBlocked = (address, family) =>
  address === "127.0.0.1" ? false : isBlockedAddress(address, family);
const lookup = (hostname, _options, callback) => {
  const map = { "media.test": "127.0.0.1", "private.test": "127.0.0.1", "lan.test": "10.0.0.7" };
  // Rebinding-style answer: one public and one private address, all refused.
  if (hostname === "mixed.test")
    return callback(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ]);
  if (!map[hostname]) return callback(new Error("ENOTFOUND"));
  callback(null, [{ address: map[hostname], family: 4 }]);
};
const authCalls = [];
const authFetch = async (url, init) => {
  authCalls.push({ url, apikey: init.headers.apikey, authorization: init.headers.Authorization });
  const users = {
    good: { id: "u1" },
    email: { id: "u3", email: "ME@Example.test", email_confirmed_at: "2026-01-01T00:00:00Z" },
    unconfirmed: { id: "u4", email: "me@example.test", email_confirmed_at: null },
    other: { id: "u2" }
  };
  const token = init.headers.Authorization.replace("Bearer ", "");
  if (token.startsWith("slow")) await new Promise((resolve) => setTimeout(resolve, 300));
  if (token === "slow-good") return new Response(JSON.stringify(users.good), { status: 200 });
  if (!users[token]) return new Response("{}", { status: 401 });
  return new Response(JSON.stringify(users[token]), { status: 200 });
};
const env = { NUVIO_SUPABASE_URL: "https://backend.test/", NUVIO_SUPABASE_ANON_KEY: "anon-key" };
const service = (options = {}) =>
  createMediaTracksService({
    env,
    users: " u1 , me@example.test ",
    authFetch,
    lookup,
    isBlocked: openBlocked,
    ...options
  });
const open = service();
const strict = service({ isBlocked: undefined });

const logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const original = console[level];
  console[level] = (...args) => {
    logs.push(args.map(String).join(" "));
    if (level !== "log") original(...args);
  };
}
const responses = [];
async function call(handle, { url, token = "good", method = "POST", headers = {}, body } = {}) {
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(text) {
      this.text = text;
    }
  };
  await handle(
    {
      method,
      headers: {
        host: "nuvio.test",
        origin: "https://nuvio.test",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body ?? { url }
    },
    res
  );
  responses.push(res.text);
  return { status: res.statusCode, json: JSON.parse(res.text), headers: res.headers };
}
const expected = AUDIO_TRACKS.map((track) => ({
  language: track.language,
  codecId: track.codecId,
  channels: track.channels
}));
const pick = (audio) =>
  audio.map(({ language, codecId, channels }) => ({ language, codecId, channels }));

// 1. MKV (Tracks after 300 KiB) and MP4 (moov at the end), through a hostname.
{
  const result = await call(open, { url: `http://media.test:${v4.port}/a.mkv` });
  assert.equal(result.status, 200);
  assert.equal(result.json.result, "ok");
  assert.deepEqual(pick(result.json.audio), expected);
  assert.deepEqual(
    result.json.audio.map((track) => track.name),
    ["VFF", "", "Commento regista"]
  );
  assert.deepEqual(Object.keys(result.json.audio[0]).sort(), [
    "channels",
    "codec",
    "codecId",
    "language",
    "name"
  ]);
  assert.equal(result.headers["cache-control"], "private, no-store");
  const movie = await call(open, { url: `${base}/a.mp4` });
  assert.equal(movie.json.result, "ok");
  assert.deepEqual(
    movie.json.audio.map((track) => track.codec),
    ["eac3", "truehd", "aac"]
  );
  assert.deepEqual(authCalls[0], {
    url: "https://backend.test/auth/v1/user",
    apikey: "anon-key",
    authorization: "Bearer good"
  });
  assert.ok(
    v4.hits.every((hit) => /^bytes=\d+-\d+$/.test(hit.range)),
    "only bytes=a-b Range requests"
  );
}

// 2. Account: 403 (never 401) for a missing, unknown or non-allowlisted token, or no allowlist.
{
  const hits = v4.hits.length;
  for (const token of ["", "unknown", "other", "unconfirmed"])
    assert.equal((await call(open, { url: `${base}/a.mkv`, token })).status, 403, token);
  assert.equal((await call(open, { url: `${base}/a.mkv`, token: "email" })).status, 200);
  const before = authCalls.length;
  for (const users of ["", " , "]) {
    const closed = service({ users });
    assert.equal((await call(closed, { url: `${base}/a.mkv` })).status, 403);
  }
  assert.equal(authCalls.length, before, "an empty allowlist never asks the backend");
  assert.equal(v4.hits.length - hits, 3, "only the email account read the file");
  const results = [];
  for (const options of [
    { method: "GET" },
    { headers: { origin: "https://evil.test" } },
    { headers: { "content-type": "text/plain" } },
    { body: { url: "ftp://media.test/a.mkv" } },
    { body: { url: `http://user:secret@127.0.0.1:${v4.port}/a.mkv` } },
    { body: { url: "x".repeat(9000) } }
  ])
    results.push((await call(open, options)).status);
  assert.deepEqual(results, [405, 403, 415, 400, 400, 413]);
}

// 3. SSRF: private, loopback and mapped addresses refused before any connection.
{
  const hits = v4.hits.length;
  const port = v4.port;
  for (const url of [
    `http://127.0.0.1:${port}/a.mkv`,
    `http://[::1]:${v6.port}/a.mkv`,
    `http://[::ffff:127.0.0.1]:${port}/a.mkv`,
    `http://private.test:${port}/a.mkv`,
    `http://10.0.0.1:${port}/a.mkv`,
    `http://169.254.169.254/latest/meta-data`,
    `http://lan.test:${port}/a.mkv`,
    `http://mixed.test:${port}/a.mkv`,
    `http://2130706433:${port}/a.mkv`,
    `http://0x7f.1:${port}/a.mkv`,
    `http://017700000001:${port}/a.mkv`,
    `http://[64:ff9b::127.0.0.1]:${port}/a.mkv`
  ]) {
    const result = await call(strict, { url });
    assert.equal(result.status, 200, url);
    assert.deepEqual(result.json, { result: "blocked", audio: [] }, url);
  }
  assert.equal(v4.hits.length, hits, "no request reached the fixture");
  const redirected = await call(open, { url: `${base}/to-v6` });
  assert.equal(redirected.json.result, "blocked", "redirect to a private address");
  assert.equal(v6.hits.length, 0, "the redirect target was never contacted");
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2001::1",
    "2002:a00:1::",
    "fd00::1",
    "fe80::1",
    "ff02::1"
  ])
    assert.equal(isBlockedAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "151.101.1.1", "::ffff:8.8.8.8", "2606:4700::1111"])
    assert.equal(isBlockedAddress(address), false, `${address} is public`);
  assert.equal(isBlockedAddress("8.8.8.8", 4), false);
  assert.equal(isBlockedAddress("not-an-ip"), true);
}

// 4. Redirects: five followed by hand, a sixth refused.
{
  assert.equal(MEDIA_TRACKS_LIMITS.redirects, 5);
  const five = await call(open, { url: `${base}/redirect/4` });
  assert.equal(five.json.result, "ok", "five hops");
  v4.hits.length = 0;
  const six = await call(open, { url: `${base}/redirect/5` });
  assert.equal(six.json.result, "redirects");
  assert.ok(!v4.hits.some((hit) => hit.path === "/a.mkv"), "the sixth hop is never fetched");
}

// 5. Transport: Range-only, 1 MiB read cap, deadline, concurrency.
{
  assert.equal(MEDIA_TRACKS_LIMITS.readBytes, 1024 * 1024);
  assert.equal(MEDIA_TRACKS_LIMITS.deadlineMs, 8000);
  assert.equal(MEDIA_TRACKS_LIMITS.concurrent, 4);
  const guard = createGuardedFetch({ isBlocked: openBlocked });
  const hits = v4.hits.length;
  for (const headers of [{}, { Range: "bytes=0-" }, { Range: "bytes=0-1,5-9" }])
    await assert.rejects(guard.fetch(`${base}/a.mkv`, { headers }), /range-only/);
  assert.equal(v4.hits.length, hits, "no request without a bytes=a-b Range");
  const response = await guard.fetch(`${base}/big`, { headers: { Range: "bytes=0-4000000" } });
  const reader = response.body.getReader();
  let received = 0;
  await assert.rejects(async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
  }, /budget/);
  assert.ok(received <= 1024 * 1024, `read ${received} bytes`);
  assert.equal(guard.category, "budget");
  guard.close();

  const slow = service({ deadlineMs: 300 });
  const started = Date.now();
  const calls = Array.from({ length: 5 }, () => call(slow, { url: `${base}/hang` }));
  const results = await Promise.all(calls);
  assert.ok(Date.now() - started < 3000, "the deadline ends the read");
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 200, 200, 503]);
  for (const result of results.filter((item) => item.status === 200))
    assert.deepEqual(result.json, { result: "timeout", audio: [] });

  // Unauthenticated calls never hold a read slot.
  const busy = service({ deadlineMs: 2000 });
  const mixed = await Promise.all([
    ...Array.from({ length: 4 }, () => call(busy, { url: `${base}/a.mkv`, token: "slow" })),
    call(busy, { url: `${base}/a.mkv` })
  ]);
  assert.deepEqual(
    mixed.map((result) => result.status),
    [403, 403, 403, 403, 200]
  );

  // One deadline covers the account check and the read (maxDuration 10 s).
  const shared = service({ deadlineMs: 500 });
  const begin = Date.now();
  const late = await call(shared, { url: `${base}/hang`, token: "slow-good" });
  assert.deepEqual(late.json, { result: "timeout", audio: [] });
  assert.ok(Date.now() - begin < 750, `auth + read took ${Date.now() - begin} ms`);
}

// 6. No URL, host or path in any response or log line.
for (const text of [...responses, ...logs])
  for (const secret of ["127.0.0.1", "media.test", "a.mkv", "a.mp4", "/hang", "secret", "::1"])
    assert.ok(!String(text).includes(secret), `${secret} leaked`);
assert.deepEqual(logs, []);

v4.server.close();
v6.server.close();
v4.server.closeAllConnections();
console.info = console.log;
process.stdout.write(
  "PASS: VIDAA media tracks service (MKV/MP4 names, allowlist 403, SSRF, Range-only, limits, no URL)\n"
);
