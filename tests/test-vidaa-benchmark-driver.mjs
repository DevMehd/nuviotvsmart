import assert from "node:assert/strict";
import { createVidaaBenchmarkDriver } from "../js/core/diagnostics/vidaaBenchmarkDriver.js";

const STEPS = [
  { id: "idle", seconds: 3 },
  { id: "horizontal", seconds: 6 },
  { id: "vertical", seconds: 6 },
  { id: "details", seconds: 14 },
  { id: "sources", seconds: 14 },
  { id: "return", seconds: 6 },
  { id: "video", seconds: 60 }
];

function element(classes, dataset = {}) {
  const set = new Set(classes.split(" ").filter(Boolean));
  const camel = (name) => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  return {
    dataset,
    classList: { contains: (name) => set.has(name) },
    closest: () => null,
    matches(selector) {
      return selector.split(",").some((part) => {
        const compound = part.trim().split(/\s+/).pop();
        const classes = [...compound.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);
        const attributes = [...compound.matchAll(/\[data-([a-z-]+)="([^"]*)"\]/g)];
        return (
          classes.every((name) => set.has(name)) &&
          attributes.every(([, name, value]) => String(dataset[camel(name)] ?? "") === value)
        );
      });
    }
  };
}

function harness({
  startAccepts = true,
  detailOpens = true,
  staleFocusDecoy = false,
  // Home whose only mounted cards carry this class (new Home Continue Watching: tv2-continue-card).
  homeCardClass = "home-poster-card"
} = {}) {
  let time = 0,
    next = 1;
  const timers = new Map();
  const app = {
    current: "debugConsole",
    stack: [],
    routes: [],
    events: [],
    home: { rows: 3, cols: 6, row: 0, col: 0, sidebar: false },
    detailFocus: "cast",
    streamFocus: "filter",
    leftAtFirstCard: 0
  };
  const listeners = new Set();
  const rootListeners = new Set();
  const go = (name) => {
    app.stack.push(app.current);
    app.current = name;
    app.routes.push(name);
    if (name === "detail") app.detailFocus = "cast";
    if (name === "stream") app.streamFocus = "filter";
  };
  const back = () => {
    app.current = app.stack.pop() || "home";
  };
  function handleKey(event) {
    app.events.push({
      type: event.type,
      keyCode: event.keyCode,
      repeat: Boolean(event.repeat),
      route: app.current
    });
    for (const listener of rootListeners) listener(event);
    for (const listener of listeners) listener(event);
    if (event.type !== "keydown") return;
    const code = event.keyCode,
      home = app.home;
    if (app.current === "home") {
      if (home.sidebar) {
        if (code === 39) home.sidebar = false;
        return;
      }
      if (code === 39) home.col = Math.min(home.cols - 1, home.col + 1);
      if (code === 37) {
        if (home.col === 0) {
          app.leftAtFirstCard += 1;
          home.sidebar = true;
        } else home.col -= 1;
      }
      if (code === 40) home.row = Math.min(home.rows - 1, home.row + 1);
      if (code === 38) home.row = Math.max(0, home.row - 1);
      if (code === 13 && detailOpens) go("detail");
    } else if (app.current === "detail") {
      if (code === 38) app.detailFocus = "play";
      if (code === 13 && app.detailFocus === "play") go("stream");
      if (code === 8) back();
    } else if (app.current === "stream") {
      if (code === 40) app.streamFocus = "card";
      if (code === 38) app.streamFocus = "filter";
      if (code === 13 && app.streamFocus === "card") go("player");
      if (code === 8) back();
    } else if (app.current === "player" && code === 8) back();
  }
  const focused = () => {
    if (app.current === "home")
      return app.home.sidebar
        ? element("focusable focused", { navZone: "sidebar" })
        : element("home-poster-card focusable focused", {
            action: "openDetail",
            navRow: String(app.home.row),
            navCol: String(app.home.col)
          });
    if (app.current === "detail")
      return element("focusable focused", {
        action: app.detailFocus === "play" ? "playDefault" : "openCastDetail"
      });
    if (app.current === "stream")
      return app.streamFocus === "card"
        ? element("stream-route-card focusable focused", { action: "playStream" })
        : element("stream-route-chip focusable focused", { action: "setFilter" });
    return null;
  };
  const body = {
    classList: { contains: () => false },
    contains: () => false,
    dispatchEvent: handleKey
  };
  const document = {
    body,
    activeElement: null,
    hidden: false,
    addEventListener: (type, fn) => type === "keydown" && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    querySelector(selector) {
      // A stale marker elsewhere in the document must not steer the driver.
      if (selector === ".focusable.focused")
        return staleFocusDecoy
          ? element("qr-action-btn focusable focused", { action: "refresh" })
          : focused();
      if (selector === ".home-main .focusable")
        return app.current === "home" ? element("focusable") : null;
      if (selector.includes(`.${homeCardClass}.focusable`))
        return app.current === "home"
          ? element(`${homeCardClass} focusable`, { action: "openDetail" })
          : null;
      if (selector === '[data-action="playDefault"]')
        return app.current === "detail" ? element("focusable", { action: "playDefault" }) : null;
      if (selector.includes(".stream-route-card"))
        return app.current === "stream" ? element("stream-route-card") : null;
      return null;
    }
  };
  const root = {
    document,
    KeyboardEvent: class {
      constructor(type, init) {
        Object.assign(this, init);
        this.type = type;
        this.isTrusted = false;
      }
    },
    performance: { now: () => time },
    addEventListener: (type, fn) => type === "keydown" && rootListeners.add(fn),
    removeEventListener: (type, fn) => rootListeners.delete(fn),
    setTimeout(fn, wait) {
      const id = next++;
      timers.set(id, { fn, at: time + Math.max(0, wait) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  const router = {
    getCurrent: () => app.current,
    getCurrentScreen: () => ({
      container: {
        querySelector: (selector) =>
          selector === ".focusable.focused" ? focused() : document.querySelector(selector)
      },
      getCurrentFocusedNode: () => focused()
    }),
    async navigate(name) {
      go(name);
    },
    async back() {
      back();
    }
  };
  const calls = [];
  const journals = [];
  const report = { steps: [] };
  let active = false,
    activeId = null;
  const service = {
    getState: () => ({ active, current: active ? { id: activeId } : null, report }),
    start(id, options) {
      calls.push(["start", id, options]);
      if (!startAccepts) return false;
      active = true;
      activeId = id;
      return true;
    },
    isRunning: (id) => active && (id === undefined || activeId === id),
    setDriverJournal: (entries) => journals.push(entries.slice()),
    stop(reason, hud, note) {
      calls.push(["stop", activeId, reason, hud, note]);
      if (active) report.steps.push({ id: activeId, status: reason, note });
      active = false;
      activeId = null;
    },
    reset() {
      calls.push(["reset"]);
      report.steps = [];
    },
    showHudMessage: (message) => calls.push(["hud", message]),
    clearHud: () => calls.push(["clearHud"])
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  async function advance(ms) {
    const target = time + ms;
    while (true) {
      await flush();
      const candidate = [...timers]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!candidate) break;
      time = candidate[1].at;
      timers.delete(candidate[0]);
      candidate[1].fn();
      await flush();
    }
    time = target;
    await flush();
  }
  const driver = createVidaaBenchmarkDriver({ root, service, router, steps: STEPS });
  return { app, calls, journals, timers, driver, advance, document, listeners, rootListeners };
}

{
  const h = harness({ staleFocusDecoy: true });
  let settled = null;
  const run = h.driver.run().then((ok) => (settled = ok));
  assert.equal(h.driver.getState().active, true);
  await h.advance(400_000);
  await run;
  assert.equal(settled, true);
  assert.equal(h.driver.getState().active, false);
  assert.equal(h.driver.getState().outcome, "complete");
  const started = h.calls.filter((call) => call[0] === "start");
  assert.deepEqual(
    started.map((call) => call[1]),
    STEPS.map((step) => step.id)
  );
  assert.ok(started.every((call) => call[2]?.auto === true));
  const stopped = h.calls.filter((call) => call[0] === "stop");
  assert.equal(stopped.length, STEPS.length);
  assert.ok(stopped.every((call) => call[2] === "complete"));
  for (const route of ["home", "detail", "stream", "player"])
    assert.ok(h.app.routes.includes(route), `visited ${route}`);
  assert.equal(h.app.routes[h.app.routes.length - 1], "debugConsole");
  assert.equal(h.app.current, "debugConsole");
  assert.equal(h.app.leftAtFirstCard, 0, "never opens the sidebar with Left");
  assert.ok(
    h.app.events.some((event) => event.repeat),
    "simulates held keys"
  );
  assert.ok(h.app.events.some((event) => event.keyCode === 83 && event.route === "player"));
  const detailOpenings = h.app.routes.filter((route) => route === "detail").length;
  assert.ok(detailOpenings >= 3, `opens several detail pages (${detailOpenings})`);
  assert.equal(h.timers.size, 0, "no timers left behind");
  assert.equal(h.listeners.size + h.rootListeners.size, 0, "listeners removed");
  const journal = h.driver.getState().journal;
  assert.ok(
    journal.some((entry) => /parcours terminé/.test(entry)),
    "journal closes the run"
  );
  assert.ok(
    journal.some((entry) => /fiches ouvertes : [1-9]/.test(entry)),
    "journal counts pages"
  );
  assert.ok(h.journals.length > 0, "journal persisted into the report");
  assert.ok(!JSON.stringify(journal).includes("Untitled"), "journal never carries content");
}

{
  // When OK never opens a page, the dependent steps are reported as incomplete.
  const h = harness({ detailOpens: false });
  const run = h.driver.run();
  await h.advance(400_000);
  assert.equal(await run, true, "the run itself finishes");
  const byId = Object.fromEntries(
    h.calls.filter((call) => call[0] === "stop").map((call) => [call[1], call])
  );
  for (const id of ["details", "sources", "video"]) {
    assert.equal(byId[id][2], "incomplete", `${id} is incomplete`);
    assert.ok(byId[id][4], `${id} carries a note`);
  }
  for (const id of ["idle", "horizontal", "vertical", "return"])
    assert.equal(byId[id][2], "complete", `${id} still completes`);
  const journal = h.driver.getState().journal;
  assert.ok(
    journal.some((entry) => /OK n’a pas ouvert la fiche \(essai 2\)/.test(entry)),
    "journal explains the retry"
  );
  assert.ok(journal.some((entry) => /aucune fiche ouverte/.test(entry)));
  assert.equal(h.app.current, "debugConsole");
}

{
  const h = harness();
  let settled = null;
  const run = h.driver.run().then((ok) => (settled = ok));
  await h.advance(4000);
  assert.equal(h.driver.getState().active, true);
  h.document.body.dispatchEvent({ type: "keydown", keyCode: 39, isTrusted: true });
  await h.advance(20_000);
  await run;
  assert.equal(settled, false);
  assert.equal(h.driver.getState().outcome, "cancelled");
  assert.equal(h.driver.getState().reason, "touche de la télécommande");
  const stops = h.calls.filter((call) => call[0] === "stop");
  assert.equal(stops.length, 1);
  assert.equal(stops[0][2], "manual");
  assert.match(String(stops[0][3]), /Parcours interrompu/);
  assert.equal(h.calls.filter((call) => call[0] === "start").length, 1, "no further steps");
  assert.ok(
    h.calls.some((call) => call[0] === "clearHud"),
    "HUD cleared after the notice"
  );
  assert.equal(h.timers.size, 0);
  assert.equal(
    h.app.current !== "debugConsole",
    true,
    "does not pull the viewer back to the console"
  );
}

{
  // The new Home (beta) Continue Watching cards count as Home cards for the guided Diagnostic.
  const h = harness({ homeCardClass: "tv2-continue-card" });
  const run = h.driver.run();
  await h.advance(400_000);
  assert.equal(await run, true);
  const journal = h.driver.getState().journal;
  assert.ok(!journal.some((entry) => /cartes absentes/.test(entry)), journal.join("\n"));
}

{
  const h = harness({ startAccepts: false });
  const ok = await (async () => {
    const run = h.driver.run();
    await h.advance(30_000);
    return run;
  })();
  assert.equal(ok, false);
  assert.match(h.driver.getState().reason, /indisponible/);
  assert.equal(h.driver.getState().outcome, "cancelled");
}
console.log(
  "PASS autonomous VIDAA benchmark driver: runs every step without the remote, holds keys, opens pages, sources and video, stops on a real key"
);
