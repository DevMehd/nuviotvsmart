import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = process.env.NUVIO_EMXX || "em++";
const dir = path.join(root, "benchmarks/vidaa-comparison/wasm");
const flags = [
  "-O3",
  "--no-entry",
  "-fno-exceptions",
  "-fno-rtti",
  "-sSTANDALONE_WASM=1",
  "-sMIN_CHROME_VERSION=111",
  "-sEXPORTED_FUNCTIONS=['_input_ptr','_output_ptr','_run']",
  "-sINITIAL_MEMORY=2097152",
  "-sSTACK_SIZE=65536",
  "-o",
  path.join(dir, "kernels.wasm")
];
execFileSync(compiler, [path.join(dir, "kernels.cpp"), ...flags], { stdio: "inherit" });
const sha = (file) =>
  createHash("sha256")
    .update(readFileSync(path.join(dir, file)))
    .digest("hex");
writeFileSync(
  path.join(dir, "provenance.json"),
  JSON.stringify(
    {
      compiler: execFileSync(compiler, ["--version"], { encoding: "utf8" }).split("\n")[0],
      flags: flags.map((s) => (s.startsWith(dir) ? path.basename(s) : s)),
      sourceSha256: sha("kernels.cpp"),
      binarySha256: sha("kernels.wasm"),
      features: "scalar Wasm, single thread, no SIMD, no shared memory"
    },
    null,
    2
  ) + "\n"
);
