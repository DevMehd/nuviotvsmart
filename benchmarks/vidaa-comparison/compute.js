import { inputData, kernelJS, wasmKernel, equal } from "./kernels.js";
import { stats, roundMs } from "./protocol.js";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function request(worker, data, transfer = []) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("worker-timeout"));
    }, 10000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      reject(Error("worker-error"));
    };
    worker.postMessage(data, transfer);
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
        wasm = null;
      const start = performance.now();
      try {
        if (mode.includes("worker")) {
          worker = new Worker("./compute-worker.js", { type: "module" });
          await request(worker, { init: true, wasm: mode.startsWith("wasm") });
        } else if (mode === "wasm-main") wasm = await wasmKernel();
        const setupMs = roundMs(performance.now() - start);
        for (const n of [300, 3000, 30000])
          for (let kernel = 0; kernel < 3 && !stopped(); kernel++) {
            const raw = [],
              computeOnly = [],
              copy = [],
              frames = [],
              input = inputData(n, seed + kernel),
              expected = new Uint32Array(n),
              out = new Uint32Array(n);
            let correct = true,
              raf,
              last;
            kernelJS(input, expected, kernel, 7);
            // Warm every path, then collect end-to-end calls. Worker transfer includes
            // preparing an owned copy because Nuvio keeps its source catalog.
            let active = false;
            const tick = (now) => {
              if (active && last) frames.push(roundMs(now - last));
              last = now;
              raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            for (let i = -3; i < samples && !stopped(); i++) {
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
                  { id: i, kernel, parameter: 7, input: owned.buffer },
                  transfer ? [owned.buffer] : []
                );
                out.set(new Uint32Array(reply.out));
                work = reply.compute;
              } else if (wasm) {
                wasm.input.set(input);
                const c = performance.now();
                wasm.run(kernel, n, 7);
                const e = performance.now();
                out.set(wasm.output.subarray(0, n));
                work = e - c;
                copyMs = c - t + performance.now() - e;
              } else {
                const c = performance.now();
                kernelJS(input, out, kernel, 7);
                work = performance.now() - c;
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
            results.push({
              mode,
              round,
              kernel: ["prefix-row-heights", "filter-score", "tokenized-badge-flags"][kernel],
              items: n,
              valid: correct && raw.length === samples,
              setupMs,
              endToEnd: stats(raw),
              compute: stats(computeOnly),
              copy: stats(copy),
              raw,
              rawCompute: computeOnly,
              rawCopy: copy,
              frameIntervals: frames
            });
          }
      } catch {
        results.push({ mode, round, valid: false, error: "unavailable-or-compute-failed" });
      } finally {
        worker?.terminate();
      }
    }
  return results;
}
