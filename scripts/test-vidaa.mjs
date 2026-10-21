import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = new URL("../tests/", import.meta.url);
// This manual probe depends on local diagnostic scripts excluded from the repository.
// test-vidaa-account-login-modes.mjs covers upstream's sign-in flow, which this fork does not
// adopt: the personal QR/email/local login is kept and covered by test-vidaa-qr-login-method.mjs
// and test-vidaa-shared-backend.mjs.
const localOnlyTests = new Set([
  "test-vidaa-embedded-text-access.mjs",
  "test-vidaa-account-login-modes.mjs"
]);
const tests = (await readdir(directory))
  .filter((name) => /^test-vidaa-.+\.mjs$/.test(name) && !localOnlyTests.has(name))
  .sort();
for (const test of tests) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(test, directory))], {
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  `PASS: ${tests.length} VIDAA test suites. The real DOM Home check runs separately in tests/test-vidaa-home-patching.html.`
);
