// Hand-off receiver: wire format and hash parity with the Android app (Docs/parite-plateformes.fr.md).
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.document = { documentElement: {} };

const { fnv1a64Hex, PersoSpace } = await import("../js/core/perso/persoSpace.js");
assert.equal(fnv1a64Hex(""), "cbf29ce484222325");
assert.equal(fnv1a64Hex("a"), "af63dc4c8601ec8c");
assert.equal(PersoSpace.handoffTopic("abcd"), "nuvio-handoff-v1-939fe08ba58d4f5d");

const { parseHandoffEvent, playerParamsFromHandoff } = await import("../js/core/perso/tvHandoffReceiver.js");
const now = 1_800_000_000_000;
const message = {
  v: 1, type: "handoff", from: "d1", name: "Pixel", device: "android", at: now - 1000,
  media: { type: "series", id: "tt1", videoId: "tt1:1:2", title: "Show", seasonNumber: 1, episodeNumber: 2 },
  positionMs: 61_000, sourceUrl: "https://cdn.example/video.mkv", sourceHeaders: { Referer: "https://x" }
};
const event = JSON.stringify({ event: "message", message: JSON.stringify(message) });
const parsed = parseHandoffEvent(event, now);
assert.equal(parsed.media.videoId, "tt1:1:2");
assert.equal(parseHandoffEvent(JSON.stringify({ event: "keepalive" }), now), null);
assert.equal(parseHandoffEvent(event, now + 11 * 60 * 1000), null, "stale messages are ignored");

const params = playerParamsFromHandoff(parsed);
assert.equal(params.streamUrl, "https://cdn.example/video.mkv");
assert.equal(params.resumePositionMs, 61_000);
assert.equal(params.season, 1);
assert.deepEqual(params.streamCandidates[0].behaviorHints.proxyHeaders.request, { Referer: "https://x" });
assert.equal(playerParamsFromHandoff({ ...parsed, sourceUrl: null }), null, "without a link the detail page opens");

// A downloaded file sent from the phone: LAN link, subtitle files and the tracks chosen there.
const local = playerParamsFromHandoff({
  ...parsed,
  sourceUrl: "http://192.168.1.20:40123/media/abc.mkv",
  sourceHeaders: {},
  subtitles: [{ url: "http://192.168.1.20:40123/media/s1.srt", lang: "fre", name: "Français" }, { lang: "eng" }],
  audio: { language: "eng", name: "English Atmos" },
  subtitle: { kind: "external", language: "fre", url: "http://192.168.1.20:40123/media/s1.srt" }
});
assert.equal(local.streamCandidates[0].subtitles.length, 1, "subtitles without a link are dropped");
assert.equal(local.streamCandidates[0].subtitles[0].lang, "fre");
assert.deepEqual(local.handoffAudio, { language: "eng", name: "English Atmos", trackId: null });
assert.equal(local.handoffSubtitle.type, "ADDON");
assert.equal(local.handoffSubtitle.addonUrl, "http://192.168.1.20:40123/media/s1.srt");

const { subtitlePreferenceFromHandoff, audioPreferenceFromHandoff } = await import("../js/core/perso/tvHandoffReceiver.js");
assert.deepEqual(subtitlePreferenceFromHandoff({ kind: "off" }), { type: "DISABLED" });
assert.equal(subtitlePreferenceFromHandoff({ kind: "internal", language: "fre", name: "Forced" }).type, "INTERNAL");
assert.equal(subtitlePreferenceFromHandoff({ kind: "external" }), null);
assert.equal(audioPreferenceFromHandoff({}), null);
assert.equal(params.handoffAudio, null, "older phones send no track choice");

console.log("perso hand-off tests passed");
