import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  schedule,
  ENGINES,
  stats,
  pairedInterval,
  summarize,
  frameStats
} from "../benchmarks/vidaa-comparison/protocol.js";
import { sceneAt, checksum } from "../benchmarks/vidaa-comparison/scene.js";
import { inputData, kernelJS, equal } from "../benchmarks/vidaa-comparison/kernels.js";
import {
  measureTimerQuantum,
  measureResidentBatch
} from "../benchmarks/vidaa-comparison/computeTiming.js";
import {
  validateDiagnosticReport,
  createDiagnosticReportService,
  MAX_COMPARISON_BYTES
} from "../server/diagnosticReportService.js";
assert.deepEqual(schedule(5), schedule(5));
assert.equal(schedule(5).length, 40);
assert.notDeepEqual(schedule(5, 1), schedule(5, 2));
for (let r = 0; r < 5; r++)
  assert.deepEqual(
    schedule(5)
      .filter((s) => s.round === r)
      .map((s) => s.engine)
      .sort(),
    ENGINES.slice().sort()
  );
assert.equal(stats([]).p95, null);
assert.equal(stats([10, 20, 30]).median, 20);
assert.equal(pairedInterval([1, 2, 3, 4]), null);
assert.deepEqual(pairedInterval([1, 1, 1, 1, 1]), {
  low: 1,
  high: 1,
  n: 5,
  method: "paired round bootstrap; exploratory small-sample interval"
});
assert.equal(frameStats([16, 50], 1000 / 60).estimatedMissedVsyncs, 2);
for (const scene of ["idle", "horizontal", "vertical", "sources", "hero"])
  for (const step of [0, 1, 50, 500]) {
    const nodes = sceneAt(scene, step);
    assert.equal(new Set(nodes.map((p) => p.id)).size, nodes.length);
    assert.ok(nodes.length < 120);
    assert.equal(checksum(nodes), checksum(sceneAt(scene, step)));
  }
const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../benchmarks/vidaa-comparison/wasm/kernels.wasm", import.meta.url)),
  {}
);
const a = instance.exports;
a._initialize?.();
for (const n of [0, 1, 300, 3000, 30000, 32768])
  for (const seed of [0, 1, 5506111, 4294967295])
    for (let kernel = 0; kernel < 3; kernel++) {
      const data = inputData(n, seed),
        expected = kernelJS(data, new Uint32Array(n), kernel, 7);
      new Uint32Array(a.memory.buffer, a.input_ptr(), 32768).set(data);
      a.run(kernel, n, 7);
      assert.ok(equal(expected, new Uint32Array(a.memory.buffer, a.output_ptr(), n)));
    }
const report = {
  schema: 1,
  protocol: "vidaa-comparison-1",
  mode: "full",
  createdAt: new Date().toISOString(),
  build: { id: "1234567890abcdef" },
  environment: { chromium: 111 },
  trials: [],
  compute: [],
  soak: []
};
assert.ok(validateDiagnosticReport(report));
assert.equal(validateDiagnosticReport({ ...report, trials: Array(41).fill({}) }), false);
assert.equal(validateDiagnosticReport({ ...report, build: { id: "invalid" } }), false);
const service = createDiagnosticReportService({ blobToken: () => "" });
async function call(method, body) {
  return new Promise((resolve) => {
    let status = 200;
    const headers = {};
    service(
      {
        method,
        body,
        query: { id: "abcdefghijklmno2" },
        headers: {
          host: "localhost",
          "content-type": "application/json",
          origin: "http://localhost"
        }
      },
      {
        setHeader: (k, v) => (headers[k] = v),
        set statusCode(v) {
          status = v;
        },
        end: (text) => resolve({ status, text, headers })
      }
    );
  });
}
const large = { ...report, padding: "x".repeat(300000) };
assert.equal((await call("POST", { id: "abcdefghijklmno2", report: large })).status, 200);
assert.equal(JSON.parse((await call("GET")).text).padding.length, 300000);
assert.equal(
  (
    await call("POST", {
      id: "abcdefghijklmno2",
      report: { ...report, padding: "x".repeat(MAX_COMPARISON_BYTES) }
    })
  ).status,
  413
);
assert.equal(
  summarize([{ engine: "react", status: "invalid", scenes: [] }]).find((s) => s.engine === "react")
    .validRounds,
  0
);
console.log(
  "PASS: deterministic schedules, statistics, bounded scenes, 72 JS/Wasm correctness cases, large comparison QR transport and limits."
);

