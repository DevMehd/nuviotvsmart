import assert from "node:assert/strict";
import { readEnvProperties } from "../scripts/envProperties.mjs";
import { createTextInputHarness } from "./helpers/vidaaTextInputHarness.mjs";

const { env } = await readEnvProperties({ rootDir: process.cwd() });
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__NUVIO_ENV__ = env;
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.HTMLButtonElement = class {};
const { AuthQrSignInScreen, QrLoginService, Router, I18n } =
  await import("../js/ui/screens/account/authQrSignInScreen.js");
Router.stack = [];
I18n.t = (key) => key;

const h = createTextInputHarness();
h.attachGlobals();
h.document.getElementById = () => h.container;
let starts = 0;
const screen = {
  ...AuthQrSignInScreen,
  render() {},
  startQr: async () => {
    starts += 1;
  }
};
await screen.mount();
assert.equal(screen.useQrLogin, true, "Official TV sign-in defaults to QR");
assert.equal(starts, 1);
assert.match(screen.renderActions(), /data-action="login-method"/);
const method = h.node("BUTTON", { id: "auth-login-method", dataset: { action: "login-method" } });
screen.bindControls();
screen.password = "fixture-password";
method.click();
assert.equal(screen.useEmailLogin, true, "Click switches to email without changing the server");
assert.equal(screen.password, "", "Switching methods clears the password draft");
assert.match(screen.renderLoginContent(), /auth-email-input/);
method.classList.add("focused");
await screen.onKeyDown(h.key(13, method));
assert.equal(screen.useQrLogin, true, "The TV remote can switch back to QR");
assert.equal(starts, 2);

let resolveStart;
QrLoginService.start = () =>
  new Promise((resolve) => {
    resolveStart = resolve;
  });
let renderedCodes = 0;
const loading = {
  ...AuthQrSignInScreen,
  render() {},
  renderQr() {
    renderedCodes += 1;
  },
  startPolling() {
    throw new Error("A cancelled QR request must not start polling");
  }
};
await loading.mount();
assert.equal(loading.isStartingQr, true);
loading.toggleLoginMethod();
resolveStart({ code: "fixture-device-code" });
await Promise.resolve();
await Promise.resolve();
assert.equal(renderedCodes, 0, "An in-flight QR result cannot overwrite the email screen");
assert.equal(loading.useEmailLogin, true);
assert.equal(loading.isStartingQr, false);

const nativeTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (fn) => {
  timers.set(++timerId, fn);
  return timerId;
};
globalThis.clearTimeout = (id) => timers.delete(id);
try {
  let resolvePoll;
  let exchanges = 0;
  let countdowns = 0;
  QrLoginService.poll = () =>
    new Promise((resolve) => {
      resolvePoll = resolve;
    });
  QrLoginService.exchange = async () => {
    exchanges += 1;
    return false;
  };
  const polling = {
    ...AuthQrSignInScreen,
    ...screen,
    startPolling: AuthQrSignInScreen.startPolling,
    isMounted: true,
    isLeaving: false,
    isSignedIn: false,
    useEmailLogin: false,
    useQrLogin: true,
    loginMethodGeneration: 10,
    startCountdown() {
      countdowns += 1;
    }
  };
  polling.startPolling("fixture-code", "fixture-nonce");
  const pending = timers.get(polling.pollTimer)();
  polling.toggleLoginMethod();
  resolvePoll({ status: "approved", expiresAt: Date.now() + 300000 });
  await pending;
  assert.equal(exchanges, 0, "Approval from a cancelled method must not exchange credentials");
  assert.equal(countdowns, 0, "A stale poll cannot restart its countdown");
  assert.equal(timers.size, 0, "Switching to email stops QR polling");
  polling.isExchangingQr = true;
  polling.toggleLoginMethod();
  assert.equal(
    polling.useEmailLogin,
    true,
    "Switching is blocked during an approved token exchange"
  );
  polling.isExchangingQr = false;
  polling.isSignedIn = true;
  assert.doesNotMatch(polling.renderActions(), /data-action="login-method"/);
} finally {
  globalThis.setTimeout = nativeTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
}
console.log(
  "PASS VIDAA QR/email methods: official default, click/remote navigation, password clearing and stale request/poll cancellation."
);
