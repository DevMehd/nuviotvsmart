// Lot P, P4: track names and choice of the new VIDAA player (js/ui/tv2/player/playerTracks.js)
// against native-like tracks (getters on a prototype, like AudioTrack) and fake timers.
// Desktop logic only; the TV names, the TrueHD/AC3 switch and count-mismatch are checked on
// the TV.
import assert from "node:assert/strict";
import {
  audioNamesStatus,
  buildAudioEntries,
  createPlayerTracks,
  enableAudioTrack,
  findAudioIndex,
  languageKey,
  languageName,
  meaningfulLabel,
  readTrackList,
  srtToVtt,
  startupTargets,
  trackPreferenceContentId
} from "../js/ui/tv2/player/playerTracks.js";

// Like a native AudioTrack: every field is a prototype getter, nothing is an own property.
class NativeAudioTrack {
  #id;
  #label;
  #language;
  #enabled;
  #refuse;
  constructor(id, { label = "", language = "", enabled = false, refuse = false } = {}) {
    this.#id = id;
    this.#label = label;
    this.#language = language;
    this.#enabled = enabled;
    this.#refuse = refuse;
  }
  get id() {
    return this.#id;
  }
  get kind() {
    return "main";
  }
  get label() {
    return this.#label;
  }
  get language() {
    return this.#language;
  }
  get enabled() {
    return this.#enabled;
  }
  set enabled(value) {
    if (!this.#refuse) this.#enabled = Boolean(value);
  }
}

function trackList(tracks) {
  const listeners = new Map();
  const list = Object.assign([...tracks], {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of [...(listeners.get(type) || [])]) fn({ type });
    },
    count: (type) => listeners.get(type)?.size || 0
  });
  return list;
}

function createClock() {
  let now = 0;
  let next = 0;
  const timers = new Map();
  const root = {
    setTimeout: (callback, delay = 0) => {
      timers.set(++next, { callback, at: now + delay });
      return next;
    },
    clearTimeout: (id) => timers.delete(id),
    AbortController
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > end) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = end;
  };
  return { root, advance, timers };
}

function fakeVideo(audio, text = []) {
  const listeners = new Map();
  return {
    audioTracks: audio && trackList(audio),
    textTracks: trackList(text),
    paused: false,
    seeking: false,
    currentTime: 10,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of [...(listeners.get(type) || [])]) fn({ type });
    }
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const enabledIndexes = (list) =>
  list.map((track, i) => (track.enabled ? i : -1)).filter((i) => i >= 0);

// 1. A native track keeps its language only when read field by field (audit point 5).
{
  const track = new NativeAudioTrack("1", { language: "fre", enabled: true });
  assert.deepEqual({ ...track }, {}, "a spread loses every getter");
  const [read] = readTrackList([track]);
  assert.equal(read.language, "fre");
  assert.equal(read.native, track, "the native object stays the reference");
  const [entry] = buildAudioEntries(readTrackList([track]), null, { locale: "fr" });
  assert.equal(entry.label, "Français");
  assert.equal(entry.named, true);
  assert.equal(entry.source, "native");
  assert.equal(entry.nativeAudioTrack, track);
  assert.equal(entry.selected, true);
  assert.equal(entry.track.language, "fre", "Stream info reads track.language");
  assert.equal(readTrackList(undefined), null, "no audioTracks: choice handled by the TV");
}

