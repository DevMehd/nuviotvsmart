import {
  PROTOCOL,
  TARGET_CHROME,
  WIDTH,
  HEIGHT,
  ENGINES,
  LABELS,
  SCENES,
  SCENE_LABELS,
  MODES,
  SEED,
  schedule,
  quantile,
  summarize,
  roundMs
} from "./protocol.js";
import { runCompute } from "./compute.js";
const $ = (id) => document.getElementById(id),
  STORE = "nuvio-comparison-v1";
const manifest = await (await fetch("./manifest.json")).json();
let report = null,
  running = false,
  paused = false,
  stop = false,
  currentCancel = null,
  refresh = null,
  exportStarted = 0;
const chromium = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1] || 0);
const environment = {
  chromium,
  targetChromium: TARGET_CHROME,
  targetMatches: chromium === TARGET_CHROME,
  viewport: [innerWidth, innerHeight],
  dpr: devicePixelRatio,
  screen: [screen.width, screen.height],
  hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  approximateMemoryGB: navigator.deviceMemory ?? null,
  webAssembly: typeof WebAssembly !== "undefined",
  worker: typeof Worker !== "undefined",
  offscreenCanvas: typeof OffscreenCanvas !== "undefined",
  crossOriginIsolated: globalThis.crossOriginIsolated === true,
  longTasks: PerformanceObserver.supportedEntryTypes?.includes("longtask") || false,
  serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
  physicalTVConfirmed: false
};
$("environment").textContent =
  `Chromium ${chromium || "non identifié"} · fenêtre ${innerWidth} × ${innerHeight} · cible : Chromium 111 / Hisense 55U6NQ${environment.targetMatches ? "" : " — navigateur différent : résultats non représentatifs de ta télé"}`;
