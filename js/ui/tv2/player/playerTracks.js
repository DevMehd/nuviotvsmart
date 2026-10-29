// Audio and subtitle tracks of the new VIDAA player (lot P, P4): real names and the user's
// choice. Native tracks are read field by field ({...track} on a native AudioTrack gives {} and
// lost the language: audit point 5). Names: TV label, then TV language, then the file header
// (read once, 1.5 s after the first image, never in parallel), then "Audio N". The remembered
// or phone choice is applied once at loadedmetadata; never a language switch after the first
// image. Addon subtitles become a WebVTT <track> (blob URL) rendered by the TV.
import { I18n } from "../../../i18n/index.js";
import { formatAudioCodecName } from "../../../core/player/audioTrackCodecMetadata.js";
import { decodeSubtitleResponseBody } from "../../../core/player/subtitleCharsetDetector.js";
import { isAssSubtitle } from "../../../core/player/assSubtitleHelpers-01-ass-content-types.js";
import { convertAssBodyToVtt } from "../../../core/player/assSubtitleHelpers-03-convert-ass-dialogue-to-vtt-cues.js";
import { selectVidaaTextTrack } from "../../../platform/vidaa/vidaaVideo.js";

const t = (key, params = [], fallback = key) => I18n.t(key, params, { fallback });
const NO_LANGUAGE = new Set(["", "und", "unk", "unknown", "mis", "mul", "zxx", "none", "qaa"]);
const GENERIC_LABEL =
  /^(audio|track|piste|sound ?handler|subtitles?|sous-titres?|text|texte)\s*\d*$/i;
export const PROBE_DELAY_MS = 1500;

/** Base language ("fr") of a code (fr, fre, fra, fr-FR), or "" when unknown. */
export function languageKey(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (NO_LANGUAGE.has(raw) || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(raw)) return "";
  try {
    // Intl canonicalizes 639-2 codes, bibliographic ones too (fre -> fr, ger -> de).
    return new Intl.Locale(raw).language || "";
  } catch (_) {
    return raw.split("-")[0];
  }
}

/** Localized language name ("Français"), or "" for an unknown code. */
export function languageName(value, locale) {
  const code = String(value || "")
    .trim()
    .replace(/_/g, "-");
  if (!languageKey(code)) return "";
  let name = "";
  try {
    // Canonical tag first ("fre" -> "fr"): an older ICU may not name 639-2 codes itself.
    const tag = new Intl.Locale(code).baseName;
    name = new Intl.DisplayNames([locale || "en"], { type: "language" }).of(tag) || "";
  } catch (_) {}
  if (!name || name.toLowerCase() === code.toLowerCase()) return code.toUpperCase();
  return name.charAt(0).toLocaleUpperCase(locale || undefined) + name.slice(1);
}

/** A label worth showing: not "Audio 2", "SoundHandler" or a bare language code. */
export function meaningfulLabel(value) {
  const text = String(value || "").trim();
  return text && !GENERIC_LABEL.test(text) && !languageKey(text) ? text : "";
}

/** AudioTrackList / TextTrackList read field by field; null when the list is absent. */
export function readTrackList(list) {
  if (!list || typeof list.length !== "number") return null;
  const tracks = [];
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (!track) continue;
    tracks.push({
      index,
      id: String(track.id ?? ""),
      kind: String(track.kind ?? ""),
      label: String(track.label ?? ""),
      language: String(track.language ?? ""),
      enabled: Boolean(track.enabled),
      mode: String(track.mode ?? ""),
      native: track
    });
  }
  return tracks;
}

const channelText = (channels) => {
  const count = Number(channels) || 0;
  return count === 6 ? "5.1" : count === 8 ? "7.1" : count === 2 ? "2.0" : count === 1 ? "1.0" : "";
};

/**
 * Entries of the Audio panel. header: audio tracks of the file header, same order as the TV
 * (vidaaEmbeddedTextProvider). Mapped by order only when the counts match.
 * shortcut: a count mismatch stays unnamed, until the TV "count-mismatch" relevé (plan P4) says
 * which codecs the TV drops.
 */