// 2. Order of the name: TV label, TV language, file header, then "Audio N".
{
  assert.equal(languageKey("fre"), "fr");
  assert.equal(languageKey("fra"), "fr");
  assert.equal(languageKey("ger"), "de");
  assert.equal(languageKey("pt-BR"), "pt");
  for (const code of ["", "und", "zxx", "SoundHandler", "x"])
    assert.equal(languageKey(code), "", code);
  assert.equal(languageName("eng", "fr"), "Anglais");
  assert.equal(meaningfulLabel("SoundHandler"), "", "MP4 handler name");
  assert.equal(meaningfulLabel("Audio 2"), "");
  assert.equal(meaningfulLabel("eng"), "", "a bare code is a language, not a label");
  assert.equal(meaningfulLabel("VFF Atmos"), "VFF Atmos");

  const native = readTrackList([
    new NativeAudioTrack("1", { label: "Commentaire", language: "fre" }),
    new NativeAudioTrack("2", { language: "eng" }),
    new NativeAudioTrack("3"),
    new NativeAudioTrack("4", { label: "SoundHandler" })
  ]);
  const header = [
    { codecId: "A_AC3", codec: "ac3", language: "fre", name: "", channels: 6 },
    { codecId: "A_TRUEHD", codec: "truehd", language: "eng", name: "", channels: 8 },
    // Matroska without a language element: English by the specification (audit point 10).
    { codecId: "A_EAC3", codec: "eac3", language: "", name: "", channels: 6 },
    { codecId: "A_DTS", codec: "dts", language: "spa", name: "VO Castellano", channels: 6 }
  ];
  const entries = buildAudioEntries(native, header, { locale: "fr" });
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["Commentaire", "Anglais", "Anglais", "Espagnol"]
  );
  assert.deepEqual(
    entries.map((entry) => entry.source),
    ["native", "native", "header", "header"]
  );
  assert.equal(entries[1].secondary, "TrueHD · 7.1");
  assert.equal(entries[3].secondary, "VO Castellano · DTS · 5.1");
  // MP4 header (fourcc codec): no Matroska default language.
  const [mp4] = buildAudioEntries([native[2]], [{ codecId: "ec-3", codec: "eac3", language: "" }]);
  assert.equal(mp4.label, "Audio 1");
  // Counts differ: nothing is mapped (heuristic only after the TV count-mismatch relevé).
  const unmapped = buildAudioEntries(native.slice(2), header);
  assert.deepEqual(
    unmapped.map((entry) => entry.label),
    ["Audio 1", "Audio 2"]
  );
  const status = audioNamesStatus(unmapped, header, { started: true, result: "ok" });
  assert.equal(status.result, "count-mismatch");
  assert.equal(status.headerCount, 4);
  assert.equal(status.nativeCount, 2);
  assert.equal(status.missing, true);
  assert.equal(audioNamesStatus(entries, header, { started: true }).result, "ok");
  assert.equal(audioNamesStatus(entries.slice(0, 2), null, {}).result, "native");
  assert.equal(
    audioNamesStatus(unmapped, null, { started: true, result: "cors" }).result,
    "cors",
    "the probe category explains the missing names"
  );
}

// 3. Preferences: phone or title first, then the profile languages.
{
  const entries = buildAudioEntries(
    readTrackList([
      new NativeAudioTrack("a", { language: "fre", enabled: true }),
      new NativeAudioTrack("b", { label: "Director", language: "eng" }),
      new NativeAudioTrack("c", { language: "eng" })
    ]),
    null,
    { locale: "en" }
  );
  assert.equal(findAudioIndex(entries, { preference: { language: "eng", name: "Director" } }), 1);
  assert.equal(findAudioIndex(entries, { preference: { trackId: "c", language: "en" } }), 2);
  assert.equal(findAudioIndex(entries, { preference: { language: "en" } }), 1);
  assert.equal(findAudioIndex(entries, { targets: ["de", "en"] }), 1);
  assert.equal(findAudioIndex(entries, { targets: ["de"] }), -1, "no match keeps the default");
  assert.deepEqual(startupTargets({ preferredAudioLanguage: "system" }, "fr-FR"), {
    audio: ["fr"],
    subtitles: []
  });
  assert.deepEqual(
    startupTargets(
      {
        preferredAudioLanguage: "original",
        secondaryPreferredAudioLanguage: "fre",
        subtitleStyle: { preferredLanguage: "en" }
      },
      "fr",
      { originalLanguage: "ja" }
    ),
    { audio: ["ja", "fr"], subtitles: ["en"] }
  );
  assert.deepEqual(
    startupTargets({ subtitlesEnabled: false, subtitleStyle: { preferredLanguage: "en" } }, "fr")
      .subtitles,
    []
  );
  assert.equal(trackPreferenceContentId({ itemId: "tt1" }), "tt1");
  assert.equal(trackPreferenceContentId({ tmdbId: "12", itemType: "movie" }), "tmdb:movie:12");
}

