import { inputData, kernelJS, equal } from "./kernels.js";

export const COMPUTE_SIZES = [300, 3000, 30000];
export const COMPUTE_KERNELS = ["prefix-row-heights", "filter-score", "tokenized-badge-flags"];
export const COMPUTE_TIMING = {
  warmupCaseMs: 50,
  batchMinimumMs: 20,
  batchMaximumMs: 250,
  batchMaximumIterations: 1000000,
  checkEveryIterations: 8,
  singleCallWarmupIterations: 3
};
const precise = (value) => Math.round(value * 1000000) / 1000000;

// Probe the local context: Worker and Window clocks need not have the same quantum.
export function measureTimerQuantum(now = () => performance.now()) {
  const start = now();
  let previous = start,
    quantum = Infinity,
    changes = 0,
    probes = 0;
  while (probes < 100000 && changes < 64 && previous - start < 20) {
    const current = now();
    probes++;
    if (current > previous) {
      quantum = Math.min(quantum, current - previous);
      changes++;
    }
    previous = current;
  }
  return {
    quantumMs: Number.isFinite(quantum) ? precise(quantum) : null,
    changes,
    probes,
    durationMs: precise(previous - start),
    method: "minimum positive performance.now delta; bounded local-context probe"
  };
}

// The same boundaries are used in both contexts. Explicit Wasm copies are outside
// computeMs; structured clone and IPC remain part of the caller's end-to-end time.
export function measureKernelCall(input, out, kernel, parameter, wasm = null) {
  let copyMs = 0;
  if (wasm) {
    const start = performance.now();
    wasm.input.set(input);
    copyMs = performance.now() - start;
  }
  const start = performance.now();
  if (wasm) wasm.run(kernel, input.length, parameter);
  else kernelJS(input, out, kernel, parameter);
  const computeMs = performance.now() - start;
  if (wasm) {
    const start = performance.now();
    out.set(wasm.output.subarray(0, input.length));
    copyMs += performance.now() - start;
  }
  return { computeMs, copyMs };
}

export function measureResidentBatch({
  input,
  out,
  expected,
  kernel,
  parameter = 7,
  wasm = null,
  timerQuantumMs = null,
  minimumMs = COMPUTE_TIMING.batchMinimumMs,
  maximumMs = COMPUTE_TIMING.batchMaximumMs,
  maximumIterations = COMPUTE_TIMING.batchMaximumIterations,
  now = () => performance.now()
}) {
  if (wasm) wasm.input.set(input);
  const run = wasm
    ? () => wasm.run(kernel, input.length, parameter)
    : () => kernelJS(input, out, kernel, parameter);
  const start = now();
  let durationMs = 0,
    iterations = 0;
  while (durationMs < minimumMs && durationMs < maximumMs && iterations < maximumIterations) {
    const count = Math.min(COMPUTE_TIMING.checkEveryIterations, maximumIterations - iterations);
    for (let i = 0; i < count; i++) run();
    iterations += count;
    durationMs = now() - start;
  }
  // Readback and correctness checks are deliberately outside the resident batch.
  if (wasm) out.set(wasm.output.subarray(0, input.length));
  const correct = equal(out, expected),
    reachedMinimum = durationMs >= minimumMs,
    exceededMaximum = durationMs > maximumMs;
  return {
    durationMs: precise(durationMs),
    iterations,
    perIterationMs: iterations ? precise(durationMs / iterations) : null,
    minimumMs,
    maximumMs,
    maximumIterations,
    checkEveryIterations: COMPUTE_TIMING.checkEveryIterations,
    reachedMinimum,
    exceededMaximum,
    timerQuantumMs,
    correct,
    valid: correct && reachedMinimum && !exceededMaximum,
    scope: "resident kernel calls plus loop/timer overhead; copies and verification excluded",
    bound: "time checked between blocks; an in-progress block cannot be interrupted"
  };
}

// Warm every size/kernel in the actual execution context before any measured case.
// Fixed-duration warmup is explicit and exported; it is not a claim of JIT stability.
export function warmComputeContext({ seed, wasm = null, timerQuantumMs = null }) {
  const start = performance.now(),
    cases = [];
  for (const items of COMPUTE_SIZES)
    for (let kernel = 0; kernel < COMPUTE_KERNELS.length; kernel++) {
      const input = inputData(items, seed + kernel),
        out = new Uint32Array(items),
        expected = kernelJS(input, new Uint32Array(items), kernel, 7);
      cases.push({
        items,
        kernel: COMPUTE_KERNELS[kernel],
        ...measureResidentBatch({
          input,
          out,
          expected,
          kernel,
          wasm,
          timerQuantumMs,
          minimumMs: COMPUTE_TIMING.warmupCaseMs
        })
      });
    }
  return {
    durationMs: precise(performance.now() - start),
    minimumCaseMs: COMPUTE_TIMING.warmupCaseMs,
    valid: cases.every((item) => item.valid),
    cases
  };
}
