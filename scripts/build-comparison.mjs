import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  source = path.join(root, "benchmarks/vidaa-comparison");
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function list(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    files.push(...(e.isDirectory() ? await list(p) : [p]));
  }
  return files.sort();
}
export async function buildComparison(dist = path.join(root, "dist")) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"))),
    versions = {};
  for (const name of [
    "react",
    "react-dom",
    "vue",
    "svelte",
    "solid-js",
    "@lightningjs/renderer",
    "esbuild"
  ]) {
    versions[name] = JSON.parse(
      await readFile(path.join(root, "node_modules", name, "package.json"))
    ).version;
  }
  const provenance = JSON.parse(await readFile(path.join(source, "wasm/provenance.json")));
  if (
    hash(await readFile(path.join(source, "wasm/kernels.cpp"))) !== provenance.sourceSha256 ||
    hash(await readFile(path.join(source, "wasm/kernels.wasm"))) !== provenance.binarySha256
  )
    throw Error("Comparison Wasm is stale; run build:comparison:wasm with Emscripten.");
  const inputs = {};
  for (const file of await list(source))
    inputs[path.relative(source, file)] = hash(await readFile(file));
  inputs["build-script"] = hash(await readFile(fileURLToPath(import.meta.url)));
  inputs["lockfile"] = hash(await readFile(path.join(root, "package-lock.json")));
  inputs["font"] = hash(await readFile(path.join(root, "assets/fonts/Roboto-Regular.ttf")));
  inputs["qrcode"] = hash(await readFile(path.join(root, "assets/libs/qrcode-generator.js")));
  const id = hash(JSON.stringify({ inputs, versions })).slice(0, 16),
    out = path.join(dist, "comparison", id);
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: [
      path.join(source, "controller.js"),
      path.join(source, "trial.js"),
      path.join(source, "compute-worker.js")
    ],
    outdir: out,
    bundle: true,
    splitting: true,
    format: "esm",
    target: "chrome111",
    minify: true,
    conditions: ["browser"],
    define: {
      "process.env.NODE_ENV": '"production"',
      __VUE_OPTIONS_API__: "false",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false"
    },
    plugins: [
      {
        name: "comparison-svelte",
        setup(b) {
          b.onLoad({ filter: /\.svelte$/ }, async (args) => ({
            contents: compile(await readFile(args.path, "utf8"), {
              filename: args.path,
              generate: "client",
              dev: false,
              css: "injected"
            }).js.code,
            resolveDir: path.dirname(args.path)
          }));
        }
      }
    ],
    legalComments: "linked"
  });
  for (const name of ["index.html", "frame.html", "lab.css"])
    await cp(path.join(source, name), path.join(out, name));
  await cp(path.join(source, "fixtures"), path.join(out, "fixtures"), { recursive: true });
  await cp(
    path.join(root, "assets/fonts/Roboto-Regular.ttf"),
    path.join(out, "fixtures/Roboto-Regular.ttf")
  );
  await cp(path.join(root, "assets/libs/qrcode-generator.js"), path.join(out, "qrcode.js"));
  await cp(path.join(source, "wasm/kernels.wasm"), path.join(out, "kernels.wasm"));
  const artifacts = {};
  for (const file of await list(out)) {
    const bytes = await readFile(file);
    artifacts[path.relative(out, file)] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        id,
        target: "chrome111",
        appVersion: pkg.version,
        versions,
        wasm: provenance,
        inputs,
        artifacts
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(dist, "comparison/index.html"),
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./${id}/index.html"><title>Laboratoire Nuvio</title><a href="./${id}/index.html">Ouvrir le laboratoire Nuvio</a></html>`
  );
  console.log(`Comparison laboratory: ${id}, target Chromium 111, 8 renderers.`);
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildComparison();
