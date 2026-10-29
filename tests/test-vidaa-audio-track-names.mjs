import assert from "node:assert/strict";
import {
  AUDIO_TRACKS,
  createMkvAudioFixture,
  createMp4AudioFixture,
  rangeTransport
} from "./helpers/vidaaAudioTrackFixture.mjs";
import {
  createVidaaEmbeddedTextProvider,
  VIDAA_EMBEDDED_TEXT_LIMITS
} from "../js/platform/vidaa/vidaaEmbeddedTextProvider.js";

// VIDAA lists audio tracks without names: they are read from the MKV/MP4 header only.
const url = "https://media.invalid/release";
const expected = [
  { language: "fre", codec: "eac3", channels: 6, name: "VFF" },
  { language: "eng", codec: "truehd", channels: 8, name: "" },
  { language: "ita", codec: "aac", channels: 2, name: "Commento regista" }
];
const summary = (tracks) =>
  tracks.map(({ type, language, codec, channels, name, nativeTrackIndex }) => ({
    type,
    language,
    codec,
    channels,
    name,
    nativeTrackIndex
  }));
const withOrder = (list, overrides = {}) =>
  list.map((track, index) => ({
    type: "audio",
    ...track,
    nativeTrackIndex: index,
    ...overrides[index]
  }));

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("MKV: header-only read names every audio track, cached per stream", async () => {
  const h = rangeTransport(createMkvAudioFixture());
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}.mkv`, { audioOnly: true });
  assert.deepEqual(summary(tracks), withOrder(expected));
  assert.equal(h.calls.length, 1);
  assert.ok(h.bytes() <= VIDAA_EMBEDDED_TEXT_LIMITS.headerBytes);
  assert.deepEqual(
    summary(await p.getTracks(`${url}.mkv`, { audioOnly: true })),
    withOrder(expected)
  );
  assert.equal(h.calls.length, 1, "a second request for the same stream uses the cache");
  p.dispose();
});

test("MKV: Tracks beyond the first header page are reached through the SeekHead", async () => {
  const h = rangeTransport(createMkvAudioFixture({ tracksOffset: 200 * 1024 }));
  const p = createVidaaEmbeddedTextProvider(h);
  assert.deepEqual(
    summary(await p.getTracks(`${url}.mkv`, { audioOnly: true })),
    withOrder(expected)
  );
  assert.ok(h.calls.length <= 3);
  p.dispose();
});

test("MKV: a failed subtitle discovery keeps the audio names it already read", async () => {
  // No Cues: the subtitle index is missing, the track list is not.
  const h = rangeTransport(createMkvAudioFixture());
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}.mkv`);
  assert.deepEqual(summary(tracks), withOrder(expected));
  assert.notEqual(p.diagnostics().errorCode, "");
  p.dispose();
});

for (const moovAtEnd of [false, true]) {
  test(`MP4 (moov ${moovAtEnd ? "after" : "before"} the media): audio tracks without downloading sample tables`, async () => {
    const buffer = createMp4AudioFixture({ moovAtEnd });
    const h = rangeTransport(buffer);
    const p = createVidaaEmbeddedTextProvider(h);
    const tracks = await p.getTracks(`${url}.mp4`, { audioOnly: true });
    // AC-3/E-AC-3 sample entries carry a placeholder channel count: left unknown.
    assert.deepEqual(
      summary(tracks),
      withOrder(expected, { 0: { channels: "", name: "" }, 1: { name: "" } })
    );
    assert.ok(h.bytes() < buffer.length / 2, `${h.bytes()} bytes read of ${buffer.length}`);
    assert.ok(h.calls.length <= 12, `${h.calls.length} requests`);
    p.dispose();
  });
}

