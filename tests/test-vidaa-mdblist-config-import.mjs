import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { parseProperties } from "../scripts/envProperties.mjs";
import {
  importOfficialMdbListConfig,
  parseOfficialMdbListRuntimeConfig
} from "../scripts/import-official-mdblist-config.mjs";

const client = "fixture-mdblist-application-id";
assert.equal(
  parseOfficialMdbListRuntimeConfig(JSON.stringify({ MDBLIST_CLIENT_ID: client })),
  client
);
for (const invalid of ["", "x", "fixture\ninvalid", "https://example.invalid"])
  assert.throws(
    () => parseOfficialMdbListRuntimeConfig(JSON.stringify({ MDBLIST_CLIENT_ID: invalid })),
    /no valid/
  );

const zip = new JSZip();
zip.file(
  "nuvio.env.js",
  `throw Error("Never execute package code");\n${JSON.stringify({ MDBLIST_CLIENT_ID: client, access_token: "must-not-import", TMDB_API_KEY: "must-not-import" })}`
);
const bytes = await zip.generateAsync({ type: "nodebuffer" });
const hash = createHash("sha256").update(bytes).digest("hex");
const directory = await mkdtemp(path.join(os.tmpdir(), "nuvio-mdblist-build-"));
const target = path.join(directory, "local.properties");
const source =
  "# Preserve configuration\r\nTRAKT_CLIENT_ID=fixture-trakt\r\nTMDB_API_KEY=fixture-personal\r\nMDBLIST_CLIENT_ID=\r\n";
let calls = 0;
const options = {
  rootDir: directory,
  expectedHash: hash,
  fetchImpl: async () => {
    calls++;
    return new Response(bytes);
  }
};
try {
  await writeFile(path.join(directory, "local.example.properties"), source);
  assert.equal((await importOfficialMdbListConfig(options)).changed, true);
  const result = await readFile(target, "utf8");
  assert.equal(result, source.replace("MDBLIST_CLIENT_ID=\r\n", `MDBLIST_CLIENT_ID=${client}\r\n`));
  assert.deepEqual(parseProperties(result), {
    TRAKT_CLIENT_ID: "fixture-trakt",
    TMDB_API_KEY: "fixture-personal",
    MDBLIST_CLIENT_ID: client
  });
  assert.equal((await importOfficialMdbListConfig(options)).changed, false);
  assert.equal(calls, 1, "existing configuration skips download");
  const custom = result.replace(client, "custom-application");
  await writeFile(target, custom);
  assert.equal((await importOfficialMdbListConfig(options)).changed, false);
  assert.equal(await readFile(target, "utf8"), custom);
  assert.equal(calls, 1, "custom application is authoritative");
  await writeFile(target, source);
  await assert.rejects(
    importOfficialMdbListConfig({ ...options, expectedHash: "0".repeat(64) }),
    /checksum mismatch/
  );
  assert.equal(await readFile(target, "utf8"), source);
  await assert.rejects(
    importOfficialMdbListConfig({
      ...options,
      fetchImpl: async () => new Response("", { status: 503 })
    }),
    /download failed/
  );
  assert.equal(await readFile(target, "utf8"), source);
  await assert.rejects(
    importOfficialMdbListConfig({
      ...options,
      fetchImpl: async () =>
        new Response(bytes, { headers: { "Content-Length": 20 * 1024 * 1024 } })
    }),
    /expected size/
  );
  const override = path.join(directory, "override.properties");
  assert.equal(
    (await importOfficialMdbListConfig({ ...options, sourcePath: override })).changed,
    true
  );
  assert.equal(parseProperties(await readFile(override, "utf8")).MDBLIST_CLIENT_ID, client);
  assert.equal(await readFile(target, "utf8"), source, "override does not modify default file");
} finally {
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("nuvio-mdblist-build-"));
  await rm(directory, { recursive: true, force: true });
}
console.log(
  "PASS: MDBList application setup verifies the archive, imports only its client ID, preserves configured/custom values and unrelated settings, honors overrides, and fails without writing on invalid downloads (synthetic package)."
);
