// VIDAA: why the Audio panel shows "Audio N" instead of the track names, as privacy-safe
// evidence (categories and counts only, never the stream URL, host or token).
import { localMediaEmbeddedSubtitleRepository } from "../../../data/repository/localMediaEmbeddedSubtitleRepository.js";
import { PlayerController } from "../../../core/player/playerController.js";
import { VidaaBenchmark } from "../../../core/diagnostics/vidaaBenchmark.js";
import {
  getMeaningfulTrackLabel,
  getUsableAudioTrackLanguageValue
} from "./playerScreenHelpers-05-normalize-track-language-code.js";

const REASONS = {
  ok: "correspondance incertaine entre les pistes de la TV et du fichier",
  "no-audio": "le fichier ne déclare aucune piste audio",
  cors: "le serveur bloque la lecture depuis l’application (CORS ou réseau)",
  "cors-headers": "le serveur masque la taille du fichier (CORS)",
  "range-refused": "le serveur refuse la lecture partielle",
  "http-4xx": "accès refusé par le serveur (HTTP 4xx)",
  "http-5xx": "erreur du serveur (HTTP 5xx)",
  timeout: "le serveur répond trop lentement",
  "not-matroska-or-mp4": "fichier ni MKV ni MP4",
  "bad-response": "réponse partielle incohérente du serveur",
  budget: "limite de lecture atteinte",
  superseded: "lecture interrompue par un changement de source",
  parse: "en-tête du fichier illisible",
  hls: "flux HLS, noms fournis par le flux seulement",
  dash: "flux DASH, noms fournis par le flux seulement",
  engine: "lecteur non natif",
  container: "format de fichier non lu",
  "probe-not-started": "lecture de l’en-tête non lancée"
};

const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;

/** One discreet French line for the Audio panel, only while names are missing. */
export function describeVidaaAudioNamesStatus(status) {
  if (!status?.missing) return "";
  if (status.result === "pending") return "Noms des pistes : lecture de l’en-tête en cours…";
  if (status.result === "count-mismatch")
    return `Noms indisponibles : la TV liste ${plural(status.nativeCount, "piste")}, le fichier en déclare ${status.headerCount}`;
  const reason = REASONS[status.result] || REASONS.parse;
  return `Noms indisponibles : ${reason} (${plural(status.nativeCount, "piste")} TV, ${plural(status.headerCount, "lue")})`;
}

function notStartedReason(screen) {
  const native = PlayerController.isUsingNativePlayback?.() === true;
  if (!native || screen.isCurrentSourceAdaptiveManifest()) {
    if (screen.isCurrentSourceLikelyDash()) return "dash";
    if (screen.isCurrentSourceLikelyHls()) return "hls";
    return native ? "hls" : "engine";
  }
  return screen.getTrackProbeUrl() ? "container" : "probe-not-started";
}

const isMapped = (entry) => Number.isFinite(Number(entry?.track?.embeddedTrackIndex ?? NaN));
const hasOwnName = (track) =>
  Boolean(getMeaningfulTrackLabel(track) || getUsableAudioTrackLanguageValue(track));

export function readVidaaAudioNamesStatus(screen) {
  const nativeEntries = screen.getAudioEntries().filter((entry) => entry.nativeAudioTrack);
  const nativeCount = screen.getAudioTracks().length;
  const embeddedCount = (screen.embeddedAudioTracks || []).length;
  const canProbe = screen.canDiscoverEmbeddedAudioTracks();
  const probe =
    (canProbe && localMediaEmbeddedSubtitleRepository.getVidaaDiagnostics().audio) || {};
  let result = !canProbe
    ? notStartedReason(screen)
    : embeddedCount
      ? "ok"
      : probe.result || (screen.embeddedAudioLoading ? "pending" : "probe-not-started");
  const headerCount = embeddedCount || Number(probe.headerCount) || 0;
  // The guard in mergeEmbeddedAudioTrackMetadata leaves "Audio N" when the counts differ.
  if (result === "ok" && nativeCount && headerCount !== nativeCount) result = "count-mismatch";
  const namedCount = nativeEntries.filter(isMapped).length;
  return {
    result,
    probeStarted: Boolean(probe.started || embeddedCount),
    headerCount,
    nativeCount,
    mapped: namedCount > 0,
    namedCount,
    redirected: Boolean(probe.redirected),
    elapsedMs: Number.isFinite(probe.elapsedMs) ? probe.elapsedMs : null,
    missing: nativeEntries.some((entry) => !isMapped(entry) && !hasOwnName(entry.nativeAudioTrack))
  };
}

/** Debug console (once per playback and status) and the guided diagnostic video step. */
export function reportVidaaAudioNamesStatus(screen) {
  const status = readVidaaAudioNamesStatus(screen);
  VidaaBenchmark.noteAudioNames(status);
  if (status.result === "pending" || !status.nativeCount) return status;
  const key = [
    screen.sourcePlaybackAttemptToken,
    status.result,
    status.headerCount,
    status.nativeCount,
    status.namedCount
  ].join("|");
  if (screen.vidaaAudioNamesLogKey !== key) {
    screen.vidaaAudioNamesLogKey = key;
    console.warn(
      `VIDAA audio names: ${status.result} | probe ${status.probeStarted ? "started" : "not started"} | header ${status.headerCount} / TV ${status.nativeCount} | named ${status.namedCount} | redirect ${status.redirected ? "followed" : "no"} | ${status.elapsedMs ?? "?"} ms`
    );
  }
  return status;
}
