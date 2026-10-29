// Lot E1: VIDAA module build loads router screens on first mount (js/ui/navigation/lazyRouteScreen.js).
import assert from "node:assert/strict";
import { Router } from "../js/ui/navigation/routerState.js";
import { lazyRouteScreen } from "../js/ui/navigation/lazyRouteScreen.js";

const mounts = [];
const makeScreen = (name) => ({
  name,
  mount: async (params, context) => mounts.push([name, params, context]),
  getRouteStateKey: () => `${name}:key`
});
const HomeScreen = makeScreen("home");
let releaseDetail;
let detailLoads = 0;
const DetailScreen = makeScreen("detail");
const detail = lazyRouteScreen(() => {
  detailLoads++;
  return new Promise((resolve) => (releaseDetail = () => resolve(DetailScreen)));
});
let failNext = 0;
let settingsLoads = 0;
const SettingsScreen = makeScreen("settings");
const settings = lazyRouteScreen(async () => {
  settingsLoads++;
  if (failNext-- > 0) throw new Error("chunk 404");
  return SettingsScreen;
});
let homeGetterCalls = 0;
Router.routes = {
  get home() {
    homeGetterCalls++;
    return HomeScreen;
  },
  detail,
  settings
};

// First mount loads once, puts the real screen in its slot and mounts it.
let params = { id: "tt1" };
Router.current = "detail";
Router.currentParams = params;
const first = detail.mount(params, { routeStateKey: null });
const concurrent = detail.mount(params, { routeStateKey: null });
releaseDetail();
await Promise.all([first, concurrent]);
assert.equal(detailLoads, 1, "one chunk load shared by concurrent mounts");
assert.equal(Router.routes.detail, DetailScreen, "route slot now holds the real screen");
assert.equal(homeGetterCalls, 0, "the home getter is never read or replaced");
assert.equal(mounts.filter(([name]) => name === "detail").length, 2);
assert.equal(Router.routes.detail.getRouteStateKey(), "detail:key");

// A navigation that went stale while the chunk loaded mounts nothing.
mounts.length = 0;
params = {};
Router.current = "settings";
Router.currentParams = params;
const pending = settings.mount(params, {});
Router.current = "home"; // Back pressed before the chunk arrived.
Router.currentParams = {};
await pending;
assert.equal(mounts.length, 0, "stale navigation does not mount the screen");
assert.equal(Router.routes.settings, SettingsScreen, "the loaded screen still fills its slot");

// Back while the chunk loads returns to the caller (history still holds it) instead
// of history.back(), which would skip the caller.
const pendingBacks = [];
Router.backFromPendingNavigation = async () => pendingBacks.push(Router.current);
const slow = lazyRouteScreen(
  () => new Promise((resolve) => (releaseDetail = () => resolve(DetailScreen)))
);
Router.routes = { detail: slow };
Router.current = "detail";
Router.currentParams = params = { id: "tt2" };
mounts.length = 0;
const slowMount = slow.mount(params, {});
assert.equal(Router.getCurrentScreen?.() ?? Router.routes.detail, slow);
// Cold launch: the first screen (sign-in, onboarding) has no caller yet. Back must not
// open Home in its place; the screen handles the next Back once mounted.
Router.historyInitialized = false;
assert.equal(slow.consumeBackRequest(), true, "Back is consumed before the first screen");
assert.deepEqual(pendingBacks, [], "no caller to return to before the first screen");
Router.historyInitialized = true;
assert.equal(slow.consumeBackRequest(), true, "Back is consumed while the chunk loads");
assert.deepEqual(pendingBacks, ["detail"], "the caller is restored from history");
Router.current = "stream"; // backFromPendingNavigation navigated away.
releaseDetail();
await slowMount;
assert.equal(mounts.length, 0, "the late chunk does not mount over the restored caller");

// A failed load is retried; one page reload covers a chunk of a replaced deployment.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
let reloads = 0;
globalThis.location = { reload: () => reloads++ };
const retry = lazyRouteScreen(async () => {
  settingsLoads++;
  if (failNext-- > 0) throw new Error("chunk 404");
  return SettingsScreen;
});
Router.routes = { detail: DetailScreen, settings: retry };
Router.current = "settings";
Router.currentParams = params;
failNext = 2;
await retry.mount(params, {});
assert.equal(reloads, 1, "first failure reloads the page once");
// During boot the guard is active: the error reaches it and no screen is restored.
const backs = [];
Router.backFromPendingNavigation = async () => backs.push(Router.current);
globalThis.NuvioBootGuard = { isActive: () => true };
await assert.rejects(retry.mount(params, {}), /chunk 404/, "second failure reaches the boot guard");
assert.equal(backs.length, 0, "no screen mounted under the boot error");
// After boot the guard shows nothing: the previous screen comes back, history untouched.
globalThis.NuvioBootGuard = { isActive: () => false };
failNext = 1;
await assert.rejects(retry.mount(params, {}), /chunk 404/);
assert.deepEqual(backs, ["settings"], "previous screen restored, no blank screen");
assert.equal(reloads, 1, "no reload loop");
await retry.mount(params, {});
assert.equal(Router.routes.settings, SettingsScreen, "a later attempt loads again and succeeds");
assert.equal(store.size, 0, "success clears the reload flag");
assert.deepEqual(mounts.at(-1)[0], "settings");

// A route behind a session switch (router "stream": getter + setter over two slots) gets
// the loaded screen in the slot of the session mode, without a strict-mode TypeError.
{
  const OldSources = makeScreen("oldSources");
  const NewSources = makeScreen("newSources");
  const slots = {
    off: lazyRouteScreen(async () => OldSources),
    on: lazyRouteScreen(async () => NewSources)
  };
  const offPlaceholder = slots.off;
  let mode = "on";
  homeGetterCalls = 0;
  Router.routes = {
    get home() {
      homeGetterCalls++;
      return HomeScreen;
    },
    get stream() {
      return slots[mode];
    },
    set stream(screen) {
      slots[mode] = screen;
    }
  };
  mounts.length = 0;
  Router.current = "stream";
  Router.currentParams = params = { id: "tt3" };
  await Router.routes.stream.mount(params, {});
  assert.equal(Router.routes.stream, NewSources, "the session slot holds the loaded screen");
  assert.equal(slots.off, offPlaceholder, "the other mode's slot is untouched");
  assert.equal(homeGetterCalls, 0, "the home getter is still never read");
  assert.deepEqual(mounts.at(-1)[0], "newSources");
  mode = "off";
  await Router.routes.stream.mount(params, {});
  assert.equal(Router.routes.stream, OldSources);
}

console.log(
  "PASS: VIDAA lazy route screens load once, ignore stale navigation and recover from a missing chunk."
);
