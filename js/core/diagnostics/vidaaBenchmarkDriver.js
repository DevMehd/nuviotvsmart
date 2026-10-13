import { BENCHMARK_STEPS } from "./vidaaBenchmark.js";

// Drives the guided diagnostic without the remote: synthetic key events go
// through the same FocusEngine and screens a viewer uses, so the measured
// work is the real navigation work. A real remote press cancels the run.
// Every decision is journaled in plain words (element kinds only, never a
// title, identifier or URL) so an incomplete step explains itself.
const KEYS = Object.freeze({
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ok: { key: "Enter", code: "Enter", keyCode: 13 },
  back: { key: "Backspace", code: "Backspace", keyCode: 8 },
  subtitles: { key: "s", code: "KeyS", keyCode: 83 }
});
const REPEAT_MS = 90;
const TAP_MS = 80;
const JOURNAL_LIMIT = 80;
const POSTER_SELECTOR = '.home-poster-card.focusable[data-action="openDetail"]';
const PLAY_SELECTOR = '[data-action="playDefault"]';
const STREAM_SELECTOR = '[data-action="playStream"]';

export class BenchmarkDriverCancelled extends Error {
  constructor(reason = "") {
    super(reason || "cancelled");
    this.name = "BenchmarkDriverCancelled";
    this.reason = reason;
  }
}

// Describes a node without any content: tag, classes, action and position.
export function describeNode(node) {
  if (!node) return "aucun élément";
  const tag = String(node.tagName || "?").toLowerCase();
  const classes = String(node.className || "")
    .split(/\s+/)
    .filter((name) => name && name !== "focusable" && name !== "focused")
    .slice(0, 3)
    .join(".");
  const action = node.dataset?.action ? ` action=${node.dataset.action}` : "";
  const row = node.dataset?.navRow !== undefined ? ` ligne ${node.dataset.navRow}` : "";
  const col = node.dataset?.navCol !== undefined ? ` colonne ${node.dataset.navCol}` : "";
  return `${tag}${classes ? `.${classes}` : ""}${action}${row}${col}`.slice(0, 120);
}