// 4. Track change: confirmed then the video must still advance, otherwise the previous track.
{
  const clock = createClock();
  const tracks = [new NativeAudioTrack("1", { enabled: true }), new NativeAudioTrack("2")];
  const list = trackList(tracks);
  const video = { paused: false, seeking: false, currentTime: 10 };
  const ok = enableAudioTrack(list, 1, { video, root: clock.root });
  assert.deepEqual(enabledIndexes(tracks), [1], "all writes in the same task");
  list.emit("change");
  video.currentTime = 11.5;
  clock.advance(2000);
  assert.equal(await ok, true);

  const stuck = enableAudioTrack(list, 0, { video, root: clock.root });
  clock.advance(250); // no change event: read-back
  clock.advance(2000); // the video did not move
  assert.equal(await stuck, false);
  assert.deepEqual(enabledIndexes(tracks), [1], "back to the previous track");

  const refusing = [
    new NativeAudioTrack("1", { enabled: true }),
    new NativeAudioTrack("2", { refuse: true })
  ];
  const refused = enableAudioTrack(trackList(refusing), 1, { video, root: clock.root });
  clock.advance(250);
  assert.equal(await refused, false);
  assert.deepEqual(enabledIndexes(refusing), [0]);
}

// 5. Preference once at loadedmetadata, without pause; never a switch after the first image.
{
  const clock = createClock();
  const tracks = [
    new NativeAudioTrack("1", { language: "fre", enabled: true }),
    new NativeAudioTrack("2", { language: "eng" })
  ];
  const video = fakeVideo(tracks);
  let preference = { language: "eng" };
  const remembered = [];
  const player = createPlayerTracks(video, {
    root: clock.root,
    locale: () => "en",
    preferences: () => ({
      audio: preference,
      subtitle: null,
      targets: { audio: [], subtitles: [] }
    }),
    remember: { audio: (value) => remembered.push(value) }
  });
  player.reset("http://media.invalid/a.mkv");
  video.emit("loadedmetadata");
  assert.deepEqual(enabledIndexes(tracks), [1], "remembered language applied at metadata");
  assert.equal(video.paused, false, "no pause");
  preference = { language: "fre" };
  video.emit("loadedmetadata"); // same-link reload
  assert.deepEqual(enabledIndexes(tracks), [1], "applied once; a reload keeps the choice");
  tracks[1].enabled = false;
  tracks[0].enabled = true;
  video.emit("loadedmetadata"); // reload starting on the file default
  assert.deepEqual(enabledIndexes(tracks), [1], "the chosen track comes back after a reload");
  assert.equal(remembered.length, 0, "an automatic choice is not written as the user's");

  // Revert after a media error during a switch: back to the last kept track.
  const pending = player.selectAudio(0, { rememberSelection: true });
  player.revertAudio();
  tracks[0].enabled = false;
  tracks[1].enabled = true;
  video.emit("loadedmetadata");
  assert.deepEqual(enabledIndexes(tracks), [1]);
  assert.equal(player.audioError, true);
  clock.advance(5000);
  await pending;
  assert.equal(remembered.length, 0);
  player.destroy();
}

// 6. Names come from the header later: still no automatic switch (TV gives no language).
{
  const clock = createClock();
  const tracks = [new NativeAudioTrack("1", { enabled: true }), new NativeAudioTrack("2")];
  const video = fakeVideo(tracks);
  const probes = [];
  let resolveProbe;
  const notes = [];
  const player = createPlayerTracks(video, {
    root: clock.root,
    locale: () => "en",
    preferences: () => ({ audio: { language: "fre" }, targets: { audio: ["fr"], subtitles: [] } }),
    probe: (url) => {
      probes.push(url);
      return new Promise((resolve) => (resolveProbe = resolve));
    },
    note: (status) => notes.push(status.result)
  });
  player.reset("http://media.invalid/b.mkv");
  video.emit("loadedmetadata");
  assert.deepEqual(enabledIndexes(tracks), [0], "no language at metadata: TV default kept");
  player.onFirstFrame();
  player.onFirstFrame();
  clock.advance(1499);
  assert.equal(probes.length, 0, "never before first image + 1.5 s");
  clock.advance(1);
  await tick();
  assert.equal(probes.length, 1);
  player.probeAgain();
  await tick();
  assert.equal(probes.length, 1, "never in parallel");
  assert.equal(player.status().result, "pending");
  resolveProbe([
    { codecId: "A_TRUEHD", codec: "truehd", language: "eng" },
    { codecId: "A_AC3", codec: "ac3", language: "fre" }
  ]);
  await tick();
  await tick();
  assert.deepEqual(
    player.audioEntries().map((entry) => entry.label),
    ["English", "French"]
  );
  assert.deepEqual(enabledIndexes(tracks), [0], "header names never switch the track");
  assert.equal(notes.at(-1), "ok");
  player.probeAgain();
  await tick();
  assert.equal(probes.length, 2, "Audio opening reads again (the provider spaces retries)");
  player.destroy();
}

