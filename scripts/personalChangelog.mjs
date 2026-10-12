import { readFile } from "node:fs/promises";
import path from "node:path";

export function parsePersonalChangelog(markdown, version) {
  const sections = String(markdown || "").split(/^##\s+/m);
  const latest = sections[1] || "";
  const newline = latest.indexOf("\n");
  const heading = latest.slice(0, newline).trim();
  const notes = latest.slice(newline + 1).trim();
  const match = heading.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.+)$/);
  if (!match || match[2] !== version || !notes) {
    throw new Error("CHANGELOG.fr.md must start with a dated entry for the current app version.");
  }
  return { tag: version, date: match[1], notes };
}

export async function readPersonalChangelog(rootDir, version) {
  return parsePersonalChangelog(
    await readFile(path.join(rootDir, "CHANGELOG.fr.md"), "utf8"),
    version
  );
}
