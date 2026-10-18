import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { parseProperties } from "./envProperties.mjs";

export const OFFICIAL_TRAKT_CONFIG_RELEASE = Object.freeze({
  tag: "1.2.5",
  url: "https://github.com/NuvioMedia/NuvioTVSmart/releases/download/1.2.5/NuvioTV-Tizen-1.2.5.wgt",
  sha256: "3e337ef50a84611dce0e64bf475ab7a95227822d48b7bc0237b89fcf134b571c"
});

const TRAKT_KEYS = ["TRAKT_CLIENT_ID", "TRAKT_CLIENT_SECRET"];
const isValidTraktValue = (value) => /^[a-f0-9]{64}$/i.test(value || "");

export function parseOfficialTraktRuntimeConfig(source) {
  const values = {};
  for (const key of TRAKT_KEYS) {
    const match = String(source).match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
    const value = match ? JSON.parse(match[1]) : "";
    if (!isValidTraktValue(value)) {
      throw new Error(`The official runtime config has no valid ${key}`);
    }
    values[key] = value;
  }
  return values;
}

export async function readOfficialTraktArchive(
  bytes,
  expectedHash = OFFICIAL_TRAKT_CONFIG_RELEASE.sha256
) {
  return parseOfficialTraktRuntimeConfig(
    await readOfficialRuntimeConfigArchive(bytes, expectedHash)
  );
}

export async function readOfficialRuntimeConfigArchive(bytes, expectedHash) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedHash) throw new Error("Official Nuvio package checksum mismatch");
  const archive = await JSZip.loadAsync(bytes);
  const configs = Object.values(archive.files).filter(
    (entry) => !entry.dir && /(^|\/)nuvio\.env\.js$/.test(entry.name)
  );
  if (configs.length !== 1) throw new Error("Expected one official runtime config in the package");
  return configs[0].async("string");
}

export function mergeOfficialTraktProperties(
  source,
  credentials,
  { replaceTrakt = false, fillMissing = false } = {}
) {
  const properties = parseProperties(source);
  for (const key of TRAKT_KEYS) {
    if (!isValidTraktValue(credentials[key])) throw new Error(`Invalid ${key}`);
    const preserveExisting = fillMissing
      ? isValidTraktValue(properties[key])
      : Boolean(properties[key]);
    if (preserveExisting && properties[key] !== credentials[key] && !replaceTrakt) {
      throw new Error(
        "Existing Trakt app configuration differs; use --replace-trakt to replace it explicitly"
      );
    }
  }
  let next = String(source);
  const newline = next.includes("\r\n") ? "\r\n" : "\n";
  for (const key of TRAKT_KEYS) {
    if (properties[key] === credentials[key]) continue;
    const line = `${key}=${credentials[key]}`;
    const matcher = new RegExp(`^[ \\t]*${key}[ \\t]*[:=][^\\r\\n]*`, "gm");
    if (matcher.test(next)) {
      next = next.replace(matcher, line);
    } else {
      next += `${next && !next.endsWith("\n") ? newline : ""}${line}${newline}`;
    }
  }
  return next;
}

export async function importOfficialTraktConfig({
  rootDir = fileURLToPath(new URL("../", import.meta.url)),
  replaceTrakt = false,
  ifMissing = false,
  sourcePath = process.env.NUVIO_LOCAL_PROPERTIES || "",
  fetchImpl = fetch,
  expectedHash = OFFICIAL_TRAKT_CONFIG_RELEASE.sha256
} = {}) {
  if (ifMissing && replaceTrakt) throw new Error("Use either --if-missing or --replace-trakt");
  const target = sourcePath ? path.resolve(sourcePath) : path.join(rootDir, "local.properties");
  let source;
  let targetExists = true;
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    targetExists = false;
    source = await readFile(path.join(rootDir, "local.example.properties"), "utf8");
  }
  const properties = parseProperties(source);
  if (ifMissing && TRAKT_KEYS.every((key) => isValidTraktValue(properties[key]))) {
    // A complete existing application pair is authoritative, including custom
    // apps. No network or write is needed for a reproducible configured build.
    if (!targetExists) await writeFile(target, source, { mode: 0o600 });
    return { changed: !targetExists, release: OFFICIAL_TRAKT_CONFIG_RELEASE.tag };
  }
  const response = await fetchImpl(OFFICIAL_TRAKT_CONFIG_RELEASE.url, {
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Official Nuvio package download failed (${response.status})`);
  if (Number(response.headers.get("Content-Length") || 0) > 16 * 1024 * 1024) {
    throw new Error("Official Nuvio package exceeds the expected size");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error("Official Nuvio package exceeds the expected size");
  const credentials = await readOfficialTraktArchive(bytes, expectedHash);
  const next = mergeOfficialTraktProperties(source, credentials, {
    replaceTrakt,
    fillMissing: ifMissing
  });
  const changed = !targetExists || next !== source;
  if (changed) await writeFile(target, next, { mode: 0o600 });
  // Application values are intentionally never included in console output.
  return { changed, release: OFFICIAL_TRAKT_CONFIG_RELEASE.tag };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some((flag) => !["--replace-trakt", "--if-missing"].includes(flag)))
      throw new Error(
        "Usage: node scripts/import-official-trakt-config.mjs [--replace-trakt | --if-missing]"
      );
    const result = await importOfficialTraktConfig({
      replaceTrakt: flags.includes("--replace-trakt"),
      ifMissing: flags.includes("--if-missing")
    });
    console.log(
      `Trakt application config ${result.changed ? `prepared from Nuvio ${result.release}` : "already configured"}; application values are not logged.`
    );
  } catch (error) {
    console.error(String(error?.message || "Official Trakt configuration import failed"));
    process.exitCode = 1;
  }
}
