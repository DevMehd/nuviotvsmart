import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { readAppMetadata } from "./appMetadata.mjs";
import { buildVidaaModules, VIDAA_CORE_JS } from "./build-vidaa-modules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const vidaaDistDir = path.join(rootDir, "dist", "vidaa");
const installerSourceDir = path.join(rootDir, "installer");
const zipOutputPath = path.join(rootDir, "dist", "nuvio-vidaa.zip");

async function assertDistExists() {
  try {
    await access(path.join(distDir, "app.bundle.js"), fsConstants.R_OK);
    await access(path.join(distDir, "index.html"), fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

function replaceOnce(source, pattern, replacement) {
  const matches =
    typeof pattern === "string"
      ? source.split(pattern).length - 1
      : (source.match(new RegExp(pattern, "g")) || []).length;
  if (matches !== 1)
    throw new Error(`VIDAA entry rewrite expected one match for ${pattern}, found ${matches}.`);
  return source.replace(pattern, replacement);
}

async function addDirectoryToZip(zip, currentDir, rootPath = currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, rootPath);
    } else if (entry.isFile()) {
      const data = await readFile(fullPath);
      zip.file(relativePath, data);
    }
  }
}

async function packageVidaa() {
  console.log("Validating dist directory...");
  await assertDistExists();

  const { version, name } = await readAppMetadata();
  console.log(`Packaging Nuvio TV v${version} for VIDAA OS...`);

  // Clean staging
  await rm(vidaaDistDir, { recursive: true, force: true });
  await mkdir(vidaaDistDir, { recursive: true });

  // Copy dist contents (excluding vidaa subdirectory itself)
  const distEntries = await readdir(distDir, { withFileTypes: true });
  for (const entry of distEntries) {
    if (entry.name === "vidaa" || entry.name.endsWith(".zip")) continue;
    const srcPath = path.join(distDir, entry.name);
    const destPath = path.join(vidaaDistDir, entry.name);
    await cp(srcPath, destPath, { recursive: true });
  }

  // vidaa.html loads Chromium 111 modules split by screen (lot E1); "/" keeps the IIFE.
  const modules = await buildVidaaModules(vidaaDistDir);

  // Give each VIDAA app shell its own asset URLs and offline cache. Keep the
  // shared dist unchanged for the Tizen and webOS packagers.
  const workerSource = await readFile(path.join(rootDir, "sw.js"), "utf8");
  const shellFiles = [
    "index.html",
    "app.bundle.js",
    "core-js.bundle.js",
    "css/bundle.css",
    "nuvio.env.js",
    "boot-guard.js",
    "assets/runtime/legacy-features.js",
    VIDAA_CORE_JS,
    ...modules.files
  ];
  const shellHash = createHash("sha256").update(workerSource);
  for (const file of shellFiles) {
    shellHash.update(file).update(await readFile(path.join(vidaaDistDir, file)));
  }
  const buildId = shellHash.digest("hex").slice(0, 16);
  const indexPath = path.join(vidaaDistDir, "index.html");
  const indexSource = await readFile(indexPath, "utf8");
  const assetAliases = new Map();
  const versionedIndex = indexSource.replace(
    /((?:src|href)=")([^"?#]+\.(?:js|css))(?:\?[^"#]*)?("|#[^"]*")/g,
    (match, prefix, asset, suffix) => {
      if (/^(?:[a-z]+:|\/\/)/i.test(asset)) return match;
      const extension = path.posix.extname(asset);
      const versionedAsset = `${asset.slice(0, -extension.length)}.${buildId}${extension}`;
      assetAliases.set(asset, versionedAsset);
      return `${prefix}${versionedAsset}${suffix}`;
    }
  );
  const coreJsAlias = VIDAA_CORE_JS.replace(/\.js$/, `.${buildId}.js`);
  let versionedWorker = workerSource.replace(
    /^var CACHE_NAME = "[^"]+";/,
    `var CACHE_NAME = "nuvio-vidaa-${buildId}";`
  );
  for (const [asset, alias] of assetAliases) {
    versionedWorker = versionedWorker.replaceAll(
      JSON.stringify(`./${asset}`),
      JSON.stringify(`./${alias}`)
    );
  }
  // The TV precaches its module graph instead of the IIFE kept for "/" and nomodule.
  const iifeAssets = ["app.bundle.js", "core-js.bundle.js"].map((asset) =>
    JSON.stringify(`./${assetAliases.get(asset)}`)
  );
  const moduleAssets = [coreJsAlias, ...modules.files].map((file) => JSON.stringify(`./${file}`));
  versionedWorker = replaceOnce(versionedWorker, `  ${iifeAssets[0]},\n`, "");
  versionedWorker = replaceOnce(
    versionedWorker,
    `  ${iifeAssets[1]},\n`,
    `  ${moduleAssets.join(",\n  ")},\n`
  );
  let vidaaEntry = versionedIndex.replace(
    "<head>",
    `<head>\n    <meta name="nuvio-build" content="${buildId}" />\n    <script>window.__NUVIO_PLATFORM__ = "vidaa";window.__NUVIO_IMAGE_OPTIMIZATION__ = ${process.env.VERCEL === "1"};window.__NUVIO_ADDON_DATA_SERVICE__ = ${process.env.VERCEL === "1"};</script>`
  );
  vidaaEntry = replaceOnce(
    vidaaEntry,
    /<script\s+defer\s+src="(core-js\.bundle\.[a-f0-9]{16}\.js)"([^>]*)><\/script>/,
    `<script type="module" src="${coreJsAlias}"$2></script>\n    <script nomodule defer src="$1"$2></script>`
  );
  vidaaEntry = replaceOnce(
    vidaaEntry,
    /<script\s+defer\s+src="(app\.bundle\.[a-f0-9]{16}\.js)"([^>]*)><\/script>/,
    `<script type="module" src="${modules.entry}"$2></script>\n    <script nomodule defer src="$1"$2></script>`
  );
  await Promise.all([
    writeFile(indexPath, versionedIndex),
    cp(path.join(vidaaDistDir, VIDAA_CORE_JS), path.join(vidaaDistDir, coreJsAlias)),
    writeFile(path.join(vidaaDistDir, "vidaa.html"), vidaaEntry),
    writeFile(path.join(vidaaDistDir, "sw.js"), versionedWorker),
    cp(path.join(rootDir, "manifest.json"), path.join(vidaaDistDir, "manifest.json")),
    ...Array.from(assetAliases, ([asset, alias]) =>
      cp(path.join(vidaaDistDir, asset), path.join(vidaaDistDir, alias))
    )
  ]);

  // Copy installer directory
  try {
    await cp(installerSourceDir, path.join(vidaaDistDir, "installer"), { recursive: true });
  } catch (err) {
    console.warn("Notice: installer directory could not be copied:", err.message);
  }

  // Create ZIP package
  console.log("Generating ZIP package (nuvio-vidaa.zip)...");
  const zip = new JSZip();
  await addDirectoryToZip(zip, vidaaDistDir);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  await writeFile(zipOutputPath, zipBuffer);
  const zipStats = await stat(zipOutputPath);

  console.log("\n=======================================================");
  console.log("  Nuvio TV VIDAA web archive created");
  console.log("=======================================================");
  console.log(`  Package directory : ${vidaaDistDir}`);
  console.log(
    `  Release archive   : ${zipOutputPath} (${(zipStats.size / (1024 * 1024)).toFixed(2)} MB)`
  );
  console.log(`  Application ID    : space.nuvio.tv`);
  console.log("=======================================================\n");
}

try {
  await packageVidaa();
} catch (error) {
  console.error("\nVIDAA packaging failed:");
  console.error(error);
  process.exit(1);
}
