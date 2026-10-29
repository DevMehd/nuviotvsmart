import {
  BENCHMARK_STEPS,
  VidaaBenchmark,
  describeTrigger
} from "../../../core/diagnostics/vidaaBenchmark.js";
import { createVidaaBenchmarkDriver } from "../../../core/diagnostics/vidaaBenchmarkDriver.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";

const escape = (value) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
const number = (value, suffix = "") =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}${suffix}`
    : "non disponible";
const ms = (value) => number(value, " ms");
const mb = (value) =>
  typeof value === "number" ? number(value / 1048576, " Mio") : "non disponible";
const row = (label, value) =>
  `<div class="benchmark-row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const bool = (value) => (value ? "oui" : "non disponible");
// Escaped by row(); categories and counts only (see vidaaAudioNamesStatus.js).
const describeAudioNames = (audio) =>
  audio
    ? `${audio.result} · ${audio.namedCount}/${audio.nativeCount} nommées · en-tête ${audio.headerCount}${audio.redirected ? " · redirection suivie" : ""}${audio.elapsedMs === null ? "" : ` · ${audio.elapsedMs} ms`}`
    : "non relevé";
const labelFor = (id) =>
  BENCHMARK_STEPS.find((step) => step.id === id)?.title || "Démarrage instrumenté";
const PAGES = [
  "Résumé",
  "Télé et démarrage",
  "Réactivité",
  "Images et mémoire",
  "Réseau et serveur",
  "Vidéo et limites",
  "Journal du parcours"
];
const EXPORT_ENDPOINT = "/api/diagnostic-report";
const EXPORT_REFRESH_MS = 20000;
const EXPORT_REFRESH_LIMIT_MS = 30 * 60 * 1000;
const EXPORT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
let sharedDriver = null;

// 100 random bits, base32: unguessable, yet typeable from a photo of the TV.
export function createExportId(root = globalThis) {
  const bytes = new Uint8Array(20);
  try {
    root.crypto.getRandomValues(bytes);
  } catch (_) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let i = 0; i < bytes.length; i += 1) id += EXPORT_ID_ALPHABET[bytes[i] % 32];
  return id;
}

const nextStepFor = (report) =>
  BENCHMARK_STEPS.find(
    (step) =>
      !report.steps.some(
        (result) => result.id === step.id && ["complete", "skipped"].includes(result.status)
      )
  );

