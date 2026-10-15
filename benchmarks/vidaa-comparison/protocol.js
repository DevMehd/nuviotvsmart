export const PROTOCOL = "vidaa-comparison-2";
export const TARGET_CHROME = 111;
export const WIDTH = 1920,
  HEIGHT = 1080;
export const ENGINES = [
  "dom",
  "react",
  "vue",
  "svelte",
  "solid",
  "canvas2d",
  "lightning-webgl",
  "lightning-canvas"
];
export const LABELS = {
  dom: "DOM optimisé",
  react: "React",
  vue: "Vue",
  svelte: "Svelte",
  solid: "Solid",
  canvas2d: "Canvas 2D",
  "lightning-webgl": "Lightning · WebGL",
  "lightning-canvas": "Lightning · Canvas"
};
export const SCENES = ["idle", "horizontal", "vertical", "sources", "hero"];
export const SCENE_LABELS = {
  idle: "Accueil au repos",
  horizontal: "Cartes et focus animé",
  vertical: "Défilement et recyclage",
  sources: "Sources et badges",
  hero: "Fonds, logos et transitions"
};
export const MODES = {
  short: { rounds: 1, duration: 2000, warmup: 500, cooldown: 250, samples: 5, soak: 0 },
  full: { rounds: 8, duration: 3500, warmup: 500, cooldown: 1000, samples: 32, soak: 60000 }
};
export const PERIOD = 180,
  ANIMATION = 140,
  SEED = 5506111;
// Williams design: in eight rounds every engine occupies every position once,
// and each ordered pair appears once as consecutive engines within a round.
export function schedule(rounds, seed = SEED) {
  let s = seed >>> 0;
  const order = ENGINES.slice();
  for (let i = order.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return Array.from({ length: rounds }, (_, round) => {
    return [0, 1, 7, 2, 6, 3, 5, 4]
      .map((index) => order[(index + round) % 8])
      .map((engine, position) => ({
        engine,
        round,
        position
      }));
  }).flat();
}
export function quantile(values, q) {
  if (!values.length) return null;
  const a = values.slice().sort((a, b) => a - b),
    i = (a.length - 1) * q;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
export function stats(a) {
  return {
    n: a.length,
    median: quantile(a, 0.5),
    p95: quantile(a, 0.95),
    p99: quantile(a, 0.99),
    max: a.length ? Math.max(...a) : null
  };
}
export const roundMs = (n) => Math.round(n * 100) / 100;
export function frameStats(frames, budget) {
  return {
    ...stats(frames),
    overBudget: frames.filter((n) => n > budget * 1.5).length,
    over50: frames.filter((n) => n > 50).length,
    estimatedMissedVsyncs: frames.reduce(
      (sum, n) => sum + Math.max(0, Math.round(n / budget) - 1),
      0
    )
  };
}
export function pairedInterval(differences, seed = SEED) {
  if (differences.length < 5) return null;
  let s = seed >>> 0;
  const means = [];
  for (let b = 0; b < 2000; b++) {
    let sum = 0;
    for (let i = 0; i < differences.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      sum += differences[s % differences.length];
    }
    means.push(sum / differences.length);
  }
  return {
    low: quantile(means, 0.025),
    high: quantile(means, 0.975),
    n: differences.length,
    method: "paired round bootstrap; exploratory small-sample interval"
  };
}
export function summarize(trials) {
  return ENGINES.flatMap((engine) =>
    SCENES.map((scene) => {
      const valid = trials.filter((t) => t.engine === engine && !t.error);
      const samples = valid
        .map((t) => ({ round: t.round, ...t.scenes.find((s) => s.scene === scene) }))
        .filter((s) => s.valid);
      const p95 = samples.map((s) => s.frame.p95),
        delay = samples.map((s) => s.input?.p95).filter((n) => Number.isFinite(n));
      const paired = samples.flatMap((s) => {
        const b = trials
          .find((t) => t.engine === "dom" && t.round === s.round && !t.error)
          ?.scenes.find((b) => b.scene === scene && b.valid);
        return b ? [s.frame.p95 - b.frame.p95] : [];
      });
      return {
        engine,
        scene,
        validRounds: samples.length,
        frameP95AcrossRounds: stats(p95),
        inputP95AcrossRounds: stats(delay),
        differenceVsDomMs: engine === "dom" ? null : pairedInterval(paired)
      };
    })
  );
}
