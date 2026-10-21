import assert from "node:assert/strict";

// VIDAA audio tracks (nuv-089): container codec names, TV-declared support, unplayable sound badge.
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { vidaaAudioCodecName } = await import("../js/platform/vidaa/vidaaEmbeddedTextProvider.js");
const { audioCodecCapabilityKey, isAudioCodecDeclaredUnsupported } =
  await import("../js/core/player/audioTrackCodecMetadata.js");

assert.equal(vidaaAudioCodecName("A_EAC3"), "eac3");
assert.equal(vidaaAudioCodecName("A_AC3"), "ac3");
assert.equal(vidaaAudioCodecName("A_DTS/MA"), "dts");
assert.equal(vidaaAudioCodecName("A_TRUEHD"), "truehd");
assert.equal(vidaaAudioCodecName("A_AAC/MPEG4/LC"), "aac");
assert.equal(vidaaAudioCodecName("A_OPUS"), "opus");

assert.equal(audioCodecCapabilityKey("truehd"), "truehd");
assert.equal(audioCodecCapabilityKey("DTS-HD MA"), "dts");
assert.equal(audioCodecCapabilityKey("eac3"), "eac3");
assert.equal(audioCodecCapabilityKey("Dolby Digital Plus"), "eac3");
assert.equal(audioCodecCapabilityKey("ac3"), "ac3");
assert.equal(audioCodecCapabilityKey("aac"), "aac");
assert.equal(audioCodecCapabilityKey(""), "");

// canPlayType "" and MediaSource refusal → unsupported; any yes or unknown → playable.
assert.equal(isAudioCodecDeclaredUnsupported("no"), true);
assert.equal(isAudioCodecDeclaredUnsupported("no/no-mse"), true);
assert.equal(isAudioCodecDeclaredUnsupported("no/mse"), false);
assert.equal(isAudioCodecDeclaredUnsupported("probably/mse"), false);
assert.equal(isAudioCodecDeclaredUnsupported("maybe"), false);
assert.equal(isAudioCodecDeclaredUnsupported(undefined), false);

// Without a media element (node), the TV declares no codec: TrueHD/DTS-only releases are flagged,
// a release that also carries AC3/DD+ is not.
const { getStreamPresentationBadges } =
  await import("../js/core/streams/streamPresentationBadges.js");
const flagged = getStreamPresentationBadges({ name: "Film 2160p REMUX TrueHD Atmos 7.1" });
assert.ok(flagged.includes("Son non lu par la TV"), flagged.join(","));
assert.ok(
  !getStreamPresentationBadges({ name: "Film 1080p DTS-HD MA AC3 5.1" }).includes(
    "Son non lu par la TV"
  )
);
assert.ok(
  !getStreamPresentationBadges({ name: "Film 1080p WEB DDP5.1" }).includes("Son non lu par la TV")
);

console.log("PASS: VIDAA audio track codec names, declared support and unplayable sound badge.");
