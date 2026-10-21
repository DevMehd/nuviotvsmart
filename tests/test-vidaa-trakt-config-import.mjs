import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import JSZip from "jszip";
import { parseProperties, writeRuntimeEnvScriptFile } from "../scripts/envProperties.mjs";
import {
  importOfficialTraktConfig,
  OFFICIAL_TRAKT_CONFIG_RELEASE,
  parseOfficialTraktRuntimeConfig,
  readOfficialTraktArchive,
  mergeOfficialTraktProperties
} from "../scripts/import-official-trakt-config.mjs";

const credentials = {
  TRAKT_CLIENT_ID: "1".repeat(64),
  TRAKT_CLIENT_SECRET: "a".repeat(64)
};
const runtime = `(function () { var values = ${JSON.stringify(credentials)}; }());`;
assert.deepEqual(parseOfficialTraktRuntimeConfig(runtime), credentials);
assert.throws(() => parseOfficialTraktRuntimeConfig("invalid config"), /no valid TRAKT_CLIENT_ID/);
assert.throws(
  () =>
    parseOfficialTraktRuntimeConfig(runtime.replace(credentials.TRAKT_CLIENT_SECRET, "invalid")),
  /no valid TRAKT_CLIENT_SECRET/
);

const source =
  "# Keep my backend\r\nNUVIO_SUPABASE_URL=https://custom.invalid\r\nTMDB_API_KEY=personal-key\r\nTRAKT_CLIENT_ID=\r\nTRAKT_CLIENT_SECRET=\r\n";
const merged = mergeOfficialTraktProperties(source, credentials);
assert.ok(
  merged.startsWith(
    "# Keep my backend\r\nNUVIO_SUPABASE_URL=https://custom.invalid\r\nTMDB_API_KEY=personal-key\r\n"
  )
);
assert.ok(merged.endsWith(`TRAKT_CLIENT_SECRET=${credentials.TRAKT_CLIENT_SECRET}\r\n`));
assert.equal(mergeOfficialTraktProperties(merged, credentials), merged);
assert.ok(
  mergeOfficialTraktProperties("# No integration values", credentials).includes(
    "\nTRAKT_CLIENT_ID="
  )
);
const custom = source.replace("TRAKT_CLIENT_ID=\r", `TRAKT_CLIENT_ID=${"2".repeat(64)}\r`);
assert.throws(() => mergeOfficialTraktProperties(custom, credentials), /--replace-trakt/);
assert.equal(mergeOfficialTraktProperties(custom, credentials, { replaceTrakt: true }), merged);
assert.throws(() => mergeOfficialTraktProperties(source, {}), /Invalid TRAKT_CLIENT_ID/);

const zip = new JSZip();
zip.file("nuvio.env.js", runtime);
const bytes = await zip.generateAsync({ type: "nodebuffer" });
const checksum = createHash("sha256").update(bytes).digest("hex");
assert.deepEqual(await readOfficialTraktArchive(bytes, checksum), credentials);
await assert.rejects(readOfficialTraktArchive(bytes, "0".repeat(64)), /checksum mismatch/);
zip.file("nested/nuvio.env.js", runtime);
const duplicate = await zip.generateAsync({ type: "nodebuffer" });
await assert.rejects(
  readOfficialTraktArchive(duplicate, createHash("sha256").update(duplicate).digest("hex")),
  /Expected one official runtime config/
);

// Exercise the same runtime-file generation used by build.mjs in a fresh,
// disposable project. The downloaded WGT is synthetic and checksum-checked;
// no real application keys, accounts or network access enter this test.
const directory = await mkdtemp(path.join(os.tmpdir(), "nuvio-trakt-build-"));
const target = path.join(directory, "local.properties");
const example =
  "# CI fixture\nTMDB_API_KEY=fixture-public-key\nTRAKT_CLIENT_ID=\nTRAKT_CLIENT_SECRET=\n";