test("MOV: QuickTime counted handler names give the title, never the muxer name", async () => {
  const h = rangeTransport(createMp4AudioFixture({ quickTime: true }));
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}.mov`, { audioOnly: true });
  assert.deepEqual(
    tracks.map((track) => track.name),
    ["", "", "Commento regista"]
  );
  p.dispose();
});

test("MP4 reached through the subtitle discovery falls back to the header read", async () => {
  const h = rangeTransport(createMp4AudioFixture());
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}`);
  assert.equal(p.diagnostics().errorCode, "INVALID_MATROSKA");
  assert.deepEqual(
    tracks.map((track) => track.language),
    AUDIO_TRACKS.map((track) => track.language)
  );
  p.dispose();
});

test("an unknown container stays unnamed and is not read again", async () => {
  const h = rangeTransport(Buffer.alloc(300 * 1024, 7));
  const p = createVidaaEmbeddedTextProvider(h);
  assert.deepEqual(await p.getTracks(`${url}.mkv`, { audioOnly: true }), []);
  assert.deepEqual(await p.getTracks(`${url}.mkv`, { audioOnly: true }), []);
  assert.equal(h.calls.length, 1);
  p.dispose();
});

test("a transport failure is retried after a back-off, not on every call", async () => {
  const buffer = createMkvAudioFixture();
  const h = rangeTransport(buffer);
  let failing = true;
  const fetchImpl = (...args) =>
    failing ? Promise.reject(new TypeError("network")) : h.fetchImpl(...args);
  const p = createVidaaEmbeddedTextProvider({ fetchImpl, now: h.now });
  assert.deepEqual(await p.getTracks(`${url}.mkv`, { audioOnly: true }), []);
  failing = false;
  assert.deepEqual(await p.getTracks(`${url}.mkv`, { audioOnly: true }), []);
  assert.equal(h.calls.length, 0);
  h.advance(5001);
  assert.equal((await p.getTracks(`${url}.mkv`, { audioOnly: true })).length, 3);
  p.dispose();
});

test("dispose aborts a pending header read", async () => {
  let signal;
  const p = createVidaaEmbeddedTextProvider({
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    }
  });
  const pending = p.getTracks(`${url}.mkv`, { audioOnly: true });
  await Promise.resolve();
  p.dispose();
  assert.deepEqual(await pending, []);
  assert.equal(signal.aborted, true);
});

// Addon/debrid links are usually redirect endpoints (302 to the file host). The subtitle
// reader refuses redirects; the audio header read follows them when no custom header
// would be forwarded to another host.
function redirectingTransport(buffer) {
  const h = rangeTransport(buffer);
  const urls = [];
  const fetchImpl = async (target, options) => {
    urls.push({ target, redirect: options.redirect });
    if (target === "https://cdn.invalid/file") return h.fetchImpl(target, options);
    if (options.redirect !== "follow") throw new TypeError("redirect refused");
    const response = await h.fetchImpl(target, options);
    Object.defineProperty(response, "redirected", { value: true });
    Object.defineProperty(response, "url", { value: "https://cdn.invalid/file" });
    return response;
  };
  return { ...h, urls, fetchImpl };
}