export function renderBenchmarkPage(state, page, selected, driverState = {}) {
  const { report } = state;
  const steps = report.steps.filter((step) => step.status !== "skipped");
  const current =
    state.current || steps.find((step) => step.id === selected) || steps[steps.length - 1];
  const env = report.environment;
  const title = current
    ? `${labelFor(current.id)} · ${number(current.elapsedMs / 1000, " s mesurées")}`
    : "Aucune étape mesurée";
  const heading = `<h2>${escape(PAGES[page])}</h2><p class="benchmark-subtitle">${escape(page > 1 ? title : "Parcours guidé · protocole 1 · résultats locaux")}</p>`;
  if (page === 0) {
    const next = nextStepFor(report);
    let message;
    if (driverState.active)
      message = `Parcours automatique en cours · étape ${driverState.stepIndex}/${driverState.total} : ${labelFor(driverState.stepId)}. Ne touchez pas la télécommande, une touche interrompt le parcours.`;
    else if (state.active && state.current?.waiting)
      message = `${labelFor(state.current.id)} : le chrono démarre ${describeTrigger(BENCHMARK_STEPS.find((step) => step.id === state.current.id)?.trigger)}. La console est exclue des mesures.`;
    else if (state.active)
      message = `En cours : ${labelFor(state.current.id)}. Revenez à l’accueil pour poursuivre ; la console est exclue des mesures.`;
    else if (driverState.outcome === "cancelled")
      message = `Parcours automatique interrompu${driverState.reason ? ` (${driverState.reason})` : ""}. Relancez-le pour les étapes restantes ou poursuivez en manuel.`;
    else if (driverState.outcome === "error")
      message =
        "Le parcours automatique s’est arrêté sur une erreur. Relancez-le ou poursuivez en manuel.";
    else if (next)
      message = `Prochaine étape : ${next.title}. En manuel, le chrono démarre ${describeTrigger(next.trigger)}. ${next.help}`;
    else
      message = "Parcours terminé. Exportez le JSON par code QR ou consultez les pages du bilan.";
    return (
      heading +
      `<p>${escape(message)}</p>` +
      BENCHMARK_STEPS.map((step) => {
        const result = report.steps.find((item) => item.id === step.id);
        const quality = !result
          ? `${step.seconds} s`
          : result.status === "skipped"
            ? "non effectuée"
            : result.status === "incomplete"
              ? `incomplète${result.auto ? " · automatique" : ""} · ${result.note || "écran attendu non atteint"}`
              : `${result.status === "complete" ? "terminée" : "interrompue"}${result.auto ? " · automatique" : ""} · ${result.coverage ? "écran attendu visité" : "écran attendu peu ou pas visité"}`;
        return row(step.title, quality);
      }).join("") +
      `<p class="benchmark-note">Parcours automatique : la télé navigue seule (accueil, fiches, liens vidéo, lecture) ; posez la télécommande. Même profil et mêmes contenus pour comparer deux versions. Démarrage : test séparé, à armer ci-dessus. Aucun score global artificiel.</p>`
    );
  }
  if (page === 1) {
    const boot = report.startup;
    return (
      heading +
      row(
        "Modèle déclaré / détecté",
        `${env.declaredModel} / ${env.detectedModel || "non disponible"}`
      ) +
      row("Nuvio / version du fichier", `${env.version} / ${env.build || "non disponible"}`) +
      row("Moteur du navigateur", `Chromium ${env.chromium || "?"} · WebKit ${env.webkit || "?"}`) +
      row(
        "Interface / écran rapportés",
        `${env.viewport.join(" × ")} / ${env.screen.join(" × ")}`
      ) +
      row("Firmware déclaré / mode", `${env.declaredFirmware || "?"} / ${env.performanceMode}`) +
      row(
        "Cœurs logiques / mémoire indicative exposés",
        `${env.logicalCoresReported ?? "?"} / ${env.approximateDeviceMemoryGiB ?? "?"} Gio`
      ) +
      row(
        "Worker / animations / décodage image",
        `${bool(env.capabilities.worker)} / ${bool(env.capabilities.webAnimations)} / ${bool(env.capabilities.imageDecode)}`
      ) +
      row(
        "Document reçu / DOM interactif",
        `${ms(boot.documentMs)} / ${ms(boot.domInteractiveMs)}`
      ) +
      row("Premier montage de l’accueil", ms(boot.firstHomeMountedMs)) +
      row(
        "Premier contenu peint / chargement document",
        `${ms(boot.firstContentfulPaintMs)} / ${ms(boot.loadMs)}`
      ) +
      `<p class="benchmark-note">Temps depuis l’ouverture de la page, pas depuis l’allumage de la TV. Le premier contenu peint peut être l’écran de chargement. Le démarrage instrumenté inclut la sélection du profil et le changelog.</p>`
    );
  }
  if (page === 6) {
    const entries = Array.isArray(report.driverJournal) ? report.driverJournal : [];
    return (
      heading +
      (entries.length
        ? `<p>Décisions du parcours automatique, sans aucun titre ni identifiant.</p>${entries
            .map((entry) => `<div class="benchmark-row"><span>${escape(entry)}</span></div>`)
            .join("")}`
        : "<p>Aucun parcours automatique enregistré pour ce build.</p>")
    );
  }
  if (!current)
    return (
      heading +
      "<p>Lancez une étape pour obtenir les mesures. Une fonction non exposée par la télé reste indiquée comme indisponible.</p>"
    );
  if (page === 2) {
    const f = current.frame,
      input = current.input;
    const percent = (count) => (f.count ? number((count * 100) / f.count, " %") : "—");
    return (
      heading +
      row("Intervalles navigateur mesurés", f.count) +
      row("Cadence : médiane / p95 / p99", `${ms(f.p50Ms)} / ${ms(f.p95Ms)} / ${ms(f.p99Ms)}`) +
      row("Plus long intervalle", ms(f.maxMs)) +
      row(
        "Au-delà de 16,7 / 33,3 ms (+1 ms)",
        `${percent(current.over17)} / ${percent(current.over34)}`
      ) +
      row(
        "Intervalles >50 / >100 ms · erreurs JS",
        `${current.over50} / ${current.over100} · ${current.scriptErrors || 0}`
      ) +
      row(
        "Touche → prochain callback : p95 / échantillons",
        `${ms(input.p95Ms)} / ${input.count}`
      ) +
      row(
        "Retard de la boucle JS : p95 / max",
        `${ms(current.eventLoop.p95Ms)} / ${ms(current.eventLoop.maxMs)}`
      ) +
      row(
        "Tâches longues / temps au-delà de 50 ms",
        current.longTasksSupported
          ? `${current.longTaskCount} / ${ms(current.blockingMs)}`
          : "API non disponible"
      ) +
      row(
        "Ouvertures d’écrans : p95 / nombre",
        `${ms(current.routeMount.p95Ms)} / ${current.routeMount.count}`
      ) +
      `<p class="benchmark-note">p95 : 95 % des échantillons sont inférieurs à cette durée. Les ouvertures mesurent le montage de l’écran, pas la fin de toutes ses images. Ces chiffres ne sont pas les FPS réellement affichés.</p>`
    );
  }
  if (page === 3)
    return (
      heading +
      row("Éléments d’interface : pic", current.surface.peakNodes) +
      row(
        "Images présentes / chargées : pics",
        `${current.images.peakElements} / ${current.images.peakLoaded}`
      ) +
      row(
        "Images : chargements / erreurs observés",
        `${current.images.loads} / ${current.images.errors}`
      ) +
      row(
        "Pixels naturels des images : pic",
        number(current.images.peakNaturalPixels / 1e6, " millions")
      ) +
      row(
        "Mémoire JS : début / fin",
        `${mb(current.surface.heapStartBytes)} / ${mb(current.surface.heapEndBytes)}`
      ) +
      row("Mémoire JS : pic", mb(current.surface.heapPeakBytes)) +
      row(
        "Coût du relevé interface : p95 / max",
        `${ms(current.overhead.p95Ms)} / ${ms(current.overhead.maxMs)}`
      ) +
      row(
        "Relevés / interruptions de visibilité",
        `${current.surface.samples} / ${current.hiddenCount}`
      ) +
      `<p class="benchmark-note">Relevé toutes les 2 secondes, sans calcul de positions. Les pixels cumulés ne mesurent ni les textures GPU ni la RAM réelle. Les images en arrière-plan CSS ne sont pas des éléments IMG.</p>`
    );
  if (page === 4) {
    const resources = Object.entries(current.network);
    return (
      heading +
      `<p>Ressources du navigateur : ${current.resourceTimingSupported ? "observation disponible" : "API non disponible"}. Les durées comprennent l’attente et le transfert.</p>` +
      resources
        .map(([kind, value]) =>
          row(
            `${kind} · ${value.count} requêtes · p95`,
            `${ms(value.duration.p95Ms)} · ${mb(value.knownBytes)} connus · ${value.restrictedOrUnknown} tailles inconnues/nulles`
          )
        )
        .join("") +
      row(
        "Vercel : succès / échecs / annulations",
        `${current.addon.success} / ${current.addon.failed} / ${current.addon.aborted}`
      ) +
      row(
        "Cache Vercel : HIT / MISS / partagé",
        `${current.addon.hits} / ${current.addon.misses} / ${current.addon.shared}`
      ) +
      row(
        "Vercel : durée moyenne, lecture JSON incluse",
        current.addon.requests
          ? ms(current.addon.durationMs / current.addon.requests)
          : "aucune requête mesurée"
      ) +
      `<p class="benchmark-note">Aucune URL conservée. Une taille nulle ne prouve pas un cache local. Le cache de l’application peut éviter toute requête ; une annulation peut venir du chemin direct concurrent.</p>`
    );
  }
  const video = current.video;
  return (
    heading +
    row("Lecture observée (estimation par sondage)", number(video.playingSampleMs / 1000, " s")) +
    row("Première lecture depuis le début de l’étape", ms(video.firstPlayingMs)) +
    row(
      "Définition vidéo rapportée",
      video.width && video.height ? `${video.width} × ${video.height}` : "non disponible"
    ) +
    row(
      "Images vidéo : total / abandonnées",
      video.qualitySupported
        ? `${video.totalFrames} / ${video.droppedFrames}`
        : "API non disponible"
    ) +
    row(
      "Attentes du lecteur : nombre / durée observée",
      `${video.waitingEvents} / ${ms(video.waitingMs)}`
    ) +
    row("Avances/reculs / erreurs du lecteur", `${video.seekEvents} / ${video.errors}`) +
    row("Tampon disponible : dernier relevé", number(video.bufferAheadSeconds, " s")) +
    row("Noms des pistes audio", describeAudioNames(video.audioNames)) +
    `<p class="benchmark-note">Les attentes peuvent inclure le démarrage et les déplacements dans la vidéo. Le délai depuis l’étape inclut votre navigation. Son, synchro et sous-titres sont à juger à l’œil et à l’oreille.</p><p class="benchmark-note">${escape(report.limitations.join(". "))}. Aucun identifiant, titre, URL, touche saisie ou jeton conservé. Le bilan reste sur cet appareil.</p>`
  );
}