let downloads = 0;
const options = {
  rootDir: directory,
  sourcePath: "",
  ifMissing: true,
  expectedHash: checksum,
  fetchImpl: async (url) => {
    assert.equal(url, OFFICIAL_TRAKT_CONFIG_RELEASE.url);
    downloads++;
    return new Response(bytes, { status: 200 });
  }
};
try {
  await writeFile(path.join(directory, "local.example.properties"), example);
  await assert.rejects(access(target), { code: "ENOENT" });
  assert.equal((await importOfficialTraktConfig(options)).changed, true);
  assert.equal(downloads, 1);
  const prepared = await readFile(target, "utf8");
  assert.equal(prepared, mergeOfficialTraktProperties(example, credentials));
  await mkdir(path.join(directory, "dist"));
  const runtimeTarget = path.join(directory, "dist", "nuvio.env.js");
  await writeRuntimeEnvScriptFile(runtimeTarget, { rootDir: directory, sourcePath: target });
  const context = {};
  vm.runInNewContext(await readFile(runtimeTarget, "utf8"), context);
  for (const key of Object.keys(credentials))
    assert.equal(context.__NUVIO_ENV__[key], credentials[key]);
  assert.equal(context.__NUVIO_ENV__.TMDB_API_KEY, "fixture-public-key");
  assert.equal((await importOfficialTraktConfig(options)).changed, false);
  assert.equal(downloads, 1, "A configured repeated build skips the release download");
  assert.equal(await readFile(target, "utf8"), prepared);

  const customPair = prepared
    .replace(credentials.TRAKT_CLIENT_ID, "2".repeat(64))
    .replace(credentials.TRAKT_CLIENT_SECRET, "b".repeat(64));
  await writeFile(target, customPair);
  assert.equal((await importOfficialTraktConfig(options)).changed, false);
  assert.equal(downloads, 1, "Complete custom apps remain authoritative and offline");
  assert.equal(await readFile(target, "utf8"), customPair);

  // Never join a custom application's ID to the official application's secret.
  const partialCustom = example.replace(
    "TRAKT_CLIENT_ID=\n",
    `TRAKT_CLIENT_ID=${"2".repeat(64)}\n`
  );
  await writeFile(target, partialCustom);
  await assert.rejects(
    importOfficialTraktConfig(options),
    /Existing Trakt app configuration differs/
  );
  assert.equal(await readFile(target, "utf8"), partialCustom);
  const partialOfficial = example.replace(
    "TRAKT_CLIENT_ID=\n",
    `TRAKT_CLIENT_ID=${credentials.TRAKT_CLIENT_ID}\n`
  );
  await writeFile(target, partialOfficial);
  await importOfficialTraktConfig(options);
  assert.equal(
    parseProperties(await readFile(target, "utf8")).TRAKT_CLIENT_SECRET,
    credentials.TRAKT_CLIENT_SECRET
  );
  await writeFile(target, example.replace("TRAKT_CLIENT_ID=\n", "TRAKT_CLIENT_ID=placeholder\n"));
  await importOfficialTraktConfig(options);
  assert.equal(await readFile(target, "utf8"), prepared);

  await rm(target);
  await assert.rejects(
    importOfficialTraktConfig({ ...options, expectedHash: "0".repeat(64) }),
    /checksum mismatch/
  );
  await assert.rejects(access(target), { code: "ENOENT" });
  await assert.rejects(
    importOfficialTraktConfig({
      ...options,
      fetchImpl: async () => new Response(null, { status: 503 })
    }),
    /download failed \(503\)/
  );
  await assert.rejects(access(target), { code: "ENOENT" });
  await assert.rejects(
    importOfficialTraktConfig({ ...options, replaceTrakt: true }),
    /either --if-missing or --replace-trakt/
  );

  // Deployment overrides must prepare the exact file consumed by the build.
  const override = path.join(directory, "configured.properties");
  await importOfficialTraktConfig({ ...options, sourcePath: override });
  assert.equal(await readFile(override, "utf8"), prepared);
  await assert.rejects(access(target), { code: "ENOENT" });
  const run = promisify(execFile);
  const { stdout, stderr } = await run(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/import-official-trakt-config.mjs", import.meta.url)),
      "--if-missing"
    ],
    {
      env: { ...process.env, NUVIO_LOCAL_PROPERTIES: override },
      timeout: 10000
    }
  );
  assert.match(stdout, /already configured/);
  assert.equal(stderr, "");
  for (const value of Object.values(credentials)) assert.ok(!stdout.includes(value));
  assert.equal(await readFile(override, "utf8"), prepared);
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const commands = vercel.buildCommand.split("&&").map((command) => command.trim());
  assert.match(commands[0], /scripts\/import-official-trakt-config\.mjs --if-missing$/);
  assert.match(commands[1], /scripts\/import-official-mdblist-config\.mjs --if-missing$/);
  assert.equal(
    commands[2],
    "npm run package:vidaa",
    "Vercel builds only after successful preparation"
  );
} finally {
  // mkdtemp creates this exact task-owned child; do not recursively remove any
  // computed directory outside the OS temporary directory.
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("nuvio-trakt-build-"));
  await rm(directory, { recursive: true, force: true });
}
console.log(
  "Trakt application config import: fresh CI runtime, configured/custom skips, checksum/download failures, partial-pair preservation, overrides and deployment wiring passed (mock download; no real values logged)."
);
