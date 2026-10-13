import assert from "node:assert/strict";
import { createTextInputHarness, TestEvent } from "./helpers/vidaaTextInputHarness.mjs";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const { SharedPluginScreen, normalizeInstallUrl } =
  await import("../js/ui/screens/plugin/sharedPluginScreen.js");
const manifest = `https://addon.example/${"abcdef0123456789".repeat(1250)}/manifest.json?lang=it&key=fixture`;

const h = createTextInputHarness();
h.attachGlobals();
globalThis.Event = h.root.Event;
const field = h.node("INPUT", { id: "shared-addon-url", type: "text", value: manifest });
const install = h.node("BUTTON", { dataset: { action: "install" } });
const calls = [];
const screen = {
  ...SharedPluginScreen,
  container: h.container,
  url: manifest.slice(0, 256),
  async change(action, value) {
    calls.push({ action, value });
  }
};
// Some mobile keyboards change .value without an input event or before polling.
await screen.activate(install);
assert.equal(
  calls[0].value,
  manifest,
  "Install must use the full live value even before keyboard polling"
);
assert.equal(normalizeInstallUrl(calls[0].value), manifest);

screen.bindInstallUrlInput(field);
field.focus();
field.value = "short value";
field.selectionStart = 0;
field.selectionEnd = field.value.length;
const pasted = h.dispatch(
  new TestEvent("paste", {
    clipboardData: { getData: (format) => (format === "text/plain" ? manifest : "") }
  }),
  field
);
assert.equal(pasted.defaultPrevented, true);
assert.equal(
  field.value,
  manifest,
  "Paste must retain a configured manifest longer than 20,000 characters"
);
assert.equal(screen.url, manifest);
assert.equal(
  field.maxLength,
  65536,
  "The native keyboard receives an explicit generous text limit"
);
await screen.activate(install);
assert.equal(calls.at(-1).value, manifest);

field.value = "prefix::suffix";
field.selectionStart = 7;
field.selectionEnd = 7;
h.dispatch(new TestEvent("paste", { clipboardData: { getData: () => manifest } }), field);
assert.equal(
  field.value,
  `prefix:${manifest}:suffix`,
  "Paste respects the selection and existing text"
);

const native = h.dispatch(new TestEvent("paste"), field);
assert.equal(native.defaultPrevented, false, "No clipboard payload leaves the native path intact");
field.value = manifest;
h.native("change", field);
assert.equal(screen.url, manifest, "A change-only keyboard commit retains the complete URL");
field.isConnected = false;
screen.url = "new screen draft";
h.native("change", field);
assert.equal(
  screen.url,
  "new screen draft",
  "A detached field cannot restore its old URL after a render"
);
console.log(
  "PASS: long addon URLs, full clipboard paste, cursor selection and silent/change-only mobile input."
);
