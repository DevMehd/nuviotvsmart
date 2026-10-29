import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// New TV Sources screen (beta, T6): the StreamScreen suites for automatic play, resume, restore,
// startup overlap and play candidates, run again against NewSourcesScreen (--new-sources).
const suites = [
  "test-vidaa-stream-autoplay-loading.mjs",
  "test-vidaa-stream-startup-overlap.mjs",
  "test-vidaa-stream-restore-loading.mjs",
  "test-vidaa-stream-candidates.mjs"
];
for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(suite, import.meta.url)), "--new-sources"],
    { stdio: "inherit" }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`FAIL: ${suite} --new-sources`);
    process.exit(result.status || 1);
  }
}
console.log(`PASS: ${suites.length} StreamScreen suites green against the new Sources screen.`);
