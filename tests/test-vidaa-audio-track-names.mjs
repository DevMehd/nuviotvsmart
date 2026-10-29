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

for (const { name, run } of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(
  `${tests.length}/${tests.length} VIDAA audio track name tests passed (simulated HTTP).`
);
