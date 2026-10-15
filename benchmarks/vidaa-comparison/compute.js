import { inputData, kernelJS, wasmKernel, equal } from "./kernels.js";
import { stats, roundMs } from "./protocol.js";
import {
  COMPUTE_SIZES,
  COMPUTE_KERNELS,
  COMPUTE_TIMING,
  measureTimerQuantum,
  measureKernelCall,
  measureResidentBatch,
  warmComputeContext
} from "./computeTiming.js";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let nextRequestId = 0;
function request(worker, data, transfer = []) {
  return new Promise((resolve, reject) => {
    const requestId = ++nextRequestId,
      finish = (error, result) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        error ? reject(error) : resolve(result);
      };
    const timer = setTimeout(() => {
      worker.terminate();
      finish(Error(`worker-${data.kind}-timeout`));
    }, 10000);
    worker.onmessage = (e) => {
      if (e.data?.requestId !== requestId) return;
      finish(e.data.error ? Error(e.data.error) : null, e.data);
    };
    worker.onerror = () => finish(Error("worker-error"));
    worker.onmessageerror = () => finish(Error("worker-message-error"));
    try {
      worker.postMessage({ ...data, requestId }, transfer);
    } catch (error) {
      finish(error);
    }
  });
}
export async function runCompute({ samples, seed, stopped, progress, rounds = 1 }) {
  const modes = [
      "js-main",
      "js-worker-clone",
      "js-worker-transfer",
      "wasm-main",
      "wasm-worker-transfer"
    ],
    results = [];
  for (let round = 0; round < rounds && !stopped(); round++)
    for (let m = 0; m < modes.length && !stopped(); m++) {
      const mode = modes[(m + round) % modes.length];
      progress(mode);
      let worker = null,
        wasm = null,
        raf = 0,
        clock,
        warmup;
      const start = performance.now();
      try {
        if (mode.includes("worker")) {
          worker = new Worker("./compute-worker.js", { type: "module" });
          ({ clock } = await request(worker, { kind: "init", wasm: mode.startsWith("wasm") }));
        } else if (mode === "wasm-main") wasm = await wasmKernel();
        if (!worker) clock = measureTimerQuantum();
        const setupMs = roundMs(performance.now() - start);
        if (worker) ({ warmup } = await request(worker, { kind: "warmup", seed }));
        else warmup = warmComputeContext({ seed, wasm, timerQuantumMs: clock.quantumMs });
        for (const n of COMPUTE_SIZES)
          for (let kernel = 0; kernel < COMPUTE_KERNELS.length && !stopped(); kernel++) {
            const raw = [],
              computeOnly = [],
              copy = [],
              frames = [],
              input = inputData(n, seed + kernel),
              expected = new Uint32Array(n),
              out = new Uint32Array(n);
            let correct = warmup.valid,
              last,
              residentBatch;
            kernelJS(input, expected, kernel, 7);
            if (worker) {
              const batch = await request(worker, {
                kind: "batch",
                kernel,
                parameter: 7,
                input: input.buffer
              });
              residentBatch = batch.residentBatch;
              if (!equal(new Uint32Array(batch.out), expected)) correct = false;
            } else
              residentBatch = measureResidentBatch({
                input,
                out,
                expected,
                kernel,
                wasm,
                timerQuantumMs: clock.quantumMs
              });
            // Resident throughput is measured outside the single-call frame interval.
            // Transfer includes an owned copy because Nuvio retains its source catalog.
            let active = false;
            const tick = (now) => {
              if (active && last) frames.push(roundMs(now - last));
              last = now;
              raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            for (
              let i = -COMPUTE_TIMING.singleCallWarmupIterations;
              i < samples && !stopped();
              i++
            ) {
              await delay(20);
              active = i >= 0;
              const t = performance.now();
              let work = 0,
                copyMs = 0;
              if (worker) {
                const a = performance.now();
                const transfer = mode.endsWith("transfer"),
                  owned = transfer ? input.slice() : input;
                copyMs = performance.now() - a;
                const reply = await request(
                  worker,
                  { kind: "call", kernel, parameter: 7, input: owned.buffer },
                  transfer ? [owned.buffer] : []
                );
                const copiedAt = performance.now();
                out.set(new Uint32Array(reply.out));
                copyMs += reply.copy + performance.now() - copiedAt;
                work = reply.compute;
              } else {
                const timing = measureKernelCall(input, out, kernel, 7, wasm);
                work = timing.computeMs;
                copyMs = timing.copyMs;
              }
              const elapsed = performance.now() - t;
              if (!equal(out, expected)) correct = false;
              if (i >= 0) {
                raw.push(roundMs(elapsed));
                computeOnly.push(roundMs(work));
                copy.push(roundMs(copyMs));
              }
            }
            active = false;
            cancelAnimationFrame(raf);
            raf = 0;
            results.push({
              mode,
              round,
              kernel: COMPUTE_KERNELS[kernel],
              items: n,
              valid: correct && residentBatch.valid && raw.length === samples,
              setupMs,
              clock,
              warmup,
              singleCallWarmupIterations: COMPUTE_TIMING.singleCallWarmupIterations,
              residentBatch,
              computeScope: "kernel invocation only; explicit copies excluded in every context",
              copyScope:
                "explicit array copies; structured clone and IPC included only in endToEnd",
              endToEnd: stats(raw),
              compute: stats(computeOnly),
              copy: stats(copy),
              raw,
              rawCompute: computeOnly,
              rawCopy: copy,
              frameIntervals: frames
            });
          }
      } catch (error) {
        results.push({
          mode,
          round,
          valid: false,
          error: error.message?.startsWith("worker-")
            ? error.message
            : "unavailable-or-compute-failed"
        });
      } finally {
        if (raf) cancelAnimationFrame(raf);
        worker?.terminate();
      }
    }
  return results;
}
