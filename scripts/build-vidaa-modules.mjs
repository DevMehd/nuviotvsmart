// VIDAA-only module build (lot E1): ES modules split into chunks for Chromium 111,
// with router screens other than Home and profile selection loaded at first mount.
// Tizen/webOS keep the chrome56 IIFE from build.mjs; nothing here writes to dist/ root.
import { build } from "esbuild";
import coreJsCompat from "core-js-compat";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppMetadata } from "./appMetadata.mjs";
import { readPersonalChangelog } from "./personalChangelog.mjs";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const routerPath = path.join(rootDir, "js/ui/navigation/router.js");
const lazyHelperPath = path.join(rootDir, "js/ui/navigation/lazyRouteScreen.js");
const eagerScreens = new Set(["HomeScreen", "NewHomeScreen", "ProfileSelectionScreen"]);
export const VIDAA_TARGET = "chrome111";
export const VIDAA_MODULE_DIR = "m";
export const VIDAA_CORE_JS = "core-js.vidaa.js";

export async function buildVidaaModules(outDir) {
  const { version } = await readAppMetadata();
  const personalChangelog = await readPersonalChangelog(rootDir, version);
  const moduleDir = path.join(outDir, VIDAA_MODULE_DIR);
  await rm(moduleDir, { recursive: true, force: true });
  const lazyScreens = [];
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: [path.join(rootDir, "js/app.js")],
    outdir: moduleDir,
    bundle: true,
    splitting: true,
    format: "esm",
    target: [VIDAA_TARGET],
    minify: true,
    metafile: true,
    entryNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    logLevel: "warning",
    // Same defines as the IIFE: the cold-launch French changelog depends on them.
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_APP_VERSION__: JSON.stringify(version),
      __NUVIO_PERSONAL_CHANGELOG__: JSON.stringify(personalChangelog)
    },
    plugins: [
      {
        name: "vidaa-lazy-router-screens",
        setup(b) {
          b.onResolve({ filter: /Screen\.js$/ }, (args) => {
            if (args.importer !== routerPath) return undefined;
            const file = path.resolve(args.resolveDir, args.path);
            const name = path.basename(file, ".js").replace(/^./, (c) => c.toUpperCase());
            if (eagerScreens.has(name)) return undefined;
            return { path: file, namespace: "vidaa-lazy-screen", pluginData: { name } };
          });
          b.onLoad({ filter: /.*/, namespace: "vidaa-lazy-screen" }, async (args) => {
            const { name } = args.pluginData;
            const source = await readFile(args.path, "utf8");
            if (!new RegExp(`export\\s+(?:const|let|class|function)\\s+${name}\\b`).test(source))
              throw new Error(`${args.path} must export ${name} for the VIDAA lazy router.`);
            lazyScreens.push(name);
            return {
              contents: `import { lazyRouteScreen } from ${JSON.stringify(lazyHelperPath)};
export const ${name} = lazyRouteScreen(() => import(${JSON.stringify(args.path)}).then((m) => m.${name}));`,
              resolveDir: path.dirname(args.path),
              loader: "js"
            };
          });
        }
      }
    ]
  });
  if (Object.keys(result.metafile.inputs).some((input) => input.includes("node_modules/core-js/")))
    throw new Error("VIDAA modules must not contain core-js modules.");
  if (lazyScreens.length < 25)
    throw new Error(`Only ${lazyScreens.length} router screens are lazy; expected at least 25.`);
  const outputs = result.metafile.outputs;
  const entryKey = Object.keys(outputs).find((key) => outputs[key].entryPoint === "js/app.js");
  if (!entryKey) throw new Error("VIDAA module entry not found in esbuild metafile.");
  // Startup cost: the entry and every chunk it imports statically.
  const eager = new Set();
  const visit = (key) => {
    if (eager.has(key)) return;
    eager.add(key);
    for (const dep of outputs[key].imports)
      if (dep.kind === "import-statement" && outputs[dep.path]) visit(dep.path);
  };
  visit(entryKey);
  const sum = (keys) => [...keys].reduce((total, key) => total + outputs[key].bytes, 0);
  const jsKeys = Object.keys(outputs).filter((key) => key.endsWith(".js"));

  const { list: coreJsModules } = coreJsCompat({
    modules: ["core-js/stable"],
    targets: { chrome: VIDAA_TARGET.replace("chrome", "") }
  });
  await build({
    stdin: {
      contents: coreJsModules.map((name) => `import "core-js/modules/${name}.js";`).join("\n"),
      resolveDir: rootDir,
      sourcefile: "core-js-vidaa-entry.js"
    },
    outfile: path.join(outDir, VIDAA_CORE_JS),
    bundle: true,
    format: "iife",
    minify: true,
    target: [VIDAA_TARGET],
    legalComments: "none"
  });

  const files = (await readdir(moduleDir)).sort().map((name) => `${VIDAA_MODULE_DIR}/${name}`);
  const entry = `${VIDAA_MODULE_DIR}/${path.basename(entryKey)}`;
  console.log(
    `VIDAA modules: ${lazyScreens.length} lazy screens, ${eager.size}/${jsKeys.length} chunks ` +
      `(${(sum(eager) / 1048576).toFixed(2)} of ${(sum(jsKeys) / 1048576).toFixed(2)} MB) before Home, ` +
      `core-js ${coreJsModules.length} modules for ${VIDAA_TARGET}.`
  );
  return { entry, files, lazyScreens };
}
