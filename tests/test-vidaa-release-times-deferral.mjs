import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const { whenNavigationCalm } = await import("../js/data/repository/metaRepository.js");
const { noteVidaaNavigationKeyDown, noteVidaaNavigationKeyUp, resetVidaaNavigationActivity } =
  await import("../js/ui/navigation/vidaaNavigationActivity.js");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exact release times are looked up once the remote is calm, never during held navigation.
resetVidaaNavigationActivity();
let runs = 0;
whenNavigationCalm(() => (runs += 1));
assert.equal(runs, 1, "idle navigation runs at once");

noteVidaaNavigationKeyDown(39);
whenNavigationCalm(() => (runs += 1));
await wait(450);
assert.equal(runs, 1, "held key defers the work");
noteVidaaNavigationKeyUp(39);
await wait(300);
assert.equal(runs, 1, "still inside the calm window after release");
await wait(700);
assert.equal(runs, 2, "runs once navigation is calm");

console.log("PASS: VIDAA release-time lookups wait for calm navigation.");