test("a redirecting stream link is followed once for the audio header read", async () => {
  const h = redirectingTransport(createMkvAudioFixture({ tracksOffset: 200 * 1024 }));
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}.mkv`, { audioOnly: true });
  assert.deepEqual(summary(tracks), withOrder(expected));
  assert.equal(h.urls[0].redirect, "follow");
  // Later pages of the same read go straight to the resolved file.
  assert.ok(h.urls.slice(1).every((call) => call.target === "https://cdn.invalid/file"));
  assert.equal(p.diagnostics().audio.redirected, true);
  p.dispose();
});

test("a redirect refused by the subtitle discovery still gets the audio names", async () => {
  const h = redirectingTransport(createMkvAudioFixture());
  const p = createVidaaEmbeddedTextProvider(h);
  const tracks = await p.getTracks(`${url}.mkv`);
  assert.equal(p.diagnostics().errorCode, "TRANSPORT_UNAVAILABLE");
  assert.deepEqual(summary(tracks), withOrder(expected));
  assert.equal(h.urls[0].redirect, "error", "the subtitle reader keeps refusing redirects");
  p.dispose();
});

test("custom request headers are never sent through a redirect", async () => {
  const h = redirectingTransport(createMkvAudioFixture());
  const p = createVidaaEmbeddedTextProvider(h);
  const headers = { "X-Private": "value" };
  assert.deepEqual(await p.getTracks(`${url}.mkv`, { headers, audioOnly: true }), []);
  assert.ok(h.urls.every((call) => call.redirect === "error"));
  assert.equal(p.diagnostics().audio.result, "cors");
  p.dispose();
});

for (const [name, change, result] of [
  ["ok", () => {}, "ok"],
  ["range refused (200 with the whole file)", () => ({ status: 200 }), "range-refused"],
  ["Content-Range hidden by CORS", () => ({ hideRange: true }), "cors-headers"],
  ["HTTP 404", () => ({ status: 404 }), "http-4xx"],
  ["HTTP 403", () => ({ status: 403 }), "http-4xx"],
  ["HTTP 503", () => ({ status: 503 }), "http-5xx"],
  ["fetch rejected (CORS, DNS, refused redirect)", () => ({ reject: true }), "cors"]
]) {
  test(`audio status category: ${name}`, async () => {
    const buffer = createMkvAudioFixture();
    const h = rangeTransport(buffer);
    const config = change() || {};
    const fetchImpl = async (target, options) => {
      if (config.reject) throw new TypeError("https://secret.invalid/token");
      const response = await h.fetchImpl(target, options);
      if (!config.status && !config.hideRange) return response;
      const headers = new Headers(response.headers);
      if (config.hideRange) headers.delete("Content-Range");
      return new Response(new Uint8Array(buffer), { status: config.status || 206, headers });
    };
    const p = createVidaaEmbeddedTextProvider({ fetchImpl, now: h.now });
    await p.getTracks(`${url}.mkv`, { audioOnly: true });
    const audio = p.diagnostics().audio;
    assert.equal(audio.result, result);
    assert.equal(audio.started, true);
    assert.equal(audio.headerCount, result === "ok" ? 3 : 0);
    assert.equal(typeof audio.elapsedMs, "number");
    assert.equal(JSON.stringify(audio).includes("secret"), false);
    assert.equal(JSON.stringify(audio).includes("invalid"), false);
    p.dispose();
  });
}

test("audio status: unknown container, timeout and a pending read", async () => {
  const unknown = createVidaaEmbeddedTextProvider(rangeTransport(Buffer.alloc(300 * 1024, 7)));
  await unknown.getTracks(`${url}.mkv`, { audioOnly: true });
  assert.equal(unknown.diagnostics().audio.result, "not-matroska-or-mp4");
  unknown.dispose();

  const h = rangeTransport(createMkvAudioFixture({ tracksOffset: 200 * 1024 }));
  const late = createVidaaEmbeddedTextProvider({
    // The header page arrives after the whole read's deadline: the Tracks page is not asked.
    fetchImpl: (...args) => {
      h.advance(VIDAA_EMBEDDED_TEXT_LIMITS.operationTimeoutMs);
      return h.fetchImpl(...args);
    },
    now: h.now
  });
  await late.getTracks(`${url}.mkv`, { audioOnly: true });
  assert.equal(late.diagnostics().audio.result, "timeout");
  late.dispose();

  const hanging = createVidaaEmbeddedTextProvider({ fetchImpl: () => new Promise(() => {}) });
  const pending = hanging.getTracks(`${url}.mkv`, { audioOnly: true });
  await Promise.resolve();
  assert.equal(hanging.diagnostics().audio.result, "pending");
  assert.equal(hanging.diagnostics().audio.started, true);
  hanging.dispose();
  await pending;
});

for (const { name, run } of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(
  `${tests.length}/${tests.length} VIDAA audio track name tests passed (simulated HTTP).`
);