try {
  report = JSON.parse(localStorage.getItem(STORE) || "null");
  if (report?.protocol !== PROTOCOL) report = null;
} catch {
  report = null;
}
function save() {
  if (!report) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(report));
    report.storageAvailable = true;
  } catch {
    report.storageAvailable = false;
    $("status").textContent =
      "Stockage local indisponible : garde la page ouverte et exporte le résultat.";
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)} ms`);
function showReport() {
  $("resume").disabled = !report || report.build.id !== manifest.id || report.status === "complete";
  $("download").disabled = !report;
  $("export").disabled = !report;
  if (!report) {
    $("results").replaceChildren();
    return;
  }
  const summary = summarize(report.trials),
    table = document.createElement("table");
  const head = document.createElement("tr");
  for (const label of [
    "Moteur",
    "Passages valides",
    "Cartes : p95 images",
    "Sources : p95 images",
    "Cartes : p95 réaction"
  ]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  table.append(head);
  for (const engine of ENGINES) {
    const row = document.createElement("tr"),
      horizontal = summary.find((s) => s.engine === engine && s.scene === "horizontal"),
      sources = summary.find((s) => s.engine === engine && s.scene === "sources");
    for (const value of [
      LABELS[engine],
      `${report.trials.filter((t) => t.engine === engine && t.status === "valid").length}/${report.config.rounds}`,
      fmt(horizontal.frameP95AcrossRounds.median),
      fmt(sources.frameP95AcrossRounds.median),
      fmt(horizontal.inputP95AcrossRounds.median)
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      row.append(td);
    }
    table.append(row);
  }
  const note = document.createElement("p");
  note.textContent = `${report.status === "complete" ? "Parcours terminé" : "Résultat partiel"} · ${report.trials.length}/${report.schedule.length} passages · ${report.trials.filter((t) => t.status !== "valid").length} passages invalides · ${report.mode === "short" ? "mode court : vérification uniquement" : "5 répétitions prévues, intervalles de confiance exploratoires dans le JSON"}.`;
  const errors = document.createElement("p");
  errors.textContent = [
    ...new Set(
      report.trials
        .filter((t) => t.status !== "valid")
        .map(
          (t) =>
            `${LABELS[t.engine]} : ${t.error || t.scenes?.flatMap((s) => s.errors).join(", ") || "incomplet"}`
        )
    )
  ].join(" · ");
  $("results").replaceChildren(note, table, errors);
}
async function calibrate() {
  const times = [];
  let last;
  for (let i = 0; i < 90; i++) {
    const now = await new Promise((r) => requestAnimationFrame(r));
    if (last) times.push(now - last);
    last = now;
  }
  const median = quantile(times, 0.5);
  return {
    frameBudget: median,
    raw: times.map(roundMs),
    method: "90 empty-page rAF callbacks; not physical panel Hz"
  };
}
function ui(active) {
  $("menu").hidden = active;
  $("hud").hidden = !active;
  $("stage").hidden = !active;
  if (active) $("stop").focus();
  else $("resume").disabled ? $("full").focus() : $("resume").focus();
}
function trial(item, config) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe"),
      token = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    iframe.title = "Scène comparative";
    iframe.style.transform = `scale(${Math.min(innerWidth / WIDTH, innerHeight / HEIGHT)})`;
    let done = false,
      timer,
      loadedAt = performance.now();
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      currentCancel = null;
      iframe.remove();
      resolve({ ...item, ...result });
    };
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ status: "invalid", error: "timeout", scenes: [] }), ms);
    };
    const receive = (event) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== location.origin ||
        event.data?.token !== token
      )
        return;
      const data = event.data;
      if (data.type === "ready") {
        const frameReadyMs = roundMs(performance.now() - loadedAt);
        arm(
          Math.max(
            45000,
            (config.scenes || SCENES).length * (config.duration + config.warmup + 7000)
          )
        );
        iframe.contentWindow.postMessage({ type: "run", token, config }, location.origin);
        iframe.dataset.ready = frameReadyMs;
      }
      if (data.type === "progress")
        $("progress").textContent =
          `${item.soak ? "Endurance" : `Passage ${report.trials.length + 1}/${report.schedule.length}`} · ${LABELS[item.engine]} · ${SCENE_LABELS[data.scene]}`;
      if (data.type === "result")
        finish({
          ...data.result,
          frameReadyMs: Number(iframe.dataset.ready),
          firstObservedLoad: !report.trials.some((t) => t.engine === item.engine),
          httpCacheState: "uncontrolled; see resource transfer sizes"
        });
      if (data.type === "error")
        finish({ status: "invalid", error: data.error, scenes: data.partial || [] });
      if (data.type === "stop-request") requestStop();
    };
    window.addEventListener("message", receive);
    currentCancel = () => finish({ status: "invalid", error: "interrupted", scenes: [] });
    arm(45000);
    iframe.src = `./frame.html?engine=${item.engine}&token=${encodeURIComponent(token)}`;
    $("stage").replaceChildren(iframe);
  });
}
function requestStop() {
  stop = true;
  currentCancel?.();
  $("progress").textContent = "Arrêt en cours…";
}
async function run(mode, resume = false) {
  if (running) return;
  clearInterval(refresh);
  $("qr").hidden = true;
  stop = false;
  paused = false;
  running = true;
  $("pause").textContent = "Pause après ce passage";
  ui(true);
  try {
    if (!resume) {
      const seed = SEED;
      report = {
        schema: 1,
        protocol: PROTOCOL,
        createdAt: new Date().toISOString(),
        mode,
        config: { ...MODES[mode] },
        seed,
        build: manifest,
        environment: { ...environment },
        status: "running",
        schedule: schedule(MODES[mode].rounds, seed),
        trials: [],
        compute: [],
        soak: [],
        interruptions: [],
        limitations: [
          "rAF callbacks are not presented frames",
          "synthetic scheduled input, not remote-to-photon latency",
          "no total RAM/VRAM, power, decoder, native VIDAA or server benchmark",
          "HTTP/OS caches cannot be reliably cleared",
          "Lightning uses CanvasTextRenderer, not SDF/Blits",
          "C++ kernels cover numeric work only; not regex parsing or a whole application"
        ]
      };
      $("progress").textContent = "Étalonnage du rythme du navigateur…";
      report.calibration = await calibrate();
      save();
    } else {
      report.status = "running";
      report.interruptions.push({
        kind: "resume",
        at: new Date().toISOString(),
        previousEnvironment: report.environment
      });
      if (
        report.environment.chromium !== chromium ||
        report.environment.dpr !== devicePixelRatio ||
        JSON.stringify(report.environment.viewport) !== JSON.stringify(environment.viewport)
      )
        throw Error("environment-changed");
    }
    for (let i = report.trials.length; i < report.schedule.length && !stop && !paused; i++) {
      const item = report.schedule[i];
      $("progress").textContent =
        `Chargement · ${LABELS[item.engine]} · ${i + 1}/${report.schedule.length}`;
      const result = await trial(item, {
        ...report.config,
        frameBudget: report.calibration.frameBudget
      });
      if (result.error === "interrupted") {
        report.interruptions.push({ kind: "interrupted-trial", ...item });
        break;
      }
      report.trials.push(result);
      save();
      await wait(report.config.cooldown);
    }
    if (
      !stop &&
      !paused &&
      report.trials.length === report.schedule.length &&
      !report.computeComplete
    ) {
      $("stage").replaceChildren();
      report.compute = await runCompute({
        samples: Math.ceil(report.config.samples / report.config.rounds),
        rounds: report.config.rounds,
        seed: report.seed,
        stopped: () => stop || paused,
        progress: (mode) => ($("progress").textContent = `Calculs ciblés · ${mode}`)
      });
      report.computeComplete = !stop && !paused;
      save();
    }
    // Endurance is explicitly separate, not pooled with six-second trials.
    if (!stop && !paused && report.config.soak)
      for (const engine of ["dom", "lightning-webgl"]) {
        if (report.soak.some((t) => t.engine === engine)) continue;
        const result = await trial(
          { engine, round: 0, position: 0, soak: true },
          {
            ...report.config,
            duration: report.config.soak,
            scenes: ["sources"],
            frameBudget: report.calibration.frameBudget
          }
        );
        if (result.error !== "interrupted") report.soak.push(result);
        save();
        if (stop || paused) break;
      }
    report.status = stop ? "stopped" : paused ? "paused" : "complete";
    report.finishedAt = new Date().toISOString();
    report.summary = summarize(report.trials);
    save();
  } catch (error) {
    if (report) {
      report.status = "interrupted";
      report.interruptions.push({
        kind: error.message === "environment-changed" ? "environment-changed" : "controller-error",
        at: new Date().toISOString()
      });
      save();
    }
  } finally {
    running = false;
    $("stage").replaceChildren();
    ui(false);
    showReport();
    $("status").textContent =
      report?.status === "complete"
        ? "Parcours terminé. Exporte le JSON pour comparer les résultats et les erreurs."
        : "Parcours interrompu. Les passages terminés sont conservés. Reprendre continue au prochain passage.";
  }
}
function download() {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "nuvio-comparaison-55U6NQ.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportQr() {
  if (!report) return;
  clearInterval(refresh);
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567",
    id = Array.from(bytes, (b) => alphabet[b % 32]).join("");
  const body = JSON.stringify({ id, report });
  exportStarted = Date.now();
  const send = async () => {
    const res = await fetch("/api/diagnostic-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    if (!res.ok) throw Error("export-failed");
    return res.json();
  };
  try {
    const data = await send(),
      url = `${location.origin}/d/${id}`,
      qr = globalThis.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const canvas = $("qr").querySelector("canvas"),
      ctx = canvas.getContext("2d"),
      n = qr.getModuleCount(),
      scale = 480 / (n + 8);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 480, 480);
    ctx.fillStyle = "black";
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (qr.isDark(y, x))
          ctx.fillRect(
            Math.floor((x + 4) * scale),
            Math.floor((y + 4) * scale),
            Math.ceil(scale),
            Math.ceil(scale)
          );
    $("qr-link").textContent = url;
    $("qr").hidden = false;
    $("qr").scrollIntoView({ block: "center" });
    $("status").textContent = data.durable
      ? "Lien du rapport prêt."
      : "Lien prêt. Garde cet écran ouvert pendant la récupération.";
    if (!data.durable)
      refresh = setInterval(() => {
        if (Date.now() - exportStarted > 30 * 60 * 1000) {
          clearInterval(refresh);
          $("status").textContent = "Lien expiré : relance l’export.";
        } else send().catch(() => {});
      }, 20000);
  } catch {
    $("status").textContent =
      "Export QR indisponible sur ce serveur. Le rapport reste local ; utilise Télécharger JSON ou réessaie.";
  }
}
$("full").onclick = () => run("full");
$("short").onclick = () => run("short");
$("resume").onclick = () => run(report.mode, true);
$("download").onclick = download;
$("export").onclick = exportQr;
$("back").onclick = () => location.assign("/vidaa.html");
$("stop").onclick = requestStop;
$("pause").onclick = () => {
  paused = !paused;
  $("pause").textContent = paused ? "Pause demandée · annuler" : "Pause après ce passage";
};
document.addEventListener("visibilitychange", () => {
  if (running && document.hidden) {
    report.interruptions.push({ kind: "hidden", at: new Date().toISOString() });
    requestStop();
  }
});
window.addEventListener("keydown", (event) => {
  const back =
    ["Escape", "Backspace"].includes(event.key) || [8, 461, 10009].includes(event.keyCode);
  if (back) {
    event.preventDefault();
    running ? requestStop() : location.assign("/vidaa.html");
    return;
  }
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const buttons = [...document.querySelectorAll("button")].filter(
        (e) => !e.disabled && e.getClientRects().length
      ),
      i = buttons.indexOf(document.activeElement),
      d = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    buttons[(i + d + buttons.length) % buttons.length]?.focus();
  }
  if (event.keyCode === 23) {
    event.preventDefault();
    document.activeElement?.click();
  }
});
showReport();
$("full").focus();