export function buildAudioEntries(native = [], header = null, { locale } = {}) {
  const mapped = Array.isArray(header) && header.length > 0 && header.length === native.length;
  return native.map((track, index) => {
    const head = mapped ? header[index] : null;
    // A Matroska track without a language is English by the specification (audit point 10).
    const headLanguage = head
      ? head.language || (/^A_/i.test(String(head.codecId || "")) ? "eng" : "")
      : "";
    const tvLabel = meaningfulLabel(track.label);
    const tvLanguage = languageKey(track.language) ? track.language : "";
    const headName = meaningfulLabel(head?.name);
    const name =
      tvLabel ||
      languageName(tvLanguage, locale) ||
      (head ? languageName(headLanguage, locale) || headName : "");
    const codec = head ? formatAudioCodecName(head.codec || head.codecId) : "";
    const channels = head ? channelText(head.channels) : "";
    return {
      id: track.id || `audio-${index}`,
      index,
      label: name || t("player2_audio_n", [index + 1], `Audio ${index + 1}`),
      named: Boolean(name),
      source: tvLabel || tvLanguage ? "native" : name ? "header" : "",
      language: tvLanguage || headLanguage,
      secondary: [headName && headName !== name ? headName : "", codec, channels]
        .filter(Boolean)
        .join(" · "),
      selected: Boolean(track.enabled),
      nativeAudioTrack: track.native,
      track: {
        id: track.id,
        kind: track.kind,
        label: track.label,
        language: tvLanguage || headLanguage,
        enabled: Boolean(track.enabled),
        codec: head?.codec || "",
        channels: head?.channels || ""
      }
    };
  });
}

/** Privacy-safe audio-name evidence for VidaaBenchmark.noteAudioNames (categories, counts). */
export function audioNamesStatus(entries = [], header = null, probe = {}) {
  const headerCount = header?.length || Number(probe?.headerCount) || 0;
  const missing = entries.some((entry) => !entry.named);
  const mapped = entries.some((entry) => entry.source === "header");
  const result = mapped
    ? "ok"
    : !missing
      ? "native"
      : header?.length
        ? "count-mismatch"
        : probe?.result || (probe?.started ? "pending" : "probe-not-started");
  return {
    result,
    probeStarted: Boolean(probe?.started),
    headerCount,
    nativeCount: entries.length,
    namedCount: entries.filter((entry) => entry.named).length,
    mapped,
    redirected: Boolean(probe?.redirected),
    elapsedMs: Number.isFinite(probe?.elapsedMs) ? probe.elapsedMs : null,
    missing
  };
}

/** One discreet line for the Audio panel while names are missing. */
export function audioNamesLine(status) {
  if (!status?.missing) return "";
  if (status.result === "pending")
    return t("player2_audio_names_pending", [], "Track names: reading the file header…");
  if (status.result === "count-mismatch")
    return t(
      "player2_audio_names_mismatch",
      [status.nativeCount, status.headerCount],
      `Names unavailable: the TV lists ${status.nativeCount} tracks, the file declares ${status.headerCount}`
    );
  return t("player2_audio_names_missing", [status.result], `Names unavailable (${status.result})`);
}

/** Same key as the old player (playerScreenMethods-07 getTrackPreferenceContentId). */
export function trackPreferenceContentId(params = {}) {
  const itemId = String(params?.itemId || "").trim();
  if (itemId) return itemId;
  const imdb = String(params?.imdbId || params?.imdb_id || "").trim();
  if (/^tt\d+$/i.test(imdb)) return imdb;
  const type = String(params?.itemType || "movie").toLowerCase() || "movie";
  const tmdb = String(params?.tmdbId || params?.tmdb_id || "").trim();
  if (/^\d+$/.test(tmdb)) return `tmdb:${type}:${tmdb}`;
  const trakt = String(params?.traktId || params?.trakt_id || "").trim();
  return /^\d+$/.test(trakt) ? `trakt:${type}:${trakt}` : "";
}

