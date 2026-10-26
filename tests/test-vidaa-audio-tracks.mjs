import assert from "node:assert/strict";

// VIDAA audio tracks (nuv-089): Matroska CodecIDs become the codec names shown in track labels.
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { vidaaAudioCodecName } = await import("../js/platform/vidaa/vidaaEmbeddedTextProvider.js");

assert.equal(vidaaAudioCodecName("A_EAC3"), "eac3");
assert.equal(vidaaAudioCodecName("A_AC3"), "ac3");
assert.equal(vidaaAudioCodecName("A_DTS/MA"), "dts");
assert.equal(vidaaAudioCodecName("A_TRUEHD"), "truehd");
assert.equal(vidaaAudioCodecName("A_AAC/MPEG4/LC"), "aac");
assert.equal(vidaaAudioCodecName("A_OPUS"), "opus");

console.log("PASS: VIDAA audio track codec names.");
