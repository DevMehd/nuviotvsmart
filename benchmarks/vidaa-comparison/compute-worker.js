import { kernelJS, wasmKernel } from "./kernels.js";
import {
  measureTimerQuantum,
  measureKernelCall,
  measureResidentBatch,
  warmComputeContext
} from "./computeTiming.js";
let wasm, clock;
self.onmessage = async ({ data }) => {
  const reply = (value, transfer = []) =>
    self.postMessage({ requestId: data.requestId, ...value }, transfer);
  try {
    if (data.kind === "init") {
      wasm = data.wasm ? await wasmKernel() : null;
      clock = measureTimerQuantum();
      reply({ ready: true, clock });
      return;
    }
    if (data.kind === "warmup") {
      reply({
        warmup: warmComputeContext({ seed: data.seed, wasm, timerQuantumMs: clock.quantumMs })
      });
      return;
    }
    const input = new Uint32Array(data.input),
      out = new Uint32Array(input.length);
    if (data.kind === "batch") {
      const expected = kernelJS(input, new Uint32Array(input.length), data.kernel, data.parameter),
        residentBatch = measureResidentBatch({
          input,
          out,
          expected,
          kernel: data.kernel,
          parameter: data.parameter,
          wasm,
          timerQuantumMs: clock.quantumMs
        });
      reply({ out: out.buffer, residentBatch }, [out.buffer]);
      return;
    }
    if (data.kind !== "call") throw Error("unknown-compute-request");
    const timing = measureKernelCall(input, out, data.kernel, data.parameter, wasm);
    reply({ out: out.buffer, compute: timing.computeMs, copy: timing.copyMs }, [out.buffer]);
  } catch {
    reply({ error: "compute-worker-failed" });
  }
};
