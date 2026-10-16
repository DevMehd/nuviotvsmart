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

export function parseOfficialTraktRuntimeConfig(source) {
  const values = {};
  for (const key of TRAKT_KEYS) {
    const match = String(source).match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
    const value = match ? JSON.parse(match[1]) : "";
    if (!/^[a-f0-9]{64}$/i.test(value)) {
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
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedHash) throw new Error("Official Nuvio package checksum mismatch");
  const archive = await JSZip.loadAsync(bytes);
  const configs = Object.values(archive.files).filter(
    (entry) => !entry.dir && /(^|\/)nuvio\.env\.js$/.test(entry.name)
  );
  if (configs.length !== 1) throw new Error("Expected one official runtime config in the package");
  return parseOfficialTraktRuntimeConfig(await configs[0].async("string"));
}

export function mergeOfficialTraktProperties(source, credentials, { replaceTrakt = false } = {}) {
  const properties = parseProperties(source);
  for (const key of TRAKT_KEYS) {
    if (!/^[a-f0-9]{64}$/i.test(credentials[key] || "")) throw new Error(`Invalid ${key}`);
    if (properties[key] && properties[key] !== credentials[key] && !replaceTrakt) {
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
  fetchImpl = fetch
} = {}) {
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
  const credentials = await readOfficialTraktArchive(bytes);
  const target = path.join(rootDir, "local.properties");
  let source;
  let targetExists = true;
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    targetExists = false;
    source = await readFile(path.join(rootDir, "local.example.properties"), "utf8");
  }
  const next = mergeOfficialTraktProperties(source, credentials, { replaceTrakt });
  const changed = !targetExists || next !== source;
  if (changed) await writeFile(target, next, { mode: 0o600 });
  // Application values are intentionally never included in console output.
  return { changed, release: OFFICIAL_TRAKT_CONFIG_RELEASE.tag };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some((flag) => flag !== "--replace-trakt"))
      throw new Error("Usage: node scripts/import-official-trakt-config.mjs [--replace-trakt]");
    const result = await importOfficialTraktConfig({
      replaceTrakt: flags.includes("--replace-trakt")
    });
    console.log(
      `Official Nuvio ${result.release} Trakt application config ${result.changed ? "imported" : "already configured"} in ignored local.properties.`
    );
  } catch (error) {
    console.error(String(error?.message || "Official Trakt configuration import failed"));
    process.exitCode = 1;
  }
}
