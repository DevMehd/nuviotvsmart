import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
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
console.log(
  "Trakt application config import: parsing, checksum, preservation and explicit replacement passed (no network)."
);