export function createVidaaBenchmarkDriver({
  root = globalThis,
  service,
  router,
  steps = BENCHMARK_STEPS
} = {}) {
  const now = () => root.performance?.now?.() ?? Date.now();
  const listeners = new Set();
  const pending = new Set();
  let state = {
    active: false,
    stepId: null,
    stepIndex: 0,
    total: 0,
    outcome: null,
    reason: "",
    journal: []
  };
  let cancelled = false;
  let cancelReason = "";
  let journal = [];
  let runStartedAt = 0;

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (_) {}
    }
  };
  const update = (patch) => {
    state = { ...state, ...patch, journal };
    notify();
  };
  const log = (message) => {
    const seconds = Math.max(0, Math.round((now() - runStartedAt) / 1000));
    journal.push(`${seconds} s · ${String(message).slice(0, 160)}`);
    if (journal.length > JOURNAL_LIMIT) journal = journal.slice(-JOURNAL_LIMIT);
    state = { ...state, journal };
    try {
      service.setDriverJournal?.(journal);
    } catch (_) {}
  };
  const doc = () => root.document;
  const screen = () => {
    try {
      return router?.getCurrentScreen?.() || null;
    } catch (_) {
      return null;
    }
  };
  const scope = () => {
    const container = screen()?.container;
    return container && typeof container.querySelector === "function" ? container : doc();
  };
  const query = (selector) => {
    try {
      return scope()?.querySelector?.(selector) || doc()?.querySelector?.(selector) || null;
    } catch (_) {
      return null;
    }
  };
  const matches = (node, selector) => {
    try {
      return Boolean(node?.matches?.(selector));
    } catch (_) {
      return false;
    }
  };
  // The screen's own idea of focus comes first; a stale ".focused" marker
  // elsewhere in the document must not steer the run.
  const focused = () => {
    const current = screen();
    let node = null;
    try {
      node = current?.getCurrentFocusedNode?.() || null;
    } catch (_) {
      node = null;
    }
    if (!node) node = query(".focusable.focused");
    const active = doc()?.activeElement;
    if (!node && matches(active, ".focusable")) node = active;
    return node;
  };
  const route = () => String(router?.getCurrent?.() || "");
  const modalOpen = () => Boolean(doc()?.body?.classList?.contains?.("nuvio-modal-open"));
  const navCol = (node) => Number(node?.dataset?.navCol || 0);
  const navRow = (node) => Number(node?.dataset?.navRow || 0);
  const onSidebar = (node) =>
    Boolean(
      node &&
      (String(node.dataset?.navZone || "") === "sidebar" ||
        node.closest?.(".home-sidebar, .modern-sidebar-panel"))
    );
  const measuringStep = (id) => {
    try {
      if (typeof service.isRunning === "function") return service.isRunning(id);
    } catch (_) {}
    const current = service.getState();
    return current.active && current.current?.id === id;
  };
  const remaining = (until) => Math.max(0, until - now());

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      if (cancelled) {
        reject(new BenchmarkDriverCancelled(cancelReason));
        return;
      }
      const entry = { timer: null, reject };
      entry.timer = root.setTimeout(
        () => {
          pending.delete(entry);
          resolve();
        },
        Math.max(0, ms)
      );
      pending.add(entry);
    });
  }

  function cancel(reason = "") {
    if (!state.active || cancelled) return;
    cancelled = true;
    cancelReason = reason;
    for (const entry of pending) {
      root.clearTimeout?.(entry.timer);
      entry.reject(new BenchmarkDriverCancelled(reason));
    }
    pending.clear();
  }

  async function waitFor(predicate, timeoutMs, pollMs = 120) {
    const until = now() + timeoutMs;
    while (true) {
      let ok = false;
      try {
        ok = Boolean(predicate());
      } catch (_) {
        ok = false;
      }
      if (ok) return true;
      if (now() >= until) return false;
      await sleep(pollMs);
    }
  }

  function dispatchKey(type, spec, repeat = false) {
    const documentRef = doc();
    if (!documentRef) return;
    const init = {
      key: spec.key,
      code: spec.code,
      keyCode: spec.keyCode,
      which: spec.keyCode,
      repeat,
      bubbles: true,
      cancelable: true
    };
    let event = null;
    try {
      event = new root.KeyboardEvent(type, init);
    } catch (_) {
      event = null;
    }
    if (!event) {
      try {
        event = documentRef.createEvent("Event");
        event.initEvent(type, true, true);
      } catch (_) {
        return;
      }
    }
    for (const prop of ["key", "code", "keyCode", "which", "repeat"]) {
      if (event[prop] !== init[prop]) {
        try {
          Object.defineProperty(event, prop, { value: init[prop], configurable: true });
        } catch (_) {}
      }
    }
    const active = documentRef.activeElement;
    const body = documentRef.body;
    const target =
      active && active !== body && body?.contains?.(active) ? active : body || documentRef;
    try {
      target.dispatchEvent(event);
    } catch (_) {}
  }

  async function press(name, { holdMs = 0 } = {}) {
    const spec = KEYS[name];
    dispatchKey("keydown", spec, false);
    if (holdMs > 0) {
      const until = now() + holdMs;
      while (now() < until) {
        await sleep(REPEAT_MS);
        dispatchKey("keydown", spec, true);
      }
    } else {
      await sleep(TAP_MS);
    }
    dispatchKey("keyup", spec, false);
  }

  async function tap(name, gapMs = 360) {
    await press(name);
    await sleep(gapMs);
  }

  async function leaveSidebar() {
    for (let i = 0; i < 3 && onSidebar(focused()); i += 1) await tap("right", 400);
  }

  async function ensureHome() {
    if (route() !== "home") {
      log(`ouverture de l’accueil depuis « ${route() || "?"} »`);
      await router.navigate("home");
    }
    const ready = await waitFor(() => route() === "home" && query(".home-main .focusable"), 15000);
    const cards = await waitFor(
      () => query(".home-poster-card.focusable, .home-continue-card.focusable"),
      15000,
      250
    );
    if (!ready || !cards)
      log(
        `accueil incomplet : écran ${ready ? "prêt" : "absent"}, cartes ${cards ? "présentes" : "absentes"}`
      );
    await sleep(1200);
    await leaveSidebar();
  }

  async function returnHome() {
    for (let i = 0; i < 8 && route() !== "home"; i += 1) {
      const before = route();
      await press("back");
      await sleep(400);
      await waitFor(() => route() !== before, 2500);
    }
    if (route() !== "home") {
      log(`retour forcé à l’accueil depuis « ${route() || "?"} »`);
      await router.navigate("home");
    }
    await sleep(800);
  }

  async function browseHorizontal(until, id) {
    while (remaining(until) > 2500 && measuringStep(id)) {
      for (let i = 0; i < 5 && remaining(until) > 1000; i += 1) await tap("right");
      if (remaining(until) > 3000) {
        await press("right", { holdMs: 1300 });
        await sleep(900);
      }
      for (let i = 0; i < 6 && remaining(until) > 1000; i += 1) {
        // Left at the first card opens the sidebar; that is not row navigation.
        if (navCol(focused()) <= 0) break;
        await tap("left");
      }
      await sleep(700);
    }
    return true;
  }

  async function browseVertical(until, id) {
    while (remaining(until) > 2500 && measuringStep(id)) {
      for (let i = 0; i < 3 && remaining(until) > 1000; i += 1) await tap("down", 500);
      if (remaining(until) > 3000) {
        await press("down", { holdMs: 1400 });
        await sleep(1200);
      }
      for (let i = 0; i < 4 && remaining(until) > 1000; i += 1) {
        if (navRow(focused()) <= 0) break;
        await tap("up", 500);
      }
      if (remaining(until) > 3000 && navRow(focused()) >= 3) {
        await press("up", { holdMs: 900 });
        await sleep(1200);
      }
      await sleep(600);
    }
    return true;
  }

  async function browseMixed(until, id) {
    while (remaining(until) > 2500 && measuringStep(id)) {
      await browseHorizontal(Math.min(until, now() + 8000), id);
      await browseVertical(Math.min(until, now() + 8000), id);
    }
    return true;
  }

  async function focusPosterCard() {
    if (matches(focused(), POSTER_SELECTOR)) return true;
    log(`recherche d’une carte : focus sur ${describeNode(focused())}`);
    await leaveSidebar();
    for (let i = 0; i < 5; i += 1) {
      await tap("down", 450);
      if (matches(focused(), POSTER_SELECTOR)) return true;
    }
    for (let i = 0; i < 4; i += 1) {
      await tap("right", 400);
      if (matches(focused(), POSTER_SELECTOR)) return true;
    }
    for (let i = 0; i < 3; i += 1) {
      await tap("up", 450);
      if (matches(focused(), POSTER_SELECTOR)) return true;
    }
    log(`aucune carte de fiche atteinte : focus sur ${describeNode(focused())}`);
    return false;
  }

  async function openDetail() {
    if (route() !== "home") await ensureHome();
    if (!(await focusPosterCard())) return false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await press("ok");
      if (await waitFor(() => route() === "detail", 10000)) return true;
      log(
        `OK n’a pas ouvert la fiche (essai ${attempt}) : écran « ${route() || "?"} », ${modalOpen() ? "menu ouvert" : "pas de menu"}, focus sur ${describeNode(focused())}`
      );
      if (modalOpen()) {
        await press("back");
        await sleep(600);
      }
      if (route() !== "home") break;
    }
    return route() === "detail";
  }

  async function focusPlayButton() {
    const present = await waitFor(() => query(PLAY_SELECTOR), 8000, 200);
    if (!present) {
      log(`fiche sans bouton de lecture : focus sur ${describeNode(focused())}`);
      return false;
    }
    await sleep(600);
    if (matches(focused(), PLAY_SELECTOR)) return true;
    for (let i = 0; i < 4; i += 1) {
      await tap("up", 400);
      if (matches(focused(), PLAY_SELECTOR)) return true;
    }
    for (let i = 0; i < 3; i += 1) {
      await tap("left", 400);
      if (matches(focused(), PLAY_SELECTOR)) return true;
    }
    log(`bouton de lecture non atteint : focus sur ${describeNode(focused())}`);
    return matches(focused(), PLAY_SELECTOR);
  }

  async function openSources() {
    if (!(await openDetail())) return false;
    if (!(await focusPlayButton())) return false;
    await press("ok");
    const opened = await waitFor(() => route() === "stream", 12000);
    if (!opened) {
      log(
        `OK sur Lire n’a pas affiché les liens : écran « ${route() || "?"} », ${modalOpen() ? "menu ouvert" : "pas de menu"}`
      );
      if (modalOpen()) await press("back");
      return false;
    }
    const listed = await waitFor(
      () => query(".stream-route-card, .stream-route-empty"),
      15000,
      250
    );
    if (!listed) log("liens vidéo : aucune carte ni message vide après 15 s");
    await sleep(800);
    return true;
  }

  async function runDetails(until, id) {
    let opened = 0;
    while (remaining(until) > 8000 && measuringStep(id)) {
      if (!(await openDetail())) break;
      opened += 1;
      await sleep(Math.min(3500, remaining(until)));
      await press("back");
      await waitFor(() => route() === "home", 8000);
      await sleep(800);
      await tap("right", 500);
    }
    log(`fiches ouvertes : ${opened}`);
    return opened > 0;
  }

  async function runSources(until, id) {
    if (!(await openSources())) return false;
    while (remaining(until) > 2000 && route() === "stream" && measuringStep(id)) {
      for (let i = 0; i < 4 && remaining(until) > 1000; i += 1) await tap("down", 550);
      for (let i = 0; i < 2 && remaining(until) > 1000; i += 1) await tap("up", 550);
      if (remaining(until) > 2500) {
        await tap("right", 1500);
        await tap("left", 1200);
      }
      for (let i = 0; i < 3 && remaining(until) > 1000; i += 1) await tap("down", 550);
      await sleep(500);
    }
    return true;
  }

  async function runVideo(until) {
    if (!(await openSources())) return false;
    if (!matches(focused(), STREAM_SELECTOR)) await tap("down", 500);
    if (!matches(focused(), STREAM_SELECTOR)) {
      log(`aucun lien vidéo sélectionnable : focus sur ${describeNode(focused())}`);
      return false;
    }
    await press("ok");
    if (!(await waitFor(() => route() === "player", 20000))) {
      log(`la lecture n’a pas démarré : écran « ${route() || "?"} »`);
      return false;
    }
    await sleep(Math.min(45000, Math.max(0, remaining(until) - 40000)));
    if (remaining(until) > 20000 && route() === "player") {
      await press("right", { holdMs: 900 });
      await sleep(12000);
    }
    if (remaining(until) > 12000 && route() === "player") {
      await press("subtitles");
      await sleep(5000);
      await press("back");
      await sleep(6000);
    }
    if (remaining(until) > 0 && route() === "player")
      await sleep(Math.min(remaining(until), 60000));
    return true;
  }

  const scenarios = {
    idle: async (until) => {
      await sleep(remaining(until));
      return true;
    },
    horizontal: browseHorizontal,
    vertical: browseVertical,
    details: runDetails,
    sources: runSources,
    return: browseMixed,
    video: runVideo
  };
  const unreachable = {
    details: "aucune fiche ouverte",
    sources: "liens vidéo non affichés",
    video: "lecture non lancée"
  };

  function onKey(event) {
    if (state.active && event?.isTrusted === true) cancel("touche de la télécommande");
  }
  function onVisibility() {
    if (state.active && doc()?.hidden === true) cancel("application masquée");
  }

  async function run({ restart = false } = {}) {
    if (state.active) return false;
    const report = service.getState().report;
    const done = (id) =>
      report.steps.some(
        (result) => result.id === id && ["complete", "skipped"].includes(result.status)
      );
    let queue = steps.filter((step) => !done(step.id));
    if (restart || !queue.length) {
      service.reset();
      queue = steps.slice();
    }
    cancelled = false;
    cancelReason = "";
    journal = [];
    runStartedAt = now();
    update({
      active: true,
      stepId: null,
      stepIndex: 0,
      total: queue.length,
      outcome: null,
      reason: ""
    });
    log(`parcours automatique : ${queue.length} étape(s)`);
    // Window capture runs before FocusEngine stops the key at the document.
    root.addEventListener?.("keydown", onKey, true);
    doc()?.addEventListener?.("visibilitychange", onVisibility);
    let outcome = "complete";
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const step = queue[index];
        update({ stepId: step.id, stepIndex: index + 1 });
        log(`étape ${index + 1}/${queue.length} : ${step.title || step.id}`);
        await ensureHome();
        if (!service.start(step.id, { auto: true }))
          throw new BenchmarkDriverCancelled("mesure indisponible sur cet appareil");
        const until = now() + step.seconds * 1000;
        const reached = await scenarios[step.id]?.(until, step.id);
        if (measuringStep(step.id)) {
          if (reached === false) {
            const note = unreachable[step.id] || "écran attendu non atteint";
            log(`étape ${step.id} incomplète : ${note}`);
            service.stop("incomplete", false, note);
          } else service.stop("complete", false);
        } else log(`étape ${step.id} arrêtée par la mesure elle-même`);
        await returnHome();
      }
      log("parcours terminé");
      await router.navigate("debugConsole");
    } catch (error) {
      outcome = error instanceof BenchmarkDriverCancelled ? "cancelled" : "error";
      cancelReason = cancelReason || error?.reason || "";
      log(
        outcome === "cancelled"
          ? `parcours interrompu${cancelReason ? ` : ${cancelReason}` : ""}`
          : `erreur du pilote : ${String(error?.name || "Error")}`
      );
      const notice = `Parcours interrompu${cancelReason ? ` · ${cancelReason}` : ""} · Bilan : Paramètres → À propos → Console debug`;
      if (service.getState().active) service.stop("manual", notice);
      else service.showHudMessage?.(notice);
      root.setTimeout?.(() => service.clearHud?.(), 8000);
    } finally {
      root.removeEventListener?.("keydown", onKey, true);
      doc()?.removeEventListener?.("visibilitychange", onVisibility);
      for (const entry of pending) root.clearTimeout?.(entry.timer);
      pending.clear();
      update({ active: false, outcome, reason: cancelReason });
    }
    return outcome === "complete";
  }

  return {
    run,
    cancel: (reason = "arrêt demandé") => cancel(reason),
    getState: () => ({ ...state, journal: journal.slice() }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
