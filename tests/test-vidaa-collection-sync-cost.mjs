import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { AuthManager } = await import("../js/core/auth/authManager.js");
const { SupabaseApi } = await import("../js/data/remote/supabase/supabaseApi.js");
const { CollectionsStore } = await import("../js/data/local/collectionsStore.js");
let { CollectionSyncService } = await import("../js/core/profile/collectionSyncService.js");
if (process.argv.includes("--baseline")) {
  const file = new URL("../js/core/profile/collectionSyncService.js", import.meta.url);
  const source = execFileSync("git", ["show", "HEAD:js/core/profile/collectionSyncService.js"], {
    encoding: "utf8"
  }).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, relative) => `from ${quote}${new URL(relative, file).href}${quote}`
  );
  ({ CollectionSyncService } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  ));
}

const fixture = Array.from({ length: 8 }, (_, c) => ({
  id: `collection-${c}`,
  title: `Collection ${c}`,
  pinToTop: c === 0,
  folders: Array.from({ length: 6 }, (_, f) => ({
    id: `folder-${f}`,
    title: `Folder ${f}`,
    tileShape: "LANDSCAPE",
    sources: Array.from({ length: 12 }, (_, s) => ({
      provider: "addon",
      addonId: `addon-${s}`,
      addonBaseUrl: `https://fixture.invalid/${s}`,
      type: "movie",
      catalogId: `catalog-${s}`,
      title: `Source ${s}`
    }))
  }))
}));
const original = {
  authenticated: Object.getOwnPropertyDescriptor(AuthManager, "isAuthenticated"),
  rpc: SupabaseApi.rpc,
  get: CollectionsStore.getForProfile,
  replace: CollectionsStore.replaceForProfile,
  stringify: JSON.stringify,
  parse: JSON.parse
};
const clone = (value) => original.parse(original.stringify(value));
let local, remote, writes, pushed;
function reset(value = fixture) {
  local = CollectionsStore.normalizeCollections(value);
  remote = clone(value);
  writes = [];
  pushed = null;
}
Object.defineProperty(AuthManager, "isAuthenticated", { configurable: true, get: () => true });
CollectionsStore.getForProfile = (profileId) => {
  assert.equal(profileId, 2);
  return local;
};
CollectionsStore.replaceForProfile = (profileId, collections, options) => {
  assert.equal(CollectionSyncService.isSyncingFromRemote(profileId), true);
  writes.push({ profileId, collections, options });
  local = collections;
};
SupabaseApi.rpc = async (method, args, authenticated) => {
  assert.equal(args.p_profile_id, 2);
  assert.equal(authenticated, true);
  if (method === "sync_pull_collections") return [{ collections_json: remote }];
  assert.equal(method, "sync_push_collections");
  pushed = args.p_collections_json;
};

const tests = [
  [
    "unchanged large collections avoid recursive serialization and parse",
    async () => {
      reset();
      let stringifies = 0,
        parses = 0;
      JSON.stringify = (...args) => {
        stringifies++;
        return original.stringify(...args);
      };
      JSON.parse = (...args) => {
        parses++;
        return original.parse(...args);
      };
      let changed;
      try {
        changed = await CollectionSyncService.pull(2);
      } finally {
        JSON.stringify = original.stringify;
        JSON.parse = original.parse;
      }
      assert.equal(changed, false);
      assert.equal(writes.length, 0);
      console.log(
        `Collection comparison: ${stringifies} stringify calls, ${parses} parses for 576 sources.`
      );
      assert.equal(stringifies, 0, "Comparing object payloads must not serialize each field");
      assert.equal(parses, 0, "An already parsed response must not be parsed again");
    }
  ],
  [
    "normalized field changes and order changes still apply silently to the intended profile",
    async () => {
      reset();
      remote[3].folders[4].sources[5].genre = "Comedy";
      assert.equal(await CollectionSyncService.pull(2), true);
      assert.equal(writes[0].profileId, 2);
      assert.deepEqual(writes[0].options, { silentSync: true });
      assert.equal(local[3].folders[4].sources[5].genre, "Comedy");
      assert.equal(CollectionSyncService.isSyncingFromRemote(2), false);
      writes.length = 0;
      remote.reverse();
      assert.equal(await CollectionSyncService.pull(2), true);
      assert.equal(local[0].id, "collection-7");
      assert.equal(writes.length, 1);
    }
  ],
  [
    "string/envelope inputs retain normalization and no-op semantics",
    async () => {
      for (const payload of [
        fixture,
        { collections: fixture },
        original.stringify(fixture),
        original.stringify({ collections: fixture })
      ]) {
        reset();
        remote = payload;
        assert.equal(await CollectionSyncService.pull(2), false);
        assert.equal(writes.length, 0);
      }
      reset();
      remote[0] = { ...remote[0], title: "  Collection 0  ", ignored: "extra metadata" };
      assert.equal(await CollectionSyncService.pull(2), false);
      assert.equal(remote[0].title, "  Collection 0  ", "Normalization must not mutate RPC input");
      reset();
      remote = "invalid-json";
      assert.equal(await CollectionSyncService.pull(2), true);
      assert.deepEqual(local, []);
    }
  ],
  [
    "push sends normalized JSON values without an export/import round trip",
    async () => {
      reset();
      let stringifies = 0,
        parses = 0;
      JSON.stringify = (...args) => {
        stringifies++;
        return original.stringify(...args);
      };
      JSON.parse = (...args) => {
        parses++;
        return original.parse(...args);
      };
      try {
        assert.equal(await CollectionSyncService.push(2), true);
      } finally {
        JSON.stringify = original.stringify;
        JSON.parse = original.parse;
      }
      assert.deepEqual(pushed, local);
      assert.notEqual(pushed, local, "The RPC receives an independent normalized array");
      assert.equal(stringifies, 0);
      assert.equal(parses, 0);
    }
  ]
];
let failed = 0;
try {
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  JSON.stringify = original.stringify;
  JSON.parse = original.parse;
  if (original.authenticated)
    Object.defineProperty(AuthManager, "isAuthenticated", original.authenticated);
  else delete AuthManager.isAuthenticated;
  SupabaseApi.rpc = original.rpc;
  CollectionsStore.getForProfile = original.get;
  CollectionsStore.replaceForProfile = original.replace;
}
console.log(`${tests.length - failed}/${tests.length} collection sync cost checks passed.`);
if (failed) process.exitCode = 1;
