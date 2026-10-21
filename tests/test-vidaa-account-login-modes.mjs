import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const account = await import("../js/ui/screens/account/authQrSignInScreen.js");
const {
  AuthQrSignInScreen,
  AuthManager,
  QrLoginService,
  QrCodeGenerator,
  Router,
  ScreenUtils,
  ServerConfigurationStore,
  I18n,
  Platform,
  savedLibraryRepository
} = account;
let methods = AuthQrSignInScreen;
const upstream = process.argv.includes("--upstream");
if (upstream) {
  const factories = [
    ["01-mount", "01"],
    ["02-bind-controls", "02"],
    ["03-to-friendly-email-error", "03"]
  ];
  methods = {};
  for (const [suffix, number] of factories) {
    const path = `js/ui/screens/account/authQrSignInScreenMethods-${suffix}.js`;
    const url = new URL(`../${path}`, import.meta.url);
    const source = execFileSync(
      "git",
      ["show", `cfec25654f0580028d9a78a41b037bcd48af2a29:${path}`],
      { encoding: "utf8" }
    ).replace(/from "(\.[^"]+)"/g, (_, relative) => `from "${new URL(relative, url).href}"`);
    const factory = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    Object.assign(methods, factory[`createAuthQrSignInScreenMethods${number}`]());
  }
}

let timerId = 0;
const timeouts = new Map();
const intervals = new Map();
globalThis.setTimeout = (callback) => {
  const id = ++timerId;
  timeouts.set(id, callback);
  return id;
};
globalThis.clearTimeout = (id) => timeouts.delete(id);
globalThis.setInterval = (callback) => {
  const id = ++timerId;
  intervals.set(id, callback);
  return id;
};
globalThis.clearInterval = (id) => intervals.delete(id);
let signedIn = false;
Object.defineProperty(AuthManager, "isAuthenticated", { configurable: true, get: () => signedIn });
I18n.t = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);
const navigations = [];
Router.stack = [];
Router.navigate = (route, params) => navigations.push({ route, params });
Platform.handleTextInputKey = () => false;
const focusSelectors = [];
ScreenUtils.indexFocusables = () => {};
ScreenUtils.handleDpadNavigation = () => false;
ScreenUtils.setInitialFocus = (container, selector) => {
  focusSelectors.push(selector);
  container.nodes.forEach((node) => node.classList.remove("focused"));
  container.querySelector(selector)?.classList.add("focused");
};
ScreenUtils.show = (container) => {
  container.style.display = "block";
};
ScreenUtils.hide = (container) => {
  container.style.display = "none";
};
const generatedCodes = [];
QrCodeGenerator.generate = (_, content) => generatedCodes.push(content);
const qrResult = (code) => ({
  code,
  deviceNonce: `nonce-${code}`,
  loginUrl: `https://fixture.invalid/login/${code}`,
  verificationUri: "https://fixture.invalid/login",
  expiresAt: Date.now() + 300000
});
const starts = [];
let configuration;
ServerConfigurationStore.getActive = () => configuration;
const config = (email, qr, extra = {}) => ({
  backendUrl: "https://fixture.invalid",
  publishableKey: "fixture-public",
  capabilities: { emailPasswordAuth: email, tvLogin: qr },
  isCustom: true,
  ...extra
});

