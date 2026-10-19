import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const directory = new URL("../tests/", import.meta.url);
const tests = (await readdir(directory)).filter((name) => /^test-perso-.+\.mjs$/.test(name)).sort();
for (const name of tests) {
  const result = spawnSync(process.execPath, [new URL(name, directory).pathname], {
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} personal test suites. TV validation remains separate.`);
