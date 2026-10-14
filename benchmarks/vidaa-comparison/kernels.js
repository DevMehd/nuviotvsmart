export function inputData(n, seed = 5506111) {
  const a = new Uint32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    a[i] = s;
  }
  return a;
}
export function kernelJS(input, out, kernel, parameter) {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (kernel === 0) {
      sum = (sum + 60 + (v % 180)) >>> 0;
      out[i] = sum;
    } else if (kernel === 1) out[i] = (v & 15) >= parameter ? ((v >>> 4) % 10000) * 3 + (v % 7) : 0;
    else {
      let flags = 0;
      if ((v & 3) === 3) flags |= 1;
      if ((v & 12) === 8) flags |= 2;
      if ((v & 48) === 32) flags |= 4;
      if ((v & 192) === 128) flags |= 8;
      if ((v & 768) === 512) flags |= 16;
      if ((v & 3072) === 2048) flags |= 32;
      out[i] = flags;
    }
  }
  return out;
}
export async function wasmKernel(url = "./kernels.wasm") {
  const bytes = await (await fetch(url)).arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {}),
    api = result.instance.exports;
  api._initialize?.();
  const input = new Uint32Array(api.memory.buffer, api.input_ptr(), 32768),
    output = new Uint32Array(api.memory.buffer, api.output_ptr(), 32768);
  return { input, output, run: (kernel, n, parameter) => api.run(kernel, n, parameter) };
}
export function equal(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
