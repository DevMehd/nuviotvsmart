import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvProperties, resolveLocalPropertiesSource } from "../scripts/envProperties.mjs";

// A copied fork must never silently select the unrelated shared Supabase project.
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nuvio-official-config-"));
try {
  await mkdir(path.join(temporaryRoot, "supabase"));
  await writeFile(
    path.join(temporaryRoot, "supabase/shared.properties"),
    "NUVIO_ACCOUNT_BACKEND_MODE=shared"
  );
  await writeFile(
    path.join(temporaryRoot, "local.example.properties"),
    "NUVIO_ACCOUNT_BACKEND_MODE=official"
  );
  assert.equal(
    await resolveLocalPropertiesSource({ rootDir: temporaryRoot }),
    path.join(temporaryRoot, "local.example.properties")
  );
  await writeFile(
    path.join(temporaryRoot, "local.properties"),
    "NUVIO_ACCOUNT_BACKEND_MODE=official"
  );
  assert.equal(
    await resolveLocalPropertiesSource({ rootDir: temporaryRoot }),
    path.join(temporaryRoot, "local.properties")
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const { env } = await readEnvProperties({ rootDir });
assert.equal(env.NUVIO_ACCOUNT_BACKEND_MODE, "official");
assert.equal(env.NUVIO_SUPABASE_URL, "https://api.nuvio.tv");
assert.equal(env.TMDB_API_KEY, "");
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
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.__NUVIO_ENV__ = env;
const { ServerConfigurationStore: servers } =
  await import("../js/data/local/serverConfigurationStore.js");
const { AuthManager: auth } = await import("../js/core/auth/authManager.js");
const { SessionStore: session } = await import("../js/core/storage/sessionStore.js");
const { SupabaseApi: api } = await import("../js/data/remote/supabase/supabaseApi.js");
assert.equal(servers.getActive().backendUrl, env.NUVIO_SUPABASE_URL);
assert.equal(servers.getActive().isShared, undefined);
assert.equal(servers.getActive().capabilities.emailPasswordAuth, true);
assert.equal(servers.getActive().capabilities.tvLogin, true);

const calls = [];
const accessToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: "existing-android-account", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`;
globalThis.fetch = async (url, init) => {
  assert.ok(
    url.startsWith("https://api.nuvio.tv/"),
    "Account requests must only reach official Nuvio"
  );
  assert.equal(init.headers.apikey, env.NUVIO_SUPABASE_ANON_KEY);
  calls.push({ url, init });
  return new Response(
    JSON.stringify(
      url.includes("grant_type=password")
        ? { access_token: accessToken, refresh_token: "fixture-refresh" }
        : [{ profile_index: 1, name: "Android profile" }]
    )
  );
};
await auth.signInWithEmail("fixture@example.com", "fixture-password");
assert.equal(auth.isAuthenticated, true);
assert.equal(session.accessToken, accessToken);
assert.equal(calls[0].url, "https://api.nuvio.tv/auth/v1/token?grant_type=password");
const profiles = await api.rpc("sync_pull_profiles");
assert.equal(profiles[0].name, "Android profile");
assert.equal(calls[1].init.headers.Authorization, `Bearer ${accessToken}`);
assert.equal(servers.useLocal(), true, "Guest/local mode remains an explicit option");
servers.clearCache();
assert.equal(servers.getActive().isLocal, true);
console.log(
  "PASS official VIDAA: safe config selection, Android account login/sync origin and optional guest mode."
);
