import { kernelJS, wasmKernel } from "./kernels.js";
let wasm;
self.onmessage = async ({ data }) => {
  try {
    if (data.init) {
      if (data.wasm) wasm = await wasmKernel();
      self.postMessage({ ready: true });
      return;
    }
    const input = new Uint32Array(data.input),
      out = new Uint32Array(input.length);
    const start = performance.now();
    if (wasm) {
      wasm.input.set(input);
      wasm.run(data.kernel, input.length, data.parameter);
      out.set(wasm.output.subarray(0, input.length));
    } else kernelJS(input, out, data.kernel, data.parameter);
    const compute = performance.now() - start;
    self.postMessage({ id: data.id, out: out.buffer, compute }, [out.buffer]);
  } catch {
    self.postMessage({ error: "compute-worker-failed" });
  }
};
