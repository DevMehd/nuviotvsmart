import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseProperties } from "./envProperties.mjs";
import { readOfficialRuntimeConfigArchive } from "./import-official-trakt-config.mjs";

export const OFFICIAL_MDBLIST_CONFIG_RELEASE = Object.freeze({
  tag: "1.2.7",
  url: "https://github.com/NuvioMedia/NuvioTVSmart/releases/download/1.2.7/NuvioTV-Tizen-1.2.7.wgt",
  sha256: "2a9b83ba5d85b3c85e78171754539b02279db7ecb774c48dce05a8c068e7ab79"
});

export function parseOfficialMdbListRuntimeConfig(source) {
  const match = String(source).match(/"MDBLIST_CLIENT_ID"\s*:\s*("(?:\\.|[^"\\])*")/);
  const value = match ? JSON.parse(match[1]) : "";
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(value))
    throw new Error("The official runtime config has no valid MDBLIST_CLIENT_ID");
  return value;
}

export async function importOfficialMdbListConfig({
  rootDir = fileURLToPath(new URL("../", import.meta.url)),
  sourcePath = process.env.NUVIO_LOCAL_PROPERTIES || "",
  fetchImpl = fetch,
  expectedHash = OFFICIAL_MDBLIST_CONFIG_RELEASE.sha256
} = {}) {
  const target = sourcePath ? path.resolve(sourcePath) : path.join(rootDir, "local.properties");
  let source;
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    source = await readFile(path.join(rootDir, "local.example.properties"), "utf8");
  }
  // A configured custom application remains authoritative. No tokens or other
  // integration values are imported, and no network request is made here.
  if (parseProperties(source).MDBLIST_CLIENT_ID) return { changed: false };
  const response = await fetchImpl(OFFICIAL_MDBLIST_CONFIG_RELEASE.url, {
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Official Nuvio package download failed (${response.status})`);
  if (Number(response.headers.get("Content-Length") || 0) > 16 * 1024 * 1024)
    throw new Error("Official Nuvio package exceeds the expected size");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error("Official Nuvio package exceeds the expected size");
  const config = await readOfficialRuntimeConfigArchive(bytes, expectedHash);
  const clientId = parseOfficialMdbListRuntimeConfig(config);
  const matcher = /^[ \t]*MDBLIST_CLIENT_ID[ \t]*[:=][^\r\n]*/gm;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const line = `MDBLIST_CLIENT_ID=${clientId}`;
  const next = matcher.test(source)
    ? source.replace(matcher, line)
    : `${source}${source && !source.endsWith("\n") ? newline : ""}${line}${newline}`;
  await writeFile(target, next, { mode: 0o600 });
  return { changed: true };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.slice(2).some((flag) => flag !== "--if-missing"))
      throw new Error("Usage: node scripts/import-official-mdblist-config.mjs [--if-missing]");
    const result = await importOfficialMdbListConfig();
    console.log(
      `MDBList application config ${result.changed ? "prepared from Nuvio 1.2.7" : "already configured"}; application values are not logged.`
    );
  } catch (error) {
    console.error(String(error?.message || "Official MDBList configuration import failed"));
    process.exitCode = 1;
  }
}
