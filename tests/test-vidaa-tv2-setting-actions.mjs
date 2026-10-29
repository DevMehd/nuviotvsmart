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
const sources = await import("../js/ui/tv2/newSourcesSetting.js");
const { Router, StreamScreen } = await import("../js/ui/navigation/router.js");
const { NewSourcesScreen } = await import("../js/ui/tv2/sources/newSourcesScreen.js");
const { Platform } = await import("../js/platform/index.js");

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

// "Nouvel écran Sources (bêta)": same pattern, modes off/on.
assert.ok(
  screen.actionMap.has("layout:newSources"),
  "the Sources beta action exists outside VIDAA"
);
screen.actionMap.get("layout:newSources")();
assert.deepEqual(
  screen.dialogs[1].options.map((o) => o.id),
  ["off", "on"]
);
assert.equal(sources.getNewSourcesMode(), "off", "off by default");
assert.equal(Router.routes.stream, StreamScreen, "off keeps the current Sources screen");
screen.dialogs[1].onSelect({ id: "on" });
assert.equal(sources.getNewSourcesMode(), "on", "choosing On stores the mode");
assert.equal(Router.routes.stream, StreamScreen, "read once per run: no switch under a session");
sources.resetSessionNewSourcesMode();
assert.equal(Router.routes.stream, NewSourcesScreen, "next run opens the new Sources screen");
assert.equal(sources.setNewSourcesMode("bogus"), "off", "unknown modes clear the setting");
assert.equal(store.has("tvNewSources"), false);
assert.equal(Router.routes.stream, NewSourcesScreen, "still the session choice");

// The route slot accepts the screen loaded by the VIDAA lazy build, for the session mode only.
const loaded = { name: "loaded" };
Router.routes.stream = loaded;
assert.equal(Router.routes.stream, loaded);
sources.resetSessionNewSourcesMode();
assert.equal(Router.routes.stream, StreamScreen, "the other mode's slot is untouched");
sources.setNewSourcesMode("on");
sources.resetSessionNewSourcesMode();
Router.routes.stream = NewSourcesScreen;

// webOS: the beta is not offered (Magic Remote and native action not covered) and is forced off.
Platform.current = null;
globalThis.__NUVIO_PLATFORM__ = "webos";
assert.equal(sources.getNewSourcesMode(), "off", "webOS ignores a stored On");
sources.resetSessionNewSourcesMode();
assert.equal(Router.routes.stream, StreamScreen);
Platform.current = null;
globalThis.__NUVIO_PLATFORM__ = "web";
sources.setNewSourcesMode("off");
sources.resetSessionNewSourcesMode();
console.log(
  "PASS: new Home and new Sources setting actions on every platform, Sources route read once"
);