const { nextFrameSample } = await import("../benchmarks/vidaa-comparison/timing.js");
assert.deepEqual(await nextFrameSample({ raf: (callback) => callback(50), now: () => 140 }), {
  frameTimestamp: 50,
  callbackTime: 140
});
assert.ok(validateDiagnosticReport({ ...report, protocol: "vidaa-comparison-2" }));
// Full v2 has eight rounds and substantially more evidence than v1. Exercise
// the unmodified client's JSON envelope above the former 3 MiB transport cap.
const fullV2 = {
  ...report,
  protocol: "vidaa-comparison-2",
  trials: Array.from({ length: 64 }, (_, i) => ({
    engine: ENGINES[i % ENGINES.length],
    round: Math.floor(i / ENGINES.length),
    scenes: Array.from({ length: 5 }, () => ({
      raw: { frames: Array(210).fill(16.67), callbackFrames: Array(210).fill(16.68) }
    }))
  })),
  compute: Array.from({ length: 360 }, (_, i) => ({
    round: Math.floor(i / 45),
    raw: Array(32).fill(0.1)
  })),
  soak: Array.from({ length: 4 }, () => ({ scenes: [] }))
};
const fullV2Bytes = 4 * 1024 * 1024 - 1024;
fullV2.padding = "x".repeat(
  fullV2Bytes - Buffer.byteLength(JSON.stringify({ ...fullV2, padding: "" }))
);
const fullV2Body = JSON.stringify({ id: "abcdefghijklmno2", report: fullV2 });
assert.equal(Buffer.byteLength(JSON.stringify(fullV2)), fullV2Bytes);
assert.ok(Buffer.byteLength(fullV2Body) < 4500000, "Envelope fits the hosting platform limit");
assert.equal((await call("POST", fullV2Body)).status, 200);
assert.deepEqual(JSON.parse((await call("GET")).text), fullV2, "All evidence survives export");
assert.equal(
  (
    await call("POST", {
      id: "abcdefghijklmno2",
      report: { ...fullV2, padding: fullV2.padding + "x".repeat(2048) }
    })
  ).status,
  413,
  "Oversized reports still have a bounded transport"
);
console.log("PASS: full v2 JSON export above 3 MiB, exact round trip and 4 MiB cap.");
const partial = {
  engine: "lightning-canvas",
  round: 0,
  status: "invalid",
  scenes: [
    { scene: "sources", valid: true, frame: { p95: 16.67 }, input: { p95: 20 } },
    { scene: "hero", valid: false, frame: { p95: 60 }, input: { p95: 20 } }
  ]
};
assert.equal(
  summarize([partial]).find((s) => s.engine === "lightning-canvas" && s.scene === "sources")
    .validRounds,
  1
);
assert.equal(
  summarize([partial]).find((s) => s.engine === "lightning-canvas" && s.scene === "hero")
    .validRounds,
  0
);
console.log("PASS: callback clock regression, protocol v2, valid-scene aggregation.");

const balanced = schedule(8);
for (const engine of ENGINES)
  assert.deepEqual(
    balanced
      .filter((t) => t.engine === engine)
      .map((t) => t.position)
      .sort(),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
const pairs = [];
for (let round = 0; round < 8; round++) {
  const r = balanced.filter((t) => t.round === round);
  for (let i = 1; i < 8; i++) pairs.push(`${r[i - 1].engine}:${r[i].engine}`);
}
assert.equal(new Set(pairs).size, 56);
const { validationIssues } = await import("../benchmarks/vidaa-comparison/scene.js");
assert.deepEqual(validationIssues({ ok: false, issues: [] }), ["validation-failed"]);
for (const scene of ["horizontal", "vertical", "sources"]) {
  const a = sceneAt(scene, 10),
    b = sceneAt(scene, 11);
  assert.ok(
    b.some((p) => p.animate && a.some((q) => q.id === p.id && (q.x !== p.x || q.y !== p.y)))
  );
}
console.log("PASS: eight balanced positions/pairs, sustained scrolling, strict validation.");

let quantumProbe = 0;
const quantized = measureTimerQuantum(() => Math.floor(quantumProbe++ / 4) * 0.125);
assert.equal(quantized.quantumMs, 0.125);
assert.equal(quantized.changes, 64);
const frozen = measureTimerQuantum(() => 7);
assert.equal(frozen.quantumMs, null, "A clock without observed progress is unavailable, not zero");
assert.equal(frozen.probes, 100000, "A frozen clock probe must terminate");
const batchInput = inputData(3),
  batchExpected = kernelJS(batchInput, new Uint32Array(3), 0, 7);
const batchOptions = {
  input: batchInput,
  out: new Uint32Array(3),
  expected: batchExpected,
  kernel: 0,
  timerQuantumMs: 20
};
let batchTick = 0;
const quantizedBatch = measureResidentBatch({
  ...batchOptions,
  now: () => Math.floor(batchTick++ / 3) * 20
});
assert.equal(quantizedBatch.valid, true);
assert.equal(quantizedBatch.iterations, 24);
assert.equal(quantizedBatch.durationMs, 20);
assert.equal(quantizedBatch.timerQuantumMs, 20);
const cappedBatch = measureResidentBatch({ ...batchOptions, maximumIterations: 10, now: () => 0 });
assert.equal(cappedBatch.iterations, 10, "A partial block must respect the iteration cap");
assert.equal(cappedBatch.correct, true);
assert.equal(cappedBatch.reachedMinimum, false);
assert.equal(cappedBatch.valid, false, "Iteration-capped undersampling cannot be valid");
let slowTick = 0;
const slowBatch = measureResidentBatch({ ...batchOptions, now: () => slowTick++ * 300 });
assert.equal(slowBatch.iterations, 8);
assert.equal(slowBatch.exceededMaximum, true);
assert.equal(slowBatch.valid, false, "A block that exceeds the duration cap cannot be valid");
let wrongTick = 0;
const wrongBatch = measureResidentBatch({
  ...batchOptions,
  expected: new Uint32Array(3),
  now: () => wrongTick++ * 20
});
assert.equal(wrongBatch.correct, false);
assert.equal(wrongBatch.valid, false, "Throughput never overrides output correctness");
console.log(
  "PASS: CPU clock quantization, frozen clocks, batch duration/iteration caps and correctness gating."
);
