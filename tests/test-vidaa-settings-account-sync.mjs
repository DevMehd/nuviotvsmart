import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.__NUVIO_ENV__ = {
  NUVIO_ACCOUNT_BACKEND_MODE: "shared",
  NUVIO_SUPABASE_URL: "https://account.example",
  NUVIO_SUPABASE_ANON_KEY: "sb_publishable_fixture_public_key"
};
const { SettingsScreen } = await import("../js/ui/screens/settings/settingsScreen.js");
const { AuthManager } = await import("../js/core/auth/authManager.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { SessionStore } = await import("../js/core/storage/sessionStore.js");
const { I18n } = await import("../js/i18n/index.js");
I18n.t = (key, _args, options) => options?.fallback || key;
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) =>
  nativeTimeout(callback, delay >= 10000 ? 20 : delay, ...args);
function signedIn() {
  AuthManager.sessionGeneration++;
  AuthManager.setState(AuthState.AUTHENTICATED);
  SessionStore.accessToken = `x.${Buffer.from(
    JSON.stringify({
      sub: "fixture-user",
      email: "fixture@example.invalid",
      exp: Date.now() / 1000 + 3600
    })
  ).toString("base64url")}.x`;
}
const payload = {
  profiles: { 1: { name: "Remote profile" } },
  addons: { 1: 3 },
  plugins: { 1: 2 },
  library_items: { 1: 4 },
  watch_progress: { 1: 5 },
  watched_items: { 1: 6 }
};
function screen() {
  return {
    ...SettingsScreen,
    isMounted: true,
    settingsMountToken: 1,
    activeSection: "account",
    container: { style: {}, querySelector: () => null, removeEventListener() {} },
    model: { authState: "authenticated", accountSyncOverviewLoading: true },
    actionMap: new Map(),
    rendered: [],
    remoteModelReads: 0,
    renderSectionHeader: () => "",
    persistUiState() {},
    stopDebridDeviceAuth() {},
    collectModel() {
      this.remoteModelReads++;
      return new Promise(() => {});
    },
    async render(options = {}) {
      this.rendered.push(options);
      if (options.refreshModel !== false) await this.collectModel();
      this.html = this.renderAccountSection(this.model);
    }
  };
}
async function settled(owner) {
  const pending = owner.accountSyncOverviewPromise;
  let timer;
  try {
    await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = nativeTimeout(() => reject(Error("Sync overview remained pending")), 500);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

signedIn();
globalThis.fetch = async () => new Response(JSON.stringify(payload));
const success = screen();
success.ensureAccountSyncOverview();
await settled(success);
assert.equal(success.remoteModelReads, 0, "Rendering sync data must not wait for addon manifests");
assert.equal(success.model.accountSyncOverviewLoading, false);
assert.equal(success.model.accountSyncOverview.totalAddons, 3);
assert.equal(success.model.accountSyncOverview.totalWatchedItems, 6);
assert.equal(success.html.includes("Loading sync data"), false);
assert.equal(success.rendered.at(-1).refreshModel, false);

signedIn();
globalThis.fetch = async () => new Response('{"message":"offline"}', { status: 500 });
const failed = screen();
failed.ensureAccountSyncOverview();
await settled(failed);
assert.equal(failed.model.accountSyncOverviewLoading, false);
assert.equal(failed.model.accountSyncOverviewError, true);
assert.equal(failed.html.includes('data-focus-key="account:sync-retry"'), true);
globalThis.fetch = async () => new Response(JSON.stringify(payload));
failed.actionMap.get("account:sync-retry")();
await settled(failed);
assert.equal(failed.model.accountSyncOverviewError, false);
assert.equal(failed.model.accountSyncOverview.totalLibrary, 4);

for (const legacy of [false, true]) {
  signedIn();
  const previous = globalThis.AbortController;
  if (legacy) globalThis.AbortController = undefined;
  try {
    globalThis.fetch = () => new Promise(() => {});
    const stalled = screen();
    stalled.ensureAccountSyncOverview();
    await settled(stalled);
    assert.equal(stalled.model.accountSyncOverviewLoading, false);
    assert.equal(stalled.model.accountSyncOverviewError, true);
    assert.equal(stalled.remoteModelReads, 0);
  } finally {
    globalThis.AbortController = previous;
  }
}

signedIn();
let release;
globalThis.fetch = () =>
  new Promise((resolve) => {
    release = resolve;
  });
const stale = screen();
stale.ensureAccountSyncOverview();
const old = stale.accountSyncOverviewPromise;
for (let attempts = 0; !release && attempts < 100; attempts++) {
  await new Promise((resolve) => nativeTimeout(resolve, 1));
}
assert.ok(release, "The overview request was dispatched");
stale.cleanup();
stale.isMounted = true;
stale.activeSection = "account";
signedIn();
globalThis.fetch = async () => new Response(JSON.stringify({ ...payload, addons: { 1: 7 } }));
stale.ensureAccountSyncOverview();
await settled(stale);
release(new Response(JSON.stringify(payload)));
await old;
assert.equal(
  stale.model.accountSyncOverview.totalAddons,
  7,
  "A previous mount/session cannot restore old counters"
);
assert.equal(stale.model.accountSyncOverviewLoading, false);

AuthManager.sessionGeneration++;
AuthManager.setState(AuthState.SIGNED_OUT);
stale.ensureAccountSyncOverview();
assert.equal(stale.model.accountSyncOverview, null);
assert.equal(stale.model.accountSyncOverviewLoading, false);
globalThis.setTimeout = nativeTimeout;
console.log(
  "PASS: Settings Account updates without addon waits, bounded failures, retry, legacy timeout and stale session protection."
);
