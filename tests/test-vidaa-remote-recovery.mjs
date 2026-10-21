import assert from "node:assert/strict";
import { FocusEngine } from "../js/ui/navigation/focusEngine.js";
import { Router } from "../js/ui/navigation/routerState.js";
import { Platform } from "../js/platform/index.js";
import {
  isVidaaNavigationBusy,
  resetVidaaNavigationActivity
} from "../js/ui/navigation/vidaaNavigationActivity.js";

let now = 1000;
Date.now = () => now;
const documentListeners = new Map();
const windowListeners = new Map();
globalThis.document = {
  contains: () => true,
  body: { classList: { contains: () => false } },
  addEventListener(name, handler) {
    documentListeners.set(name, handler);
  },
  visibilityState: "visible"
};
globalThis.window = {
  addEventListener(name, handler) {
    windowListeners.set(name, handler);
  }
};
const downs = [];
const ups = [];
let backCalls = 0;
let holdCancellations = 0;
let homeHoldCancellations = 0;
let homeEnterCancellations = 0;
Router.getCurrentScreen = () => ({
  onKeyDown: (event) => downs.push(event),
  onKeyUp: (event) => ups.push(event),
  cancelPendingPosterHold: () => holdCancellations++,
  cancelPendingContinueWatchingHold: () => homeHoldCancellations++,
  cancelPendingContinueWatchingEnter: () => homeEnterCancellations++
});
Router.consumeRouteReturnBackGuard = () => false;
Router.back = () => backCalls++;

function platform(name) {
  globalThis.__NUVIO_PLATFORM__ = name;
  Platform.current = null;
}

function engine() {
  return {
    ...FocusEngine,
    lastBackHandledAt: 0,
    activeKeyDownStartedAt: new Map(),
    activeBackKeyIdentities: new Set(),
    nativeTextKeyIdentities: new Set()
  };
}

function event(keyCode, repeat = false, extra = {}) {
  return {
    keyCode,
    repeat,
    target: { tagName: "DIV" },
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...extra
  };
}

platform("vidaa");

// A system overlay can swallow keyup. A later ordinary OK press must recover
// instead of remaining classified as a held OK for the lifetime of the app.
{
  const focus = engine();
  const before = downs.length;
  now = 1000;
  focus.handleKey(event(13));
  now = 1100;
  focus.handleKey(event(13));
  assert.equal(downs.length, before + 1);
  now = 2300;
  focus.handleKey(event(0, false, { key: "Enter" }));
  assert.equal(downs.length, before + 2, "A quiet gap recovers a missing OK release");
  focus.handleKeyUp(event(13));
  assert.equal(ups.at(-1).keyDownDurationMs, 0, "The recovered key owns a fresh hold clock");
}

// Expiry is based on silence, not total hold duration. A real hold that keeps
// emitting remote events remains one action even when native repeat is absent.
{
  const focus = engine();
  const before = downs.length;
  now = 3000;
  for (; now <= 8000; now += 100) focus.handleKey(event(13));
  assert.equal(downs.length, before + 1, "Long holds must never reactivate OK");
  focus.handleKeyUp(event(13));
  assert.equal(ups.at(-1).keyDownDurationMs, 5100);
  now += 1200;
  focus.handleKey(event(13, true));
  assert.equal(downs.length, before + 1, "A native OK repeat is never a fresh activation");
}

// Direction and Back aliases recover the same normalized key cycle. Clock
// corrections must not keep stale input latched either.
{
  const focus = engine();
  now = 10000;
  focus.handleKey(event(39));
  now = 11100;
  focus.handleKey(event(0, false, { keyName: "DpadRight" }));
  assert.equal(downs.at(-1).repeat, false, "The first arrow after silence is immediate");
  now = 100;
  focus.handleKey(event(39));
  assert.equal(downs.at(-1).repeat, false, "A backwards clock releases a stale cycle");
  now = 12000;
  const beforeBack = backCalls;
  focus.handleKey(event(461));
  now = 12400;
  focus.handleKey(event(0, false, { key: "Back" }));
  assert.equal(backCalls, beforeBack + 1, "One Back cycle only navigates once");
  now = 14000;
  focus.handleKey(event(461));
  assert.equal(backCalls, beforeBack + 2, "Back recovers when firmware loses keyup");
}

// Reset immediately when the TV interrupts the app: no timer or hidden
// polling loop is needed, and a resumed first press has no inherited latch.
{
  const focus = engine();
  focus.init();
  for (const interrupt of ["blur", "pagehide", "visibilitychange", "webkitvisibilitychange"]) {
    now += 2000;
    focus.handleKey(event(40));
    focus.handleKey(event(13));
    focus.activeBackKeyIdentities.add("back");
    focus.nativeTextKeyIdentities.add("code:37");
    assert.equal(isVidaaNavigationBusy(), true);
    const cancelledBefore = holdCancellations;
    const homeHoldBefore = homeHoldCancellations;
    const homeEnterBefore = homeEnterCancellations;
    if (interrupt === "visibilitychange") document.visibilityState = "hidden";
    if (interrupt === "webkitvisibilitychange") document.webkitHidden = true;
    (windowListeners.get(interrupt) || documentListeners.get(interrupt))();
    assert.equal(focus.activeKeyDownStartedAt.size, 0);
    assert.equal(focus.activeBackKeyIdentities.size, 0);
    assert.equal(focus.nativeTextKeyIdentities.size, 0);
    assert.equal(isVidaaNavigationBusy(), false);
    assert.equal(holdCancellations, cancelledBefore + 1, "Interrupted poster holds are cancelled");
    assert.equal(homeHoldCancellations, homeHoldBefore + 1, "Interrupted Home holds are cancelled");
    assert.equal(
      homeEnterCancellations,
      homeEnterBefore + 1,
      "Interrupted Home opens are cancelled"
    );
    document.visibilityState = "visible";
    document.webkitHidden = false;
    const before = downs.length;
    focus.handleKey(event(13));
    assert.equal(downs.length, before + 1, "The resumed OK press remains responsive");
    focus.handleKeyUp(event(13));
  }
}

// Other platforms retain their current key routing and lifecycle behavior.
for (const name of ["tizen", "webos", "browser"]) {
  platform(name);
  const focus = engine();
  now += 2000;
  focus.handleKey(event(39));
  const startedAt = focus.activeKeyDownStartedAt.get("code:39");
  focus.resetVidaaKeyState();
  assert.equal(focus.activeKeyDownStartedAt.get("code:39"), startedAt);
  now += 3000;
  focus.handleKey(event(39, true));
  assert.equal(downs.at(-1).repeat, true, `${name} preserves its native repeat flag`);
}

resetVidaaNavigationActivity();
console.log(
  "VIDAA remote recovery passed: lost releases, long holds, Back aliases, app interruption and platform isolation."
);
