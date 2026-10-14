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
  method: "paired round bootstrap; exploratory with only 5 rounds"
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