class Element {
  constructor(tagName, attributes, container) {
    this.tagName = tagName.toUpperCase();
    this.container = container;
    this.attributes = attributes;
    this.id = this.attribute("id");
    this.dataset = { action: this.attribute("data-action") };
    this.listeners = new Map();
    this.innerText = "";
    const classes = new Set(this.attribute("class").split(/\s+/));
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    };
  }
  attribute(name) {
    return this.attributes.match(new RegExp(`${name}=["']([^"']*)["']`))?.[1] || "";
  }
  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
  click() {
    let stopped = false;
    this.container.listeners.get("click")?.({
      target: this,
      preventDefault() {},
      stopImmediatePropagation() {
        stopped = true;
      }
    });
    if (!stopped) this.listeners.get("click")?.();
  }
  closest() {
    return this;
  }
  matches(selector) {
    return selector.split(",").some((tag) => tag.trim().toUpperCase() === this.tagName);
  }
  setAttribute() {}
  querySelector(selector) {
    return selector === "canvas" ? {} : this.container.querySelector(selector);
  }
}
globalThis.HTMLButtonElement = Element;
function container() {
  return {
    style: {},
    nodes: [],
    markup: "",
    listeners: new Map(),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    contains(node) {
      return this.nodes.includes(node);
    },
    set innerHTML(value) {
      this.markup = value;
      this.nodes = [...value.matchAll(/<(button|input|div|canvas|p|form)\b([^>]*)>/g)].map(
        ([, tag, attributes]) => new Element(tag, attributes, this)
      );
    },
    get innerHTML() {
      return this.markup;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return this.nodes.filter((node) => {
        if (selector.startsWith("#")) return node.id === selector.slice(1);
        const action = selector.match(/^\[data-action=['"]([^'"]+)['"]\]$/);
        if (action) return node.dataset.action === action[1];
        if (selector.startsWith("."))
          return selector
            .slice(1)
            .split(".")
            .every((name) => node.classList.contains(name));
        return false;
      });
    }
  };
}
async function mount(ui, activeConfiguration = config(true, true)) {
  configuration = activeConfiguration;
  const host = container();
  globalThis.document = { getElementById: () => host };
  await ui.mount();
  return host;
}
function screen(overrides = {}) {
  return { ...methods, loadConnectedStats() {}, ...overrides };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("custom dual-capability server starts with email; QR/email menu works by click and remote", async () => {
  const ui = screen();
  const host = await mount(ui);
  assert.equal(ui.useEmailLogin, true);
  assert.equal(ui.useQrLogin, false);
  assert.equal(starts.length, 0);
  assert.equal(focusSelectors.at(-1), "#auth-email-input");
  ui.email = "fixture@example.invalid";
  ui.password = "fixture-password";
  ui.toggleServerMenu();
  assert.ok(host.markup.includes('data-action="login-qr"'));
  host.querySelector("[data-action='login-qr']").click();
  await settle();
  assert.equal(starts.length, 1);
  assert.equal(ui.useQrLogin, true);
  assert.equal(timeouts.size, 1);
  assert.equal(intervals.size, 1);
  const pollTimer = ui.pollTimer;
  const code = ui.qrResult.code;
  ui.setStatus("waiting fixture");
  ui.toggleServerMenu();
  assert.equal(ui.qrResult.code, code);
  assert.equal(ui.qrStatusText, "waiting fixture");
  assert.equal(host.querySelector("#qr-status").innerText, "waiting fixture");
  assert.equal(ui.pollTimer, pollTimer);
  assert.equal(timeouts.size, 1);
  assert.equal(intervals.size, 1);
  assert.ok(host.markup.includes('data-action="login-email"'));
  await ui.onKeyDown({ keyCode: 13 });
  assert.equal(ui.useEmailLogin, true);
  assert.equal(ui.qrResult, null);
  assert.equal(ui.qrStatusText, "");
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
  assert.equal(ui.email, "fixture@example.invalid");
  assert.equal(ui.password, "fixture-password");
  ui.cleanup();
});

for (const [name, email, qr, extra] of [
  ["official QR", false, true, { isCustom: false }],
  ["custom QR only", false, true, {}],
  ["custom email only", true, false, {}]
]) {
  test(`${name} keeps its default and offers no unsupported login switch`, async () => {
    const ui = screen();
    const host = await mount(ui, config(email, qr, extra));
    await settle();
    assert.equal(ui.useEmailLogin, email);
    assert.equal(ui.useQrLogin, qr);
    assert.equal(starts.length, qr ? 1 : 0);
    ui.toggleServerMenu();
    assert.ok(!/data-action="login-(?:qr|email)"/.test(host.markup));
    ui.cleanup();
  });
}

test("signed-in and busy QR/email requests preserve upstream switch blockers", async () => {
  for (const flag of [
    "isLeaving",
    "isSignedIn",
    "isStartingQr",
    "isPolling",
    "isEmailSubmitting"
  ]) {
    const ui = screen();
    await mount(ui);
    ui[flag] = true;
    ui.toggleLoginMode(false);
    assert.equal(ui.useEmailLogin, true, flag);
    assert.equal(starts.length, 0, flag);
    ui.cleanup();
  }
  signedIn = true;
  const ui = screen();
  const host = await mount(ui);
  ui.toggleServerMenu();
  assert.ok(!host.markup.includes('data-action="login-qr"'));
  ui.cleanup();
});

test("stale QR start cannot populate an email remount", async () => {
  const pending = deferred();
  QrLoginService.start = () => pending.promise;
  const ui = screen();
  await mount(ui, config(false, true));
  ui.cleanup();
  const host = await mount(ui, config(true, false));
  pending.resolve(qrResult("OLD"));
  await settle();
  assert.equal(ui.qrResult, null);
  assert.equal(ui.qrStatusText, "");
  assert.equal(generatedCodes.length, 0);
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
  assert.ok(host.markup.includes("auth-email-form"));
  ui.cleanup();
});

for (const rejectOld of [false, true]) {
  test(`stale QR start ${rejectOld ? "error" : "result"} preserves a new pending QR request`, async () => {
    const old = deferred();
    const fresh = deferred();
    let calls = 0;
    QrLoginService.start = () => (++calls === 1 ? old.promise : fresh.promise);
    const ui = screen();
    await mount(ui, config(false, true));
    ui.cleanup();
    await mount(ui, config(false, true));
    const newStatus = ui.qrStatusText;
    if (rejectOld) old.reject(new Error("old request failed"));
    else old.resolve(qrResult("OLD"));
    await settle();
    assert.equal(ui.isStartingQr, true, "Old finally cannot unlock the new request");
    assert.equal(ui.qrResult, null);
    assert.equal(ui.qrStatusText, newStatus);
    assert.equal(timeouts.size, 0);
    fresh.resolve(qrResult("NEW"));
    await settle();
    assert.equal(ui.isStartingQr, false);
    assert.equal(ui.qrResult.code, "NEW");
    assert.deepEqual(generatedCodes, ["https://fixture.invalid/login/NEW"]);
    assert.equal(timeouts.size, 1);
    ui.cleanup();
  });
}

test("stale poll cannot exchange credentials or reset a new poll after QR remount", async () => {
  const oldPoll = deferred();
  const newPoll = deferred();
  const pollCodes = [];
  const exchangeCodes = [];
  QrLoginService.poll = (code) => {
    pollCodes.push(code);
    return pollCodes.length === 1 ? oldPoll.promise : newPoll.promise;
  };
  QrLoginService.exchange = async (code) => {
    exchangeCodes.push(code);
    return true;
  };
  let calls = 0;
  QrLoginService.start = async () => qrResult(++calls === 1 ? "OLD" : "NEW");
  const ui = screen();
  await mount(ui, config(false, true));
  await settle();
  const oldCallback = timeouts.get(ui.pollTimer);
  const oldPending = oldCallback();
  assert.equal(ui.isPolling, true);
  ui.cleanup();
  await mount(ui, config(false, true));
  await settle();
  const newPending = timeouts.get(ui.pollTimer)();
  const newStatus = ui.qrStatusText;
  const newTimer = ui.pollTimer;
  oldPoll.resolve({ status: "approved", expiresAt: Date.now() + 10000, pollIntervalSeconds: 9 });
  await oldPending;
  assert.equal(ui.isPolling, true);
  assert.equal(ui.qrStatusText, newStatus);
  assert.equal(ui.qrPollIntervalSeconds, 3);
  assert.equal(ui.qrResult.code, "NEW");
  assert.equal(ui.pollTimer, newTimer);
  assert.deepEqual(exchangeCodes, []);
  newPoll.resolve({ status: "pending" });
  await newPending;
  assert.equal(ui.isPolling, false);
  assert.equal(ui.qrStatusText, "auth.qr.waitingApproval");
  ui.cleanup();
});

test("stale connected statistics never replace a new mount's pending stats", async () => {
  signedIn = true;
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  savedLibraryRepository.getAll = () => (++calls === 1 ? old.promise : fresh.promise);
  const ui = screen({ loadConnectedStats: methods.loadConnectedStats, updateConnectedStats() {} });
  await mount(ui);
  ui.cleanup();
  await mount(ui);
  old.resolve([{}, {}]);
  await settle();
  assert.equal(ui.connectedStats, null);
  assert.equal(ui.isConnectedStatsLoading, true);
  fresh.resolve([]);
  await settle();
  assert.equal(ui.connectedStats.library, 0);
  assert.equal(ui.isConnectedStatsLoading, false);
  ui.cleanup();
});

test("webOS key/click pairs cannot switch login mode twice or swallow consecutive OK actions", async () => {
  globalThis.__NUVIO_PLATFORM__ = "webos";
  Platform.current = null;
  const ui = screen();
  const host = await mount(ui);
  const menu = host.querySelector("[data-action='server-menu']");
  menu.classList.add("focused");
  let prevented = 0;
  await ui.onKeyDown({
    keyCode: 13,
    preventDefault() {
      prevented++;
    }
  });
  assert.equal(ui.isServerMenuOpen, true);
  host.querySelector("[data-action='login-qr']").click();
  assert.equal(ui.useEmailLogin, true, "The paired click after render must be consumed");
  const qr = host.querySelector("[data-action='login-qr']");
  host.nodes.forEach((node) => node.classList.remove("focused"));
  qr.classList.add("focused");
  await ui.onKeyDown({
    keyCode: 13,
    preventDefault() {
      prevented++;
    }
  });
  await settle();
  assert.equal(ui.useQrLogin, true, "The next deliberate OK must still activate");
  assert.equal(starts.length, 1);
  assert.equal(prevented, 2);
  ui.cleanup();
});

test("webOS deduplication preserves same-kind actions and never consumes text-input clicks", async () => {
  globalThis.__NUVIO_PLATFORM__ = "webos";
  Platform.current = null;
  const ui = screen();
  const host = await mount(ui);
  assert.equal(ui.isActivationDuplicated("keydown"), false);
  assert.equal(ui.isActivationDuplicated("keydown"), false);
  const previous = ui.lastActivation;
  host.querySelector("#auth-email-input").click();
  assert.equal(ui.lastActivation, previous);
  assert.equal(ui.isActivationDuplicated("click"), true);
  assert.equal(ui.isActivationDuplicated("click"), false);
  assert.equal(ui.isActivationDuplicated("click"), false);
  ui.cleanup();
  assert.equal(ui.lastActivation, null);
});

let failures = 0;
for (const { name, run } of tests) {
  if (upstream && !name.startsWith("stale")) continue;
  signedIn = false;
  globalThis.__NUVIO_PLATFORM__ = "vidaa";
  Platform.current = null;
  starts.length = 0;
  generatedCodes.length = 0;
  navigations.length = 0;
  focusSelectors.length = 0;
  timeouts.clear();
  intervals.clear();
  QrLoginService.start = async () => {
    const result = qrResult(`CODE${starts.length + 1}`);
    starts.push(result);
    return result;
  };
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}
assert.equal(failures, 0);
console.log(`${tests.length}/${tests.length} account login mode and lifecycle cases passed.`);
