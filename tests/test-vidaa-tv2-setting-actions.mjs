import assert from "node:assert/strict";

// The "Nouvel accueil (bêta)" row is shown on every platform, so its action must exist everywhere.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "web";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { registerLayoutActions } =
  await import("../js/ui/screens/settings/settingsLayoutActions.js");
const { getNewHomeMode } = await import("../js/ui/tv2/newHomeSetting.js");

const screen = {
  actionMap: new Map(),
  dialogs: [],
  openOptionDialog(options) {
    this.dialogs.push(options);
  }
};
registerLayoutActions.call(screen, {});
assert.ok(screen.actionMap.has("layout:newHome"), "the beta setting action exists outside VIDAA");
screen.actionMap.get("layout:newHome")();
assert.equal(screen.dialogs.length, 1, "it opens the option dialog");
assert.deepEqual(
  screen.dialogs[0].options.map((o) => o.id),
  ["off", "dom", "webgl"]
);
screen.dialogs[0].onSelect({ id: "dom" });
assert.equal(getNewHomeMode(), "dom", "choosing DOM stores the mode");
console.log("PASS: new Home setting action on every platform");