/** Language targets of the profile settings (system, original, fixed), primary first. */
export function startupTargets(settings = {}, locale = "", params = {}) {
  const system = languageKey(locale);
  const original = languageKey(params?.contentLanguage || params?.originalLanguage);
  const resolve = (value, primary) => {
    const configured = String(value || "")
      .trim()
      .toLowerCase();
    if (!configured || ["default", "off", "none", "forced"].includes(configured)) return "";
    if (configured === "system" || configured === "device") return primary ? system : "";
    if (configured === "original") return original || (primary ? system : "");
    return languageKey(configured);
  };
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const style = settings.subtitleStyle || {};
  return {
    audio: unique([
      resolve(settings.preferredAudioLanguage || "system", true),
      resolve(settings.secondaryPreferredAudioLanguage, false)
    ]),
    // shortcut: forced-only subtitles and the secondary subtitle language are not chosen at
    // start (old player only), until the new player gets a forced-subtitle rule.
    subtitles:
      settings.subtitlesEnabled === false
        ? []
        : unique([resolve(style.preferredLanguage || settings.subtitleLanguage, true)])
  };
}

/** Index of the remembered (or phone) track, else of the first profile language; -1: keep. */
export function findAudioIndex(entries = [], { preference = null, targets = [] } = {}) {
  if (preference) {
    const language = languageKey(preference.language);
    const name = String(preference.name || "")
      .trim()
      .toLowerCase();
    const sameLanguage = (entry) => !language || languageKey(entry.language) === language;
    const byId = preference.trackId
      ? entries.findIndex((entry) => entry.id === preference.trackId && sameLanguage(entry))
      : -1;
    if (byId >= 0) return byId;
    const byName = name
      ? entries.findIndex(
          (entry) => entry.named && entry.label.toLowerCase() === name && sameLanguage(entry)
        )
      : -1;
    if (byName >= 0) return byName;
    const byLanguage = language
      ? entries.findIndex((entry) => languageKey(entry.language) === language)
      : -1;
    if (byLanguage >= 0) return byLanguage;
  }
  for (const target of targets) {
    const index = entries.findIndex((entry) => languageKey(entry.language) === target);
    if (index >= 0) return index;
  }
  return -1;
}

/** TrackPreferencesStore audio record of an entry (same fields as the old player). */
export function audioPreference(entry) {
  return {
    language: languageKey(entry?.language) || null,
    name: entry?.named ? entry.label : null,
    trackId: entry?.id || null
  };
}

/**
 * Enables one audio track: every enabled write in the same task, confirmed by "change" or a
 * read-back after confirmMs, then the video must still advance within advanceMs; otherwise the
 * previous tracks come back. Resolves true when the TV kept the track.
 */
export function enableAudioTrack(
  list,
  index,
  {
    video = null,
    root = globalThis,
    confirmMs = 250,
    advanceMs = 2000,
    isCurrent = () => true
  } = {}
) {
  if (!list?.[index]) return Promise.resolve(false);
  const previous = [];
  for (let i = 0; i < list.length; i += 1) previous.push(Boolean(list[i]?.enabled));
  const write = (flags) => {
    for (let i = 0; i < list.length; i += 1) {
      try {
        if (list[i] && list[i].enabled !== flags[i]) list[i].enabled = flags[i];
      } catch (_) {}
    }
  };
  // Every write in this task: Blink applies them as one track change, whatever the order.
  write(previous.map((_, i) => i === index));
  return new Promise((resolve) => {
    let confirmed = false;
    const revert = () => {
      if (isCurrent()) write(previous);
      resolve(false);
    };
    const confirm = () => {
      if (confirmed) return;
      confirmed = true;
      list.removeEventListener?.("change", confirm);
      root.clearTimeout(timer);
      if (!isCurrent()) return resolve(false);
      if (!list[index]?.enabled) return revert();
      if (!video || video.paused) return resolve(true);
      const start = Number(video.currentTime) || 0;
      root.setTimeout(() => {
        if (!isCurrent()) return resolve(false);
        const moved = Math.abs((Number(video.currentTime) || 0) - start) > 0.5;
        if (moved || video.paused || video.seeking) resolve(true);
        else revert();
      }, advanceMs);
    };
    list.addEventListener?.("change", confirm);
    const timer = root.setTimeout(confirm, confirmMs);
  });
}