export function renderExportView(exportState) {
  const heading = "<h2>Récupérer le JSON</h2>";
  if (exportState.status === "uploading")
    return `${heading}<p class="benchmark-subtitle">Envoi du bilan au serveur Nuvio…</p>`;
  if (exportState.status === "error")
    return `${heading}<p class="benchmark-subtitle">Export impossible</p><p>Le serveur n’a pas accepté le bilan (${escape(exportState.error || "erreur inconnue")}). Vérifiez la connexion de la télé puis choisissez « Nouveau lien ».</p>`;
  if (exportState.status === "expired")
    return `${heading}<p class="benchmark-subtitle">Lien expiré</p><p>Ce lien n’est plus valable. Choisissez « Nouveau lien » pour afficher un nouveau code.</p>`;
  return `${heading}<p class="benchmark-subtitle">Scannez le code avec votre téléphone : le bilan JSON s’ouvre dans le navigateur, prêt à être enregistré ou partagé.</p><div class="benchmark-qr"><div class="benchmark-qr-code"><canvas width="480" height="480" aria-label="Code QR du bilan"></canvas></div><div class="benchmark-qr-copy"><p class="benchmark-qr-url">${escape(exportState.url)}</p><p class="benchmark-note">${escape(
    exportState.durable
      ? "Lien durable : le bilan est conservé sur le stockage du projet."
      : "Lien valable 30 minutes. Laissez ce code affiché : la télé renvoie le bilan toutes les 20 secondes pour que le téléphone le retrouve."
  )} Aucun identifiant, titre, URL privée ni jeton dans le fichier.</p><p class="benchmark-note benchmark-qr-fallback" hidden>Code QR indisponible sur cette télé : saisissez l’adresse ci-dessus.</p></div></div>`;
}

