import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.fetch = () => {
  throw new Error("Unexpected network request");
};

const { PlayerController } = await import("../js/core/player/playerController.js");
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");
const { describeVidaaAudioNamesStatus, readVidaaAudioNamesStatus, reportVidaaAudioNamesStatus } =
  await import("../js/ui/screens/player/vidaaAudioNamesStatus.js");
const controller = { ...PlayerController };
const tests = [];
const test = (name, run) => tests.push({ name, run });

// The TV exposes its audio tracks without label or language.
function fixture({ nativeCount = 2, url = "fixture-video" } = {}) {
  const audioTracks = Array.from({ length: nativeCount }, (_, index) => ({
    id: String(index),
    label: "",
    language: "",
    enabled: index === 0
  }));
  Platform.current = null;
  Object.assign(PlayerController, controller, {
    video: { src: url, audioTracks, textTracks: [] },
    playbackEngine: "native-file",
    playRequestToken: 1,
    avplayActive: false,
    hlsInstance: null,
    dashInstance: null,
    avplayTrackInfo: []
  });
  const ui = {
    ...PlayerScreen,
    playerMountToken: 1,
    sourcePlaybackAttemptToken: 1,
    activePlaybackUrl: url,
    externalTrackNodes: [],
    embeddedAudioTracks: [],
    embeddedSubtitleTracks: [],
    manifestAudioTracks: [],
    manifestSubtitleTracks: [],
    selectedAudioTrackIndex: 0,
    selectedEmbeddedAudioTrackIndex: -1,
    renderControlButtons() {},
    renderAudioDialog() {}
  };
  ui.invalidateTrackDialogCaches();
  return ui;
}
const headerTracks = (count) =>
  Array.from({ length: count }, (_, index) => ({
    type: "audio",
    language: ["fre", "eng", "ita"][index % 3],
    codec: "eac3",
    channels: 6
  }));

test("panel line: a server refusing partial reads, with the TV and header counts", () => {
  assert.equal(
    describeVidaaAudioNamesStatus({
      missing: true,
      result: "range-refused",
      nativeCount: 9,
      headerCount: 0
    }),
    "Noms indisponibles : le serveur refuse la lecture partielle (9 pistes TV, 0 lue)"
  );
  assert.equal(
    describeVidaaAudioNamesStatus({
      missing: true,
      result: "count-mismatch",
      nativeCount: 9,
      headerCount: 11
    }),
    "Noms indisponibles : la TV liste 9 pistes, le fichier en déclare 11"
  );
  assert.equal(
    describeVidaaAudioNamesStatus({ missing: false, result: "cors", nativeCount: 9 }),
    ""
  );
  for (const result of [
    "cors",
    "cors-headers",
    "http-4xx",
    "timeout",
    "not-matroska-or-mp4",
    "hls",
    "engine"
  ])
    assert.match(
      describeVidaaAudioNamesStatus({ missing: true, result, nativeCount: 2, headerCount: 0 }),
      /^Noms indisponibles : .+ \(2 pistes TV, 0 lue\)$/
    );
});

test("probe never started: the source is not a readable MKV/MP4 link", () => {
  const ui = fixture();
  const status = readVidaaAudioNamesStatus(ui);
  assert.equal(status.result, "container");
  assert.equal(status.probeStarted, false);
  assert.equal(status.nativeCount, 2);
  assert.equal(status.missing, true);
  assert.equal(
    ui.getAudioDialogSupportNotice(),
    "Noms indisponibles : format de fichier non lu (2 pistes TV, 0 lue)"
  );
});

test("probe never started: a non-native engine (HLS)", () => {
  const ui = fixture({ url: "https://media.invalid/master.m3u8" });
  PlayerController.playbackEngine = "hls";
  assert.equal(readVidaaAudioNamesStatus(ui).result, "hls");
});

test("header read pending on an MKV link", () => {
  const ui = fixture({ url: "https://media.invalid/film.mkv" });
  ui.embeddedAudioLoading = true;
  assert.equal(readVidaaAudioNamesStatus(ui).result, "pending");
  assert.equal(
    ui.getAudioDialogSupportNotice(),
    "Noms des pistes : lecture de l’en-tête en cours…"
  );
});

test("names read and mapped: no panel line", () => {
  const ui = fixture({ url: "https://media.invalid/film.mkv" });
  ui.embeddedAudioTracks = ui.normalizeEmbeddedAudioTracks(headerTracks(2));
  ui.invalidateTrackDialogCaches();
  const status = readVidaaAudioNamesStatus(ui);
  assert.equal(status.result, "ok");
  assert.equal(status.mapped, true);
  assert.equal(status.namedCount, 2);
  assert.equal(status.missing, false);
  assert.equal(ui.getAudioDialogSupportNotice(), "");
  assert.match(ui.getAudioEntries()[0].label, /^French/);
});

test("the TV hides tracks: the order guard keeps Audio N and says why", () => {
  const ui = fixture({ url: "https://media.invalid/film.mkv" });
  ui.embeddedAudioTracks = ui.normalizeEmbeddedAudioTracks(headerTracks(3));
  ui.invalidateTrackDialogCaches();
  const status = readVidaaAudioNamesStatus(ui);
  assert.equal(status.result, "count-mismatch");
  assert.equal(status.headerCount, 3);
  assert.equal(status.mapped, false);
  assert.equal(
    ui.getAudioDialogSupportNotice(),
    "Noms indisponibles : la TV liste 2 pistes, le fichier en déclare 3"
  );
});

test("debug console: one privacy-safe line per playback and status", () => {
  const ui = fixture({ url: "https://secret-host.invalid/token/film.mkv" });
  const lines = [];
  const warn = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    ui.embeddedAudioLoading = true;
    reportVidaaAudioNamesStatus(ui);
    assert.equal(lines.length, 0, "a pending read is not logged");
    ui.embeddedAudioLoading = false;
    ui.embeddedAudioTracks = ui.normalizeEmbeddedAudioTracks(headerTracks(3));
    ui.invalidateTrackDialogCaches();
    reportVidaaAudioNamesStatus(ui);
    reportVidaaAudioNamesStatus(ui);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^VIDAA audio names: count-mismatch \| probe started \| header 3 \/ TV 2 \| named 0/
    );
    assert.equal(/secret|token|invalid|https/.test(lines[0]), false);
    ui.sourcePlaybackAttemptToken = 2;
    reportVidaaAudioNamesStatus(ui);
    assert.equal(lines.length, 2, "a new playback logs again");
  } finally {
    console.warn = warn;
  }
});

let failures = 0;
try {
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${name}: ${error.stack}`);
    }
  }
} finally {
  Object.assign(PlayerController, controller);
}
assert.equal(failures, 0, `${failures} VIDAA audio-name status checks failed`);
console.log(`${tests.length}/${tests.length} VIDAA audio-name status tests passed (no TV).`);
