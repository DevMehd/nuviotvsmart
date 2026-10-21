import assert from "node:assert/strict";

const storage = new Map();
let parses = 0;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const originalParse = JSON.parse;
JSON.parse = (...args) => {
  parses += 1;
  return originalParse(...args);
};

const { createProfileScopedStore, stopProfileSettingsCloudSync } =
  await import("../js/data/local/profileScopedStore.js");

// Parsed settings are reused while the stored text is unchanged (nuv-090), and any write,
// through the store or directly in storage (sync, other module), is seen on the next read.
const store = createProfileScopedStore({
  key: "fixtureSettings",
  normalize: (value) => ({ enabled: Boolean(value.enabled), level: Number(value.level || 0) })
});
store.set({ enabled: true, level: 2 }, { silentSync: true });
assert.deepEqual(store.get(), { enabled: true, level: 2 });

parses = 0;
for (let i = 0; i < 50; i++) store.get();
assert.ok(parses <= 50, `cached reads must not re-parse the whole envelope (parses=${parses})`);

const copy = store.get();
copy.level = 99;
assert.equal(store.get().level, 2, "callers get copies, the cache is not mutated");

store.set({ level: 3 }, { silentSync: true });
assert.equal(store.get().level, 3, "a store write is visible");

const raw = originalParse(storage.get("fixtureSettings"));
raw.profiles["1"].level = 7;
storage.set("fixtureSettings", JSON.stringify(raw));
assert.equal(store.get().level, 7, "an external write is visible");

storage.delete("fixtureSettings");
assert.deepEqual(store.get(), { enabled: false, level: 0 }, "a removed key falls back to defaults");

JSON.parse = originalParse;
await stopProfileSettingsCloudSync({ waitForInFlight: false });
console.log(
  "PASS: profile scoped settings are cached per stored text and invalidated by any write."
);