// 7. HLS, and tracks all named by the TV: no request to the media host.
{
  const clock = createClock();
  const probes = [];
  const named = fakeVideo([new NativeAudioTrack("1", { language: "eng", enabled: true })]);
  const player = createPlayerTracks(named, {
    root: clock.root,
    locale: () => "en",
    probe: async (url) => probes.push(url) && []
  });
  player.reset("http://media.invalid/c.mkv");
  player.onFirstFrame();
  clock.advance(2000);
  const hls = createPlayerTracks(fakeVideo([new NativeAudioTrack("1")]), {
    root: clock.root,
    locale: () => "en",
    probe: async (url) => probes.push(url) && []
  });
  hls.reset("http://media.invalid/master.m3u8?x=1");
  hls.onFirstFrame();
  clock.advance(2000);
  await tick();
  assert.equal(probes.length, 0);
  assert.equal(player.status().result, "native");
}

// 8. Addon subtitles: SubRip to WebVTT.
{
  assert.equal(
    srtToVtt("﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nBonjour\r\n"),
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nBonjour\n"
  );
  assert.equal(
    srtToVtt("WEBVTT\n\n00:01.000 --> 00:02.000\nA"),
    "WEBVTT\n\n00:01.000 --> 00:02.000\nA"
  );
}

// 9. Review fixes: audio tracks that only appear after the first image (a same-link reload)
// never switch the language; a reload puts the built-in subtitle back; "und" is not a name.
{
  assert.equal(meaningfulLabel("und"), "");
  assert.equal(meaningfulLabel("Unknown"), "");
  const clock = createClock();
  const video = fakeVideo([]);
  const player = createPlayerTracks(video, {
    root: clock.root,
    locale: () => "en",
    preferences: () => ({ audio: { language: "eng" }, targets: { audio: [], subtitles: [] } })
  });
  player.reset("http://media.invalid/d.mkv");
  video.emit("loadedmetadata"); // the TV has not listed the audio tracks yet
  player.onFirstFrame();
  const late = [
    new NativeAudioTrack("1", { language: "fre", enabled: true }),
    new NativeAudioTrack("2", { language: "eng" })
  ];
  video.audioTracks.push(...late);
  video.audioTracks.emit("addtrack");
  video.emit("loadedmetadata");
  assert.deepEqual(enabledIndexes(late), [0], "no language switch after the first image");

  const text = (id, language) => ({ id, kind: "subtitles", label: "", language, mode: "disabled" });
  video.textTracks.push(text("1", "eng"), text("2", "fre"));
  video.textTracks.emit("addtrack");
  const [, , fre] = player.subtitleEntries("builtIn");
  assert.equal(await player.selectSubtitle(fre), true);
  assert.equal(video.textTracks[1].mode, "showing");
  // Same-link reload: new in-band track objects, all disabled.
  video.textTracks.splice(0, 2, text("1", "eng"), text("2", "fre"));
  video.textTracks.emit("addtrack");
  assert.deepEqual(
    video.textTracks.map((track) => track.mode),
    ["disabled", "showing"],
    "the built-in subtitle comes back"
  );
  const [off] = player.subtitleEntries("builtIn");
  await player.selectSubtitle(off);
  video.textTracks.splice(0, 2, text("1", "eng"), text("2", "fre"));
  video.textTracks.emit("addtrack");
  assert.ok(
    video.textTracks.every((track) => track.mode === "disabled"),
    "Off stays off"
  );
  player.destroy();
}

console.log(
  "PASS: new VIDAA player tracks (getter-safe names, header order, MKV eng, preference once, revert, reload keeps choices)"
);