export function createVidaaBenchmarkPanel({
  router,
  onLogs,
  service = VidaaBenchmark,
  driver = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  location = globalThis.location
}) {
  let container = null,
    page = 0,
    selected = null,
    focus = "auto",
    view = "report",
    exportState = { status: "idle" },
    refreshTimer = null,
    unsubscribe = null,
    unsubscribeDriver = null;
  if (!driver) {
    if (!sharedDriver) sharedDriver = createVidaaBenchmarkDriver({ service, router });
    driver = sharedDriver;
  }
  const buttons = () => [...(container?.querySelectorAll("[data-benchmark-action]") || [])];
  const focusCurrent = () => {
    for (const button of buttons())
      button.classList.toggle("focused", button.dataset.benchmarkAction === focus);
    const target =
      buttons().find((button) => button.dataset.benchmarkAction === focus) || buttons()[0];
    try {
      target?.focus({ preventScroll: true });
    } catch (_) {
      target?.focus();
    }
  };
  const clearRefresh = () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  };
  const closeExport = () => {
    clearRefresh();
    view = "report";
    exportState = { status: "idle" };
    focus = "export";
  };
  function drawQr() {
    if (view !== "qr" || exportState.status !== "ready") return;
    const canvas = container?.querySelector(".benchmark-qr canvas");
    const fallback = container?.querySelector(".benchmark-qr-fallback");
    try {
      if (typeof globalThis.qrcode !== "function") throw new Error("qrcode library unavailable");
      QrCodeGenerator.generate(canvas, exportState.url, 480);
    } catch (_) {
      if (canvas) canvas.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }
  function render() {
    if (!container) return;
    const state = service.getState();
    const driverState = driver.getState();
    const next = nextStepFor(state.report);
    const button = (id, text) =>
      `<button class="debug-console-capture focusable" data-benchmark-action="${id}">${escape(text)}</button>`;
    const status = driverState.active
      ? `Parcours automatique en cours · étape ${driverState.stepIndex}/${driverState.total}`
      : state.active
        ? state.current?.waiting
          ? "Étape manuelle armée · le chrono démarre à votre première action"
          : "Mesure en cours · console exclue"
        : state.startupArmed
          ? "Prochain démarrage armé : quittez puis relancez Nuvio"
          : "Arrêté · lancez le parcours automatique ou une étape manuelle";
    const actions =
      view === "qr"
        ? `<nav class="benchmark-actions">${button("close-export", "Fermer")}${button("export", "Nouveau lien")}</nav>`
        : `<nav class="benchmark-actions">${button("back", "Retour")}${button("auto", driverState.active ? "Arrêter le parcours" : next ? "Parcours automatique" : "Refaire le parcours automatique")}${button("next", state.active ? "Arrêter l’étape" : next ? `Étape manuelle : ${next.title}` : "Refaire en manuel")}${button("boot", "Mesurer le prochain démarrage")}${button("skip", "Passer la vidéo")}${button("logs", "Journal")}</nav><nav class="benchmark-actions">${button("previous-page", "← Page")}${button("next-page", "Page →")}${button("step", "Changer l’étape affichée")}${button("comparison", "Comparer les moteurs")}${button("export", "Exporter JSON (code QR)")}</nav>`;
    const main =
      view === "qr"
        ? renderExportView(exportState)
        : renderBenchmarkPage(state, page, selected, driverState);
    const footer =
      view === "qr"
        ? "Retour : fermer · Le bilan reste aussi enregistré localement."
        : `${page + 1}/${PAGES.length} · Flèches : boutons · OK : choisir · Le bilan est enregistré localement${state.storageAvailable ? "" : " — stockage indisponible : photographiez-le"}.`;
    container.innerHTML = `<div class="debug-console-shell vidaa-benchmark-shell"><header><h1>Diagnostic guidé Nuvio</h1><p>${escape(status)}</p></header>${actions}<main class="benchmark-report">${main}</main><footer>${escape(footer)}</footer></div>`;
    drawQr();
    focusCurrent();
  }
  async function postReport(id, reportText) {
    const response = await fetchImpl(EXPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"id":${JSON.stringify(id)},"report":${reportText}}`
    });
    if (!response?.ok) throw new Error(`http ${response?.status || "?"}`);
    return response.json();
  }
  function scheduleRefresh(id, reportText) {
    clearRefresh();
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      if (view !== "qr" || exportState.status !== "ready" || exportState.id !== id) return;
      if (Date.now() - exportState.startedAt > EXPORT_REFRESH_LIMIT_MS) {
        exportState = { status: "expired", id };
        render();
        return;
      }
      try {
        await postReport(id, reportText);
      } catch (_) {
        /* The next refresh retries; the phone page also reloads itself. */
      }
      scheduleRefresh(id, reportText);
    }, EXPORT_REFRESH_MS);
  }
  async function exportReport() {
    clearRefresh();
    const id = createExportId();
    const reportText = JSON.stringify(service.getState().report);
    view = "qr";
    focus = "close-export";
    exportState = { status: "uploading", id };
    render();
    let data;
    try {
      data = await postReport(id, reportText);
    } catch (error) {
      if (view !== "qr" || exportState.id !== id) return;
      exportState = { status: "error", id, error: String(error?.message || error) };
      render();
      return;
    }
    if (view !== "qr" || exportState.id !== id) return;
    // The phone must reach the same origin the TV loaded the app from.
    const origin = String(location?.origin || "").replace(/\/$/, "");
    const path =
      typeof data?.path === "string" && /^\/d\/[a-z2-7]+$/.test(data.path) ? data.path : `/d/${id}`;
    exportState = {
      status: "ready",
      id,
      url: origin
        ? `${origin}${path}`
        : typeof data?.url === "string" && /^https?:\/\//.test(data.url)
          ? data.url
          : path,
      durable: data?.durable === true,
      startedAt: Date.now()
    };
    if (!exportState.durable) scheduleRefresh(id, reportText);
    render();
  }
  async function activate(action) {
    const state = service.getState();
    if (action === "back") {
      await router.back();
      return;
    }
    if (action === "comparison") {
      if (driver.getState().active) driver.cancel("comparaison des moteurs");
      if (state.active) service.stop();
      globalThis.location.assign("/comparison/index.html");
      return;
    }
    if (action === "logs") {
      onLogs();
      return;
    }
    if (action === "export") {
      await exportReport();
      return;
    }
    if (action === "close-export") closeExport();
    if (action === "auto") {
      if (driver.getState().active) driver.cancel("arrêt demandé");
      else {
        if (state.active) service.stop();
        // The driver opens Home itself; this screen is left until it is done.
        void driver.run({ restart: !nextStepFor(state.report) });
        return;
      }
    }
    if (action === "next") {
      if (state.active) service.stop();
      else {
        let next = nextStepFor(state.report);
        if (!next) {
          service.reset();
          next = BENCHMARK_STEPS[0];
        }
        if (service.start(next.id)) {
          await router.navigate("home");
          return;
        }
      }
    }
    if (action === "skip") service.skipVideo();
    if (action === "boot") service.armStartup();
    if (action === "previous-page") page = (page + PAGES.length - 1) % PAGES.length;
    if (action === "next-page") page = (page + 1) % PAGES.length;
    if (action === "step") {
      const steps = state.report.steps.filter((step) => step.status !== "skipped");
      selected = steps[(steps.findIndex((step) => step.id === selected) + 1) % steps.length]?.id;
    }
    render();
  }
  return {
    mount(target) {
      container = target;
      if (!driver.getState().active) service.clearHud();
      unsubscribe = service.subscribe(render);
      unsubscribeDriver = driver.subscribe(render);
      render();
    },
    cleanup() {
      clearRefresh();
      unsubscribe?.();
      unsubscribeDriver?.();
      unsubscribe = null;
      unsubscribeDriver = null;
      container = null;
    },
    consumeBack() {
      if (view !== "qr") return false;
      closeExport();
      render();
      return true;
    },
    getExportState: () => ({ ...exportState, view }),
    async click(event) {
      const button = event.target?.closest?.("[data-benchmark-action]");
      if (!button || !container?.contains(button)) return;
      event.preventDefault?.();
      focus = button.dataset.benchmarkAction;
      await activate(focus);
    },
    async key(event) {
      const code = Number(event.keyCode || 0),
        key = String(event.key || "").toLowerCase();
      if (code === 13 || code === 23 || key === "enter") {
        event.preventDefault?.();
        await activate(focus);
        return;
      }
      const direction =
        code === 37 || code === 38 || key === "arrowleft" || key === "arrowup"
          ? -1
          : code === 39 || code === 40 || key === "arrowright" || key === "arrowdown"
            ? 1
            : 0;
      if (direction) {
        event.preventDefault?.();
        const controls = buttons(),
          index = controls.findIndex((button) => button.dataset.benchmarkAction === focus);
        focus =
          controls[(index + direction + controls.length) % controls.length]?.dataset
            .benchmarkAction || "auto";
        focusCurrent();
      }
    }
  };
}
