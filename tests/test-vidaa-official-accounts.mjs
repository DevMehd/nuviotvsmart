import assert from "node:assert/strict";
import { normalizeEnvProperties } from "../scripts/envProperties.mjs";

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
// Personal VIDAA builds select the official account backend explicitly (test-vidaa-platform).
globalThis.__NUVIO_ENV__ = normalizeEnvProperties({ NUVIO_ACCOUNT_BACKEND_MODE: "official" });

const { AuthManager } = await import("../js/core/auth/authManager.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { QrLoginService } = await import("../js/core/auth/qrLoginService.js");
const { SessionStore } = await import("../js/core/storage/sessionStore.js");
const { ServerConfigurationStore } = await import("../js/data/local/serverConfigurationStore.js");
const { ACCOUNT_ARCHIVE_PREFIX } = await import("../js/core/auth/accountSessionScope.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { CollectionSyncService } = await import("../js/core/profile/collectionSyncService.js");
const { CollectionsStore } = await import("../js/data/local/collectionsStore.js");
const { LibrarySyncService } = await import("../js/core/profile/librarySyncService.js");
const { addonRepository } = await import("../js/data/repository/addonRepository.js");
const { getLatestAppUpdate } = await import("../js/core/update/appUpdateService.js");
const { ProfileSettingsSyncService } =
  await import("../js/core/profile/profileSettingsSyncService.js");
const { LayoutPreferences } = await import("../js/data/local/layoutPreferences.js");

const jwt = (subject, backend = "https://api.nuvio.tv", expired = false) =>
  `x.${Buffer.from(JSON.stringify({ sub: subject, iss: `${backend}/auth/v1`, exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600) })).toString("base64url")}.x`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const requests = [];
let status = "pending";
let sequence = 0;
let remoteTitle = "Account collection";
let missingDeviceRPC = false;
let revoked = false;
const accountToken = jwt("existing-nuvio-account");
globalThis.fetch = async (url, init = {}) => {
  if (init.signal?.aborted) throw init.signal.reason || new Error("Request aborted");
  const target = new URL(url);
  assert.equal(target.origin, "https://api.nuvio.tv", "Account requests use the official backend");
  const body = init.body ? JSON.parse(init.body) : {};
  const headers = new Headers(init.headers);
  requests.push({ path: target.pathname, body, authorization: headers.get("Authorization") });
  assert.equal(headers.get("apikey"), globalThis.__NUVIO_ENV__.NUVIO_SUPABASE_ANON_KEY);
  if (target.pathname === "/auth/v1/signup") {
    assert.equal(
      body.email,
      undefined,
      "Anonymous device auth never registers a new email account"
    );
    return json({ access_token: jwt("anonymous-device"), refresh_token: "anonymous-refresh" });
  }
  if (target.pathname === "/rest/v1/rpc/start_device_login_session") {
    if (missingDeviceRPC)
      return json({ message: "Could not find the function start_device_login_session" }, 404);
    assert.equal(body.p_redirect_base_url, "https://nuvio.tv/link");
    assert.equal(body.p_device_type, "tv");
    sequence++;
    return json([
      {
        device_code: `private-device-${sequence}`,
        user_code: `USER-${sequence}`,
        verification_uri: "https://nuvio.tv/link",
        verification_uri_complete: `https://nuvio.tv/link?code=USER-${sequence}`,
        expires_at: new Date(Date.now() + 300000).toISOString()
      }
    ]);
  }
  if (target.pathname === "/rest/v1/rpc/start_tv_login_session") {
    assert.equal(body.p_redirect_base_url, "https://nuvio.tv/tv-login");
    return json([{ code: "LEGACY", web_url: "https://nuvio.tv/tv-login?code=LEGACY" }]);
  }
  if (target.pathname === "/rest/v1/rpc/poll_tv_login_session") return json([{ status }]);
  if (target.pathname === "/functions/v1/tv-logins-exchange") {
    assert.ok(body.device_nonce);
    assert.equal(body.code, "private-device-1");
    return json({ access_token: accountToken, refresh_token: "account-refresh-1" });
  }
  if (target.pathname === "/auth/v1/token") {
    assert.equal(target.searchParams.get("grant_type"), "refresh_token");
    assert.equal(body.refresh_token, "account-refresh-1");
    if (revoked) return json({ message: "Invalid refresh token: refresh_token_not_found" }, 400);
    return json({ access_token: accountToken, refresh_token: "account-refresh-2" });
  }
  if (target.pathname === "/rest/v1/rpc/get_sync_owner") return json("existing-nuvio-account");
  if (target.pathname === "/rest/v1/rpc/sync_pull_profile_settings_blob") {
    assert.equal(body.p_profile_id, 2);
    assert.equal(body.p_platform, "tv");
    return json([
      {
        settings_json: {
          version: 1,
          features: {
            layout_settings: {
              selected_layout: { type: "string", value: "CLASSIC" },
              has_chosen_layout: { type: "boolean", value: true }
            }
          }
        }
      }
    ]);
  }
  if (target.pathname === "/rest/v1/addons") {
    assert.equal(target.searchParams.get("profile_id"), "eq.2");
    return json([
      { url: "https://fixture.invalid/addon", name: "Account addon", enabled: true, sort_order: 0 }
    ]);
  }
  if (target.pathname === "/rest/v1/rpc/sync_pull_collections") {
    assert.equal(body.p_profile_id, 2);
    assert.equal(headers.get("Authorization"), `Bearer ${accountToken}`);
    return json([
      {
        collections_json: [
          {
            id: "collection-2",
            title: remoteTitle,
            folders: [
              {
                id: "folder-2",
                title: "Remote folder",
                sources: [
                  {
                    provider: "addon",
                    addonId: "account-addon",
                    addonBaseUrl: "https://fixture.invalid/addon",
                    type: "movie",
                    catalogId: "popular"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  }
  throw Error(`Unexpected endpoint: ${target.pathname}`);
};

// Old credentials are blocked even before bootstrap or any optional API call.
values.set("nuvioSharedBackendV1", "https://previous.example");
values.set("access_token", jwt("previous-user", "https://previous.example"));
values.set("refresh_token", "previous-refresh");
values.set("profiles", JSON.stringify([{ id: "1", name: "Previous user" }]));
values.set(
  "collectionsState",
  JSON.stringify({ __profileScoped: true, version: 1, profiles: { 1: { collections: [] } } })
);
values.set("installedAddonUrls", JSON.stringify(["https://previous.example/addon"]));
values.set("torrentSettings", "device-only");
assert.equal(SessionStore.accessToken, null);
assert.equal(SessionStore.refreshToken, null);
await AuthManager.bootstrap();
assert.equal(requests.length, 0, "Previous credentials are never sent to Nuvio");
assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
assert.equal(values.get("profiles"), undefined);
assert.equal(values.get("torrentSettings"), "device-only");
const backupKey = [...values.keys()].find((key) => key.startsWith(ACCOUNT_ARCHIVE_PREFIX));
const backup = JSON.parse(values.get(backupKey));
assert.ok(backup.data.profiles.includes("Previous user"));
assert.ok(backup.data.collectionsState);
assert.equal(backup.data.access_token, undefined);
assert.equal(backup.data.refresh_token, undefined);
assert.equal(ServerConfigurationStore.getActive().capabilities.tvLogin, true);
assert.equal(
  await getLatestAppUpdate({
    currentVersion: "1.2.5",
    fetchImpl: () => {
      throw Error("VIDAA must not install upstream platform packages");
    }
  }),
  null
);

// Full start/poll/exchange/persist/restore/renew cycle with simulated phone approval.
const first = await QrLoginService.start();
assert.ok(first?.deviceNonce);
assert.equal(SessionStore.isAnonymousSession, true);
assert.equal(AuthManager.isAuthenticated, false);
assert.equal((await QrLoginService.poll(first.code, first.deviceNonce)).status, "pending");
status = "approved";
assert.equal((await QrLoginService.poll(first.code, first.deviceNonce)).status, "approved");
assert.ok(await QrLoginService.exchange(first.code, first.deviceNonce));
assert.equal(AuthManager.isAuthenticated, true);
assert.equal(SessionStore.isAnonymousSession, false);
AuthManager.state = AuthState.LOADING;
await AuthManager.bootstrap();
assert.equal(AuthManager.isAuthenticated, true);
assert.equal(await AuthManager.refreshSessionIfNeeded({ force: true }), true);
assert.equal(SessionStore.refreshToken, "account-refresh-2");

// Real sync services select the active profile and apply phone edits without pushing them back.
await ProfileManager.replaceProfiles([
  { id: "1", name: "Main" },
  { id: "2", name: "Selected", usesPrimaryAddons: false }
]);
await ProfileManager.setActiveProfile("2");
assert.equal(await ProfileSettingsSyncService.pull(), true);
assert.equal(LayoutPreferences.getForProfile("2").homeLayout, "classic");
assert.equal(LayoutPreferences.getForProfile("1").homeLayout, "modern");
const addons = await LibrarySyncService.pull();
assert.deepEqual(addons, ["https://fixture.invalid/addon"]);
assert.deepEqual(addonRepository.getInstalledAddonUrls(), addons);
assert.equal(await CollectionSyncService.pull(), true);
assert.equal(CollectionsStore.get()[0].title, "Account collection");
assert.equal(CollectionsStore.getForProfile("1").length, 0);
remoteTitle = "Changed from phone";
assert.equal(await CollectionSyncService.pull(), true);
assert.equal(CollectionsStore.get()[0].title, remoteTitle);
assert.equal(CollectionsStore.get()[0].folders[0].sources[0].catalogId, "popular");
assert.equal(
  await CollectionSyncService.pull(),
  false,
  "An unchanged snapshot does not refresh Home"
);
assert.ok(
  !requests.some((request) => request.path.includes("sync_push")),
  "Remote snapshots are not echoed back"
);

await AuthManager.signOut();
assert.equal(SessionStore.accessToken, null);
assert.equal(SessionStore.refreshToken, null);
assert.equal(values.get("profiles"), undefined);
assert.ok(values.has(backupKey), "Signing out never removes the archived old account data");

status = "expired";
const second = await QrLoginService.start();
assert.equal((await QrLoginService.poll(second.code, second.deviceNonce)).status, "expired");
const retry = await QrLoginService.start();
assert.notEqual(retry.code, second.code);
assert.notEqual(retry.deviceNonce, second.deviceNonce);
missingDeviceRPC = true;
assert.equal((await QrLoginService.start()).legacy, true);

// App routing mounts the next QR screen synchronously on the signed-out event.
missingDeviceRPC = false;
status = "pending";
SessionStore.accessToken = accountToken;
SessionStore.refreshToken = "account-refresh-1";
SessionStore.isAnonymousSession = false;
values.set("profiles", '[{"id":"1","name":"Previous account"}]');
AuthManager.setState(AuthState.AUTHENTICATED);
const previousSignal = AuthManager.getSessionSignal();
let signedOutSnapshot;
let nextQr;
const unsubscribeLogout = AuthManager.subscribe((state) => {
  if (state !== AuthState.SIGNED_OUT) return;
  signedOutSnapshot = {
    aborted: AuthManager.getSessionSignal()?.aborted,
    previousProfiles: values.get("profiles")
  };
  nextQr = QrLoginService.start();
});
try {
  await AuthManager.signOut();
  const regenerated = await nextQr;
  assert.equal(signedOutSnapshot.aborted, false, "Logout routing receives a fresh auth signal");
  assert.equal(
    signedOutSnapshot.previousProfiles,
    undefined,
    "Old account data is cleared before QR mount"
  );
  assert.ok(previousSignal.aborted, "Previous account requests remain cancelled");
  assert.notEqual(AuthManager.getSessionSignal(), previousSignal);
  assert.ok(regenerated?.loginUrl, "Logout immediately generates a usable QR without a reload");
  assert.equal(SessionStore.isAnonymousSession, true);
  assert.equal(
    (await QrLoginService.poll(regenerated.code, regenerated.deviceNonce)).status,
    "pending"
  );
} finally {
  unsubscribeLogout();
}

revoked = true;
SessionStore.accessToken = jwt("existing-nuvio-account", "https://api.nuvio.tv", true);
SessionStore.refreshToken = "account-refresh-1";
SessionStore.isAnonymousSession = false;
AuthManager.setState(AuthState.AUTHENTICATED);
assert.equal(await AuthManager.refreshSessionIfNeeded({ force: true }), false);
assert.equal(AuthManager.state, AuthState.SIGNED_OUT);
assert.equal(SessionStore.refreshToken, null, "A revoked session requires signing in again");

// Foreign issuer is blocked even when a persisted backend marker is missing.
values.delete("nuvioAccountBackendV1");
values.set("access_token", jwt("foreign", "https://another.example"));
values.set("refresh_token", "foreign-refresh");
assert.equal(SessionStore.accessToken, null);
assert.equal(SessionStore.refreshToken, null);

values.set("access_token", "unrecognized-legacy-session");
assert.equal(SessionStore.accessToken, null);
assert.equal(
  SessionStore.refreshToken,
  null,
  "Unscoped credentials with no readable issuer stay blocked"
);
values.set("access_token", jwt("foreign", "https://another.example"));

// A full archive must be saved before any previous user data can be removed.
const originalSet = localStorage.setItem;
values.set("profiles", "do-not-delete");
localStorage.setItem = (key, value) => {
  if (key.startsWith(ACCOUNT_ARCHIVE_PREFIX)) throw Error("Storage full");
  originalSet(key, value);
};
await assert.rejects(() => AuthManager.ensureAccountBackendScope(), /Storage full/);
assert.equal(values.get("profiles"), "do-not-delete");
assert.equal(values.get("refresh_token"), "foreign-refresh");
localStorage.setItem = originalSet;

console.log(
  "PASS official accounts: backend isolation, data preservation, QR approval/exchange, persistence/renewal/logout, expiry/retry/legacy fallback, selected-profile addons and collections (simulated backend)."
);
