import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
  get length() {
    return values.size;
  },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};
globalThis.sessionStorage = { removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.__NUVIO_ENV__ = {
  NUVIO_ACCOUNT_BACKEND_MODE: "shared",
  NUVIO_SUPABASE_URL: "https://account.example",
  NUVIO_SUPABASE_ANON_KEY: "sb_publishable_fixture_public_key"
};

const { AuthManager } = await import("../js/core/auth/authManager.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { SessionStore } = await import("../js/core/storage/sessionStore.js");
const { SupabaseApi } = await import("../js/data/remote/supabase/supabaseApi.js");
const { fetchSupabaseAuth } = await import("../js/core/auth/supabaseAuthFetch.js");
const { httpRequest } = await import("../js/core/network/httpClient.js");
const { AddonApi } = await import("../js/data/remote/api/addonApi.js");
const { resetSyncBackoff } = await import("../js/core/sync/syncBackoffPolicy.js");
const { waitForPendingSessionRequests } = await import("../js/core/auth/sessionLifecycle.js");
const nativeSetTimeout = globalThis.setTimeout;
// Keep production deadlines meaningful while making stalled-network fixtures quick.
globalThis.setTimeout = (callback, delay, ...args) =>
  nativeSetTimeout(callback, delay >= 10000 ? 25 : delay, ...args);
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const jwt = (expired = false) =>
  `x.${Buffer.from(
    JSON.stringify({
      sub: "fixture-user",
      email: "fixture@example.invalid",
      exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600)
    })
  ).toString("base64url")}.x`;
function signedIn({ expired = false, refresh = true } = {}) {
  resetSyncBackoff();
  AuthManager.sessionGeneration++;
  AuthManager.refreshPromise = null;
  AuthManager.cachedEffectiveUserId = null;
  if (typeof AbortController === "function")
    AuthManager.sessionAbortController = new AbortController();
  SessionStore.accessToken = jwt(expired);
  SessionStore.refreshToken = refresh ? "fixture-refresh" : null;
  AuthManager.setState(AuthState.AUTHENTICATED);
  localStorage.setItem("profiles", '[{"id":"1","name":"Fixture"}]');
}
async function bounded(task) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = nativeSetTimeout(() => reject(Error("operation remained pending")), 500);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const cases = {
  "auth-timeout": async () => {
    signedIn();
    globalThis.fetch = () => new Promise(() => {});
    await assert.rejects(
      bounded(() =>
        fetchSupabaseAuth("/auth/v1/token", {
          method: "POST"
        })
      ),
      (error) => error.code === "REQUEST_TIMEOUT"
    );
    await bounded(() => waitForPendingSessionRequests());
  },
  "auth-body-timeout": async () => {
    signedIn();
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      clone: () => ({ text: () => new Promise(() => {}) })
    });
    await assert.rejects(
      bounded(() =>
        fetchSupabaseAuth("/auth/v1/token", {
          method: "POST",
          timeoutMs: 15
        })
      ),
      (error) => error.code === "REQUEST_TIMEOUT"
    );
  },
  "expired-refresh": async () => {
    signedIn({ expired: true });
    let protectedReads = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("/auth/v1/token")) {
        return json({ error_code: "refresh_token_not_found", msg: "Invalid refresh token" }, 400);
      }
      protectedReads++;
      return json([]);
    };
    await assert.rejects(
      bounded(() => SupabaseApi.select("profiles")),
      (error) => error.code === "SESSION_CANCELLED"
    );
    await bounded(() => waitForPendingSessionRequests());
    assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
    assert.equal(SessionStore.accessToken, null);
    assert.equal(localStorage.getItem("profiles"), null);
    assert.equal(
      protectedReads,
      0,
      "An invalidated session must never dispatch the protected read"
    );
  },
  "rejected-access": async () => {
    signedIn({ refresh: false });
    globalThis.fetch = async () => json({ code: "PGRST301", message: "JWT expired" }, 401);
    await assert.rejects(
      bounded(() => SupabaseApi.select("profiles")),
      (error) => error.code === "SESSION_CANCELLED"
    );
    await bounded(() => waitForPendingSessionRequests());
    assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
    assert.equal(SessionStore.accessToken, null);
  },
  "legacy-refresh": async () => {
    const original = globalThis.AbortController;
    globalThis.AbortController = undefined;
    AuthManager.sessionAbortController = null;
    try {
      await cases["expired-refresh"]();
    } finally {
      globalThis.AbortController = original;
    }
  },
  "rejected-access-with-refresh": async () => {
    signedIn();
    globalThis.fetch = async (url) =>
      url.includes("/auth/v1/token")
        ? json({ error_code: "refresh_token_not_found", msg: "Invalid refresh token" }, 400)
        : json({ code: "PGRST301", message: "JWT expired" }, 401);
    await assert.rejects(
      bounded(() => SupabaseApi.select("profiles")),
      (error) => error.code === "SESSION_CANCELLED"
    );
    await bounded(() => waitForPendingSessionRequests());
    assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
  },
  "sync-owner-teardown-cycle": async () => {
    signedIn();
    globalThis.fetch = async (url) =>
      url.includes("/auth/v1/token")
        ? json({ error_code: "refresh_token_not_found", msg: "Invalid refresh token" }, 400)
        : json({ code: "PGRST301", message: "JWT expired" }, 401);
    let syncOperation;
    let teardown;
    const originalSignOut = AuthManager.signOut;
    AuthManager.signOut = function (...args) {
      teardown = originalSignOut.apply(this, args);
      return teardown;
    };
    // Production sync teardown waits on the complete operation, including
    // resolving its owner before the first Supabase table request is started.
    const unregister = AuthManager.registerSessionTeardownListener(() =>
      syncOperation.catch(() => false)
    );
    try {
      syncOperation = AuthManager.getEffectiveUserId();
      await assert.rejects(
        bounded(() => syncOperation),
        (error) => error.code === "SESSION_CANCELLED"
      );
      assert.ok(teardown);
      await bounded(() => teardown);
      await bounded(() => waitForPendingSessionRequests());
      assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
    } finally {
      unregister();
      AuthManager.signOut = originalSignOut;
    }
  },
  "cancelled-refresh-cannot-restore-authenticated-state": async () => {
    signedIn({ expired: true });
    let started;
    const requestStarted = new Promise((resolve) => {
      started = resolve;
    });
    globalThis.fetch = () => {
      started();
      return new Promise(() => {});
    };
    const pending = AuthManager.refreshSessionIfNeeded();
    await bounded(() => requestStarted);
    await bounded(() => AuthManager.signOut());
    assert.equal(await bounded(() => pending), false);
    assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
    assert.equal(SessionStore.accessToken, null);
  },
  "refresh-within-http-deadline": async () => {
    signedIn({ expired: true });
    globalThis.fetch = () => new Promise(() => {});
    await assert.rejects(
      bounded(() =>
        httpRequest("https://account.example/rest/v1/profiles", {
          timeoutMs: 15
        })
      ),
      (error) => error.code === "REQUEST_TIMEOUT"
    );
    await bounded(() => waitForPendingSessionRequests());
    assert.equal(
      AuthManager.state,
      AuthState.AUTHENTICATED,
      "A network outage must not sign the user out"
    );
    assert.ok(SessionStore.refreshToken);
  },
  "late-result-after-logout": async () => {
    signedIn();
    const original = globalThis.AbortController;
    globalThis.AbortController = undefined;
    AuthManager.sessionAbortController = null;
    let release;
    let started;
    const requestStarted = new Promise((resolve) => {
      started = resolve;
    });
    globalThis.fetch = () =>
      new Promise((resolve) => {
        release = resolve;
        started();
      });
    try {
      const pending = SupabaseApi.select("profiles");
      const rejected = assert.rejects(pending, (error) => error.code === "SESSION_CANCELLED");
      await bounded(() => requestStarted);
      await bounded(() => AuthManager.signOut());
      await rejected;
      release(json([{ id: "old-profile" }]));
      await Promise.resolve();
      await bounded(() => waitForPendingSessionRequests());
      assert.equal(SessionStore.accessToken, null);
      assert.equal(localStorage.getItem("profiles"), null);
    } finally {
      globalThis.AbortController = original;
    }
  },
  "isolated-cooldown": async () => {
    signedIn();
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return url.startsWith("https://account.example")
        ? json({ message: "rate limit" }, 429, { "Retry-After": "120" })
        : json({ id: "fixture.addon", name: "Fixture addon" });
    };
    await assert.rejects(
      () =>
        httpRequest("https://account.example/rest/v1/rpc/sync_push_addons", {
          method: "POST",
          includeSessionAuth: false
        }),
      (error) => error.status === 429
    );
    const manifest = await bounded(() =>
      AddonApi.getManifest("https://addon.example/manifest.json", { timeoutMs: 15 })
    );
    assert.equal(manifest.id, "fixture.addon");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].init.headers.Authorization, undefined);
  },
  "external-cooldown": async () => {
    signedIn();
    globalThis.fetch = async (url) =>
      url.startsWith("https://addon.example")
        ? json({ message: "rate limit" }, 429, { "Retry-After": "120" })
        : json([]);
    await assert.rejects(() => AddonApi.getManifest("https://addon.example/manifest.json"));
    assert.deepEqual(
      await bounded(() =>
        httpRequest("https://account.example/rest/v1/profiles", { timeoutMs: 15 })
      ),
      []
    );
  },
  "addon-does-not-refresh-or-clear-nuvio-session": async () => {
    signedIn({ expired: true });
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://addon.example/manifest.json");
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers.apikey, undefined);
      return json({ message: "Addon authorization required" }, 401);
    };
    await assert.rejects(
      () => AddonApi.getManifest("https://addon.example/manifest.json"),
      (error) => error.status === 401
    );
    assert.equal(calls, 1);
    assert.equal(AuthManager.state, AuthState.AUTHENTICATED);
    assert.ok(SessionStore.refreshToken);
  },
  "failed-addon-save-cannot-restore-a-signed-out-account": async () => {
    signedIn();
    const { SharedPluginScreen } = await import("../js/ui/screens/plugin/sharedPluginScreen.js");
    const { LibrarySyncService } = await import("../js/core/profile/librarySyncService.js");
    const { addonRepository } = await import("../js/data/repository/addonRepository.js");
    const privateUrl = "https://personal.example/private-config";
    await addonRepository.addAddon(privateUrl);
    const originalPush = LibrarySyncService.push;
    LibrarySyncService.push = async () => {
      await AuthManager.signOut();
      return false;
    };
    globalThis.fetch = async () =>
      json({ id: "fixture.addon", name: "Fixture", resources: [], catalogs: [] });
    const owner = {
      ...SharedPluginScreen,
      mounted: true,
      saving: false,
      syncing: false,
      render() {}
    };
    try {
      await bounded(() => owner.change("install", "https://new.example/manifest.json"));
      assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
      assert.ok(
        !addonRepository.getInstalledAddonUrls().includes(privateUrl),
        "Rollback must not restore the previous user's addons after logout"
      );
      assert.equal(localStorage.getItem("profiles"), null);
    } finally {
      LibrarySyncService.push = originalPush;
    }
  },
  "local-account-stats": async () => {
    signedIn();
    globalThis.fetch = async () => {
      throw Error("Account counters must not wait on the network");
    };
    const { AuthQrSignInScreen } = await import("../js/ui/screens/account/authQrSignInScreen.js");
    let markup = "";
    const owner = {
      ...AuthQrSignInScreen,
      isMounted: true,
      isSignedIn: true,
      authMountToken: 1,
      isConnectedStatsLoading: true,
      container: {
        querySelector: () => ({
          set outerHTML(value) {
            markup = value;
          }
        })
      }
    };
    await bounded(() => owner.loadConnectedStats());
    assert.equal(owner.isConnectedStatsLoading, false);
    assert.equal(owner.connectedStats.addons, 2);
    assert.ok(markup.includes("qr-connected-stat"));
    assert.ok(!markup.includes("..."));
  }
};

const selected = process.argv.find((value) => value.startsWith("--case="))?.slice(7);
// The backend cooldown deliberately persists across account sessions. Run the
// fixture that creates it last so subsequent checks do not inherit its state.
const selectedCases = selected
  ? [[selected, cases[selected]]]
  : [
      ...Object.entries(cases).filter(([name]) => name !== "isolated-cooldown"),
      ["isolated-cooldown", cases["isolated-cooldown"]]
    ];
for (const [name, run] of selectedCases) {
  try {
    assert.ok(run, `Unknown case ${name}`);
    await run();
    console.log(`PASS account network: ${name}`);
  } catch (error) {
    console.error(`FAIL account network: ${name}`, error);
    process.exit(1);
  }
}
console.log(
  `${selectedCases.length} account/network checks passed (simulated transport and real repositories).`
);