/** SubRip to WebVTT (timestamps only; cue text stays as sent). */
export function srtToVtt(content) {
  const raw = String(content || "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n");
  if (/^\s*WEBVTT/i.test(raw)) return raw;
  const withHours = raw.replace(/(\b\d{1,2}:\d{2}:\d{2}),(\d{3}\b)/g, "$1.$2");
  return `WEBVTT\n\n${withHours.replace(/(\b\d{1,2}:\d{2}),(\d{3}\b)/g, "00:$1.$2")}`;
}

/** Addon subtitle file to WebVTT text (charset detected like the old player). */
export async function fetchSubtitleVtt(subtitle, { root = globalThis, timeoutMs = 8000 } = {}) {
  const controller = new root.AbortController();
  const timer = root.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers =
      subtitle?.headers && typeof subtitle.headers === "object" ? subtitle.headers : null;
    const response = await root.fetch(subtitle.url, {
      mode: "cors",
      credentials: "omit",
      // Custom headers must never reach a redirect target on another host.
      redirect: headers ? "error" : "follow",
      ...(headers ? { headers } : {}),
      signal: controller.signal
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const contentType = response.headers?.get?.("content-type") || "";
    const body =
      (await decodeSubtitleResponseBody(response, {
        languageHint: subtitle.lang || "",
        contentType
      })) || "";
    if (isAssSubtitle(body, { sourceUrl: subtitle.url, contentType }))
      return convertAssBodyToVtt(body);
    return srtToVtt(body);
  } finally {
    root.clearTimeout(timer);
  }
}

const SUBTITLE_KINDS = new Set(["subtitles", "captions", ""]);

/**
 * Track state of one player screen. host: preferences() -> { audio, subtitle, targets },
 * remember: { audio(pref), subtitle(pref) }, probe(url) -> header audio tracks,
 * probeDiagnostics() -> { result, headerCount, started, ... }, loadAddonSubtitles() -> list,
 * guardSwitch() (session filter of a track-switch media error), onChange(), note(status).
 */
export function createPlayerTracks(
  video,
  {
    root = globalThis,
    locale = () => I18n.getLocale?.() || "",
    preferences = () => ({ audio: null, subtitle: null, targets: { audio: [], subtitles: [] } }),
    remember = {},
    probe = async () => [],
    probeDiagnostics = () => ({}),
    loadAddonSubtitles = async () => [],
    fetchSubtitle = (subtitle) => fetchSubtitleVtt(subtitle, { root }),
    guardSwitch = () => {},
    onChange = () => {},
    note = () => {},
    probeDelayMs = PROBE_DELAY_MS
  } = {}
) {
  let generation = 0;
  let url = "";
  let header = null;
  let probing = false;
  let probeTimer = null;
  let started = false;
  let audioPrefApplied = false;
  let audioChoice = null;
  let stableChoice = null;
  let switchToken = 0;
  let subtitleDecided = false;
  let addonSubtitles = null;
  let addonSelected = "";
  let subtitleError = false;
  let audioError = false;
  let lastNote = "";
  // Addon subtitle <track> elements by subtitle id; their TextTracks are not "built-in".
  const added = new Map();
  const addedTracks = new WeakSet();
  const listen = [];

  const nativeAudio = () => readTrackList(video.audioTracks);
  const subtitleTracks = () => {
    const list = video.textTracks;
    const tracks = [];
    for (let i = 0; list && i < list.length; i += 1)
      if (list[i] && SUBTITLE_KINDS.has(String(list[i].kind || ""))) tracks.push(list[i]);
    return tracks;
  };
  const builtInTracks = () => subtitleTracks().filter((track) => !addedTracks.has(track));

  function audioEntries() {
    const native = nativeAudio();
    return native ? buildAudioEntries(native, header, { locale: locale() }) : [];
  }

  function status() {
    const diagnostics = probeDiagnostics() || {};
    return audioNamesStatus(audioEntries(), header, {
      ...diagnostics,
      started: started && (probing || Boolean(diagnostics.started) || header !== null),
      result: probing ? "pending" : diagnostics.result
    });
  }

  function report() {
    const current = status();
    const key = JSON.stringify(current);
    if (key !== lastNote) {
      lastNote = key;
      note(current);
    }
    return current;
  }

  function writeChoice(list, index) {
    for (let i = 0; i < list.length; i += 1) {
      try {
        if (list[i].enabled !== (i === index)) list[i].enabled = i === index;
      } catch (_) {}
    }
  }

  function onMetadata() {
    const list = video.audioTracks;
    if (list?.length) {
      if (!audioPrefApplied) {
        audioPrefApplied = true;
        const prefs = preferences() || {};
        const index = findAudioIndex(audioEntries(), {
          preference: prefs.audio,
          targets: prefs.targets?.audio || []
        });
        if (index >= 0) audioChoice = stableChoice = index;
      }
      // A same-link reload starts on the file default: the chosen track comes back.
      if (audioChoice !== null && list[audioChoice] && !list[audioChoice].enabled)
        writeChoice(list, audioChoice);
    }
    applySubtitlePreference();
    onChange();
  }

  function onTracksChanged() {
    applySubtitlePreference();
    onChange();
  }

  function subtitleMatches(track, preference, language) {
    const name = String(preference?.name || "")
      .trim()
      .toLowerCase();
    if (preference?.trackId && String(track.id || "") === preference.trackId) return true;
    if (name && String(track.label || "").toLowerCase() === name) return true;
    return Boolean(language) && languageKey(track.language) === language;
  }

  function addonMatches(subtitle, preference, language) {
    if (preference?.addonUrl && subtitle.url === preference.addonUrl) return true;
    if (preference?.addonId && subtitle.id === preference.addonId) return true;
    return (
      Boolean(language) &&
      languageKey(subtitle.lang) === language &&
      (!preference?.addonName || preference.addonName === subtitle.addonName)
    );
  }

  // Once per source: phone, then title, then profile language; built-in tracks first.
  function applySubtitlePreference() {
    if (subtitleDecided) return;
    const prefs = preferences() || {};
    const preference = prefs.subtitle || null;
    if (preference?.type === "DISABLED") {
      subtitleDecided = true;
      selectVidaaTextTrack(subtitleTracks(), -1, { getTracks: subtitleTracks });
      return;
    }
    const targets = preference?.language
      ? [languageKey(preference.language)]
      : preference
        ? []
        : prefs.targets?.subtitles || [];
    const builtIn = builtInTracks();
    if (preference?.type !== "ADDON") {
      for (const language of targets.length ? targets : [""]) {
        const track = builtIn.find((item) => subtitleMatches(item, preference, language));
        if (track) {
          subtitleDecided = true;
          void selectBuiltIn(track);
          return;
        }
      }
    }
    if (!addonSubtitles) return;
    subtitleDecided = true;
    for (const language of targets.length ? targets : [""]) {
      const subtitle = addonSubtitles.find((item) => addonMatches(item, preference, language));
      if (subtitle) {
        void selectAddon(subtitle);
        return;
      }
    }
  }

  function selectBuiltIn(track) {
    addonSelected = "";
    subtitleError = false;
    const tracks = subtitleTracks();
    return selectVidaaTextTrack(tracks, tracks.indexOf(track), { getTracks: subtitleTracks });
  }

  async function selectAddon(subtitle) {
    const current = generation;
    addonSelected = subtitle.id;
    subtitleError = false;
    onChange();
    let element = added.get(subtitle.id);
    if (!element) {
      let vtt;
      try {
        vtt = await fetchSubtitle(subtitle);
      } catch (error) {
        console.warn("[player2] subtitle fetch failed", error?.name || "");
      }
      if (current !== generation || addonSelected !== subtitle.id) return false;
      if (!vtt) {
        addonSelected = "";
        subtitleError = true;
        onChange();
        return false;
      }
      element = root.document.createElement("track");
      element.kind = "subtitles";
      element.label = subtitle.addonName || "";
      element.srclang = languageKey(subtitle.lang) || "";
      element.src = root.URL.createObjectURL(new root.Blob([vtt], { type: "text/vtt" }));
      video.appendChild(element);
      added.set(subtitle.id, element);
      addedTracks.add(element.track);
    }
    const tracks = subtitleTracks();
    const ok = await selectVidaaTextTrack(tracks, tracks.indexOf(element.track), {
      getTracks: subtitleTracks,
      isCurrent: () => current === generation && addonSelected === subtitle.id
    });
    onChange();
    return ok;
  }

  function removeAdded() {
    for (const element of added.values()) {
      try {
        if (element.track) element.track.mode = "disabled";
        root.URL.revokeObjectURL(element.src);
        element.remove();
      } catch (_) {}
    }
    added.clear();
  }

  function runProbe() {
    const native = nativeAudio();
    if (probing || !url || !native?.length || /\.(m3u8|mpd)(\?|#|$)/i.test(url)) return;
    // The TV already names every track: no request to the media host.
    if (audioEntries().every((entry) => entry.source === "native")) return report();
    probing = true;
    const current = generation;
    onChange();
    Promise.resolve()
      .then(() => probe(url))
      .then(
        (tracks) => {
          if (current === generation && Array.isArray(tracks) && tracks.length) header = tracks;
        },
        () => {}
      )
      .finally(() => {
        if (current !== generation) return;
        probing = false;
        report();
        onChange();
      });
  }

  for (const [target, type, handler] of [
    [video, "loadedmetadata", onMetadata],
    [video.audioTracks, "addtrack", onTracksChanged],
    [video.audioTracks, "removetrack", onTracksChanged],
    [video.textTracks, "addtrack", onTracksChanged],
    [video.textTracks, "removetrack", onTracksChanged]
  ]) {
    if (!target?.addEventListener) continue;
    target.addEventListener(type, handler);
    listen.push(() => target.removeEventListener(type, handler));
  }

  return {
    /** New source: forgets the previous header, choices and addon tracks. */
    reset(nextUrl = "") {
      generation += 1;
      switchToken += 1;
      url = String(nextUrl || "");
      header = null;
      probing = false;
      started = false;
      if (probeTimer !== null) root.clearTimeout(probeTimer);
      probeTimer = null;
      audioPrefApplied = false;
      audioChoice = stableChoice = null;
      subtitleDecided = false;
      addonSubtitles = null;
      addonSelected = "";
      subtitleError = audioError = false;
      lastNote = "";
      removeAdded();
    },
    /** First image of the source (idempotent): header probe at +1.5 s, addon subtitle list. */
    onFirstFrame() {
      if (started) return;
      started = true;
      const current = generation;
      probeTimer = root.setTimeout(() => {
        probeTimer = null;
        if (current === generation) runProbe();
      }, probeDelayMs);
      Promise.resolve()
        .then(() => loadAddonSubtitles())
        .then(
          (list) => list,
          () => []
        )
        .then((list) => {
          if (current !== generation) return;
          addonSubtitles = Array.isArray(list) ? list.filter((item) => item?.url) : [];
          const handoff = preferences()?.subtitle;
          // A file sent by the phone ("Envoyer à la TV") is offered like an addon subtitle.
          if (
            handoff?.type === "ADDON" &&
            handoff.addonUrl &&
            !addonSubtitles.some((item) => item.url === handoff.addonUrl)
          )
            addonSubtitles.unshift({
              id: "handoff",
              url: handoff.addonUrl,
              lang: handoff.language || "",
              addonName: t("player2_subtitle_phone", [], "Phone")
            });
          applySubtitlePreference();
          onChange();
        });
    },
    /** Opening Audio: a transient header failure is read again (the provider spaces retries). */
    probeAgain() {
      if (started && probeTimer === null) runProbe();
      return report();
    },
    get supported() {
      return Boolean(video.audioTracks);
    },
    get probing() {
      return probing;
    },
    get audioError() {
      return audioError;
    },
    get subtitleError() {
      return subtitleError;
    },
    get addonSubtitlesLoaded() {
      return addonSubtitles !== null;
    },
    get selectedAddonSubtitleId() {
      return addonSelected;
    },
    audioEntries,
    status,
    report,
    async selectAudio(index, { rememberSelection = false } = {}) {
      const list = video.audioTracks;
      const entries = audioEntries();
      if (!list || !entries[index]) return false;
      const token = ++switchToken;
      const current = generation;
      audioChoice = index;
      audioError = false;
      guardSwitch();
      onChange();
      const ok = await enableAudioTrack(list, index, {
        video,
        root,
        isCurrent: () => token === switchToken && current === generation
      });
      if (token !== switchToken || current !== generation) return ok;
      if (ok) {
        stableChoice = index;
        if (rememberSelection) remember.audio?.(audioPreference(entries[index]));
      } else {
        audioChoice = stableChoice;
        audioError = true;
      }
      onChange();
      return ok;
    },
    /** The session reloads after a media error during a switch: back to the last kept track. */
    revertAudio() {
      switchToken += 1;
      audioChoice = stableChoice;
      audioError = true;
      onChange();
    },
    /** kind "builtIn" (with the Off entry first) or "addons". */
    subtitleEntries(kind = "builtIn") {
      const showing = subtitleTracks().find((track) => track.mode === "showing");
      if (kind === "addons")
        return (addonSubtitles || []).map((subtitle) => ({
          id: subtitle.id,
          label: languageName(subtitle.lang, locale()) || subtitle.lang || "?",
          secondary: subtitle.addonName || "",
          language: subtitle.lang || "",
          selected: addonSelected === subtitle.id,
          subtitle
        }));
      const entries = builtInTracks().map((track, index) => {
        const name = meaningfulLabel(track.label) || languageName(track.language, locale()) || "";
        return {
          id: String(track.id || `builtin-${index}`),
          label: name || t("player2_subtitle_n", [index + 1], `Subtitles ${index + 1}`),
          secondary: meaningfulLabel(track.label) ? languageName(track.language, locale()) : "",
          language: track.language || "",
          selected: !addonSelected && track === showing,
          textTrack: track,
          track: { id: track.id, label: track.label, language: track.language, codec: "" }
        };
      });
      return [
        {
          id: "off",
          label: t("subtitle_off", [], "Off"),
          secondary: "",
          selected: !showing && !addonSelected
        },
        ...entries
      ];
    },
    /** entry: one of subtitleEntries(); "off" disables every output. */
    async selectSubtitle(entry, { rememberSelection = false } = {}) {
      if (!entry) return false;
      subtitleDecided = true;
      let ok;
      let preference;
      if (entry.subtitle) {
        ok = await selectAddon(entry.subtitle);
        preference = {
          type: "ADDON",
          language: languageKey(entry.subtitle.lang) || null,
          addonId: entry.subtitle.id === "handoff" ? null : entry.subtitle.id,
          addonName: entry.subtitle.addonName || null
        };
      } else if (entry.textTrack) {
        ok = await selectBuiltIn(entry.textTrack);
        preference = {
          type: "INTERNAL",
          language: languageKey(entry.language) || null,
          name: meaningfulLabel(entry.textTrack.label) || null,
          trackId: entry.textTrack.id || null
        };
      } else {
        addonSelected = "";
        subtitleError = false;
        ok = await selectVidaaTextTrack(subtitleTracks(), -1, { getTracks: subtitleTracks });
        preference = { type: "DISABLED" };
      }
      if (ok && rememberSelection) remember.subtitle?.(preference);
      onChange();
      return ok;
    },
    destroy() {
      this.reset();
      for (const off of listen.splice(0)) off();
    }
  };
}
