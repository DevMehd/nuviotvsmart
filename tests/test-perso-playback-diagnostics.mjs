// Playback failure diagnostics: links stay redacted, repeats merge, reports reach the personal space.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.window = globalThis;
globalThis.document = { documentElement: {}, createElement: () => ({ canPlayType: (type) => (type.includes("ec-3") ? "probably" : "") }) };

const { describeUrl, announcedFormat, createPlaybackDiagnostics, playbackFailureEntry, playbackCapabilities } = await import(
  "../js/core/diagnostics/playbackDiagnostics.js"
);

assert.deepEqual(describeUrl("https://user:secret@real-debrid.com/d/ABCDEF123/Loki.S01E04.mkv?token=xyz"), {
  scheme: "https",
  host: "real-debrid.com",
  ext: "mkv"
});
assert.deepEqual(describeUrl("http://192.168.1.114:40000/media/abc.mkv").host, "192.168.1.114:40000");
assert.deepEqual(announcedFormat({ name: "Loki 2160p REMUX DV HDR TrueHD Atmos 7.1 x265" }), [
  "2160p",
  "hevc",
  "dolby-vision",
  "hdr",
  "truehd",
  "atmos",
  "remux"
]);
assert.equal(playbackCapabilities().eac3, "probably");
assert.equal(playbackCapabilities().truehd, "no");

const reports = [];
const cloud = {
  available: true,
  spaceId: async () => "space-1",
  sendReport: async (id, report) => {
    reports.push({ id, report });
    return true;
  }
};
let clock = 1_000;
const diagnostics = createPlaybackDiagnostics({
  storage: globalThis.localStorage,
  cloud,
  space: { get: () => ({ spaceCode: "ABCDEFGHJKLM", deviceName: "Salon" }) },
  now: () => clock,
  log: () => {}
});
const screen = { params: { playerTitle: "Loki", itemId: "tt9140554" }, streamCandidates: [{}, {}] };
const candidate = { name: "Torrentio 4K", addonName: "Torrentio", url: "https://cdn.example/secret-key/file.mkv" };
const entry = playbackFailureEntry(screen, {
  candidate,
  reason: "startup-error",
  mediaErrorCode: 4,
  details: ["Source: https://cdn.example/secret-key/file.mkv?api=1"]
});
assert.ok(!JSON.stringify(entry).includes("secret-key"), "no link path in the report");
assert.equal(entry.mediaError.code, 4);
diagnostics.record(entry);
clock += 500;
assert.equal(diagnostics.record({ ...entry, details: [] }), null, "the fallback right after the error is merged");
clock += 5_000;
diagnostics.record({ ...entry, reason: "startup-stall" });
assert.equal(diagnostics.list().length, 2);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(reports.length, 2);
assert.equal(reports[0].report.kind, "error");
assert.ok(reports[0].report.message.startsWith("playback: startup-error"));
diagnostics.clear();
assert.equal(diagnostics.list().length, 0);

console.log("perso playback diagnostics tests passed");
