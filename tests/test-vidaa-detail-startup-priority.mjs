import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = { TMDB_API_KEY: "fixture-tmdb-key" };
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { TmdbSettingsStore } = await import("../js/data/local/tmdbSettingsStore.js");
const { TmdbService } = await import("../js/core/tmdb/tmdbService.js");
let { createMetaDetailsScreenMethods03 } =
  await import("../js/ui/screens/detail/metaDetailsScreenMethods-03-load-detail.js");
if (process.argv.includes("--baseline")) {
  const path = "js/ui/screens/detail/metaDetailsScreenMethods-03-load-detail.js";
  const fileUrl = new URL(`../${path}`, import.meta.url);
  const source = execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, relative) => `from ${quote}${new URL(relative, fileUrl).href}${quote}`
  );
  ({ createMetaDetailsScreenMethods03 } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  ));
}
const screen = createMetaDetailsScreenMethods03();
const originalFetch = globalThis.fetch;
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
const settle = async () => {
  for (let n = 0; n < 40; n++) await Promise.resolve();
};
const response = (data) => ({ ok: true, json: async () => data });
const settings = (enabled = true) =>
  TmdbSettingsStore.replaceForProfile("1", { enabled, language: "it-IT" }, { silentSync: true });

const tests = [
  [
    "Opening a TMDB title needs only its ID while optional requests remain pending",
    async () => {
      const optional = deferred();
      const requests = [];
      globalThis.fetch = async (rawUrl) => {
        const url = new URL(rawUrl);
        requests.push(url);
        if (url.pathname.endsWith("/external_ids")) return response({ imdb_id: "tt1010001" });
        if (url.searchParams.has("append_to_response")) {
          return response({
            title: "Titolo italiano",
            original_title: "Original title",
            external_ids: { imdb_id: "tt1010001" },
            credits: { cast: [{ id: 9, name: "俳優", original_name: "俳優" }] },
            videos: { results: [] }
          });
        }
        return optional.promise;
      };
      let resolved;
      const pending = screen.resolveCanonicalDetailItemId("tmdb:101", "movie").then((id) => {
        resolved = id;
      });
      try {
        await settle();
        assert.equal(resolved, "tt1010001", "Optional cast/trailers must not delay routing");
        assert.equal(requests.length, 1);
        assert.equal(requests[0].pathname, "/3/movie/101/external_ids");
      } finally {
        optional.resolve(response({ credits: { cast: [{ id: 9, name: "Actor" }] }, results: [] }));
        await pending;
      }
    }
  ],
  [
    "Movie and series aliases keep the same TMDB identity mapping",
    async () => {
      const requests = [];
      globalThis.fetch = async (rawUrl) => {
        const url = new URL(rawUrl);
        requests.push(url);
        const imdbId = url.pathname.includes("/tv/") ? "tt1010002" : "tt1010003";
        return response({ imdb_id: imdbId, external_ids: { imdb_id: imdbId } });
      };
      for (const type of ["series", "tv", "show", "tvshow", " TV "]) {
        assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:102", type), "tt1010002");
      }
      for (const type of ["movie", "film", "channel"]) {
        assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:102", type), "tt1010003");
      }
      assert.deepEqual(
        requests.map((url) => url.pathname),
        ["/3/tv/102/external_ids", "/3/movie/102/external_ids"]
      );
    }
  ],
  [
    "Disabled enrichment preserves the original ID and makes no request",
    async () => {
      settings(false);
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return response({ imdb_id: "tt1010004" });
      };
      assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:104", "series"), "tmdb:104");
      assert.equal(requests, 0);
    }
  ],
  [
    "Existing addon identities and invalid TMDB IDs stay unchanged without network",
    async () => {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return response({});
      };
      for (const id of ["tt1010005", "addon:123", "tmdb:invalid", "", "  tt1010006  "]) {
        assert.equal(await screen.resolveCanonicalDetailItemId(id), id.trim());
      }
      assert.equal(requests, 0);
    }
  ],
  [
    "Missing or failed ID lookups keep the addon title usable",
    async () => {
      for (const result of [response({ imdb_id: null }), { ok: false, status: 404 }]) {
        globalThis.fetch = async () => result;
        assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:106"), "tmdb:106");
      }
      const warn = console.warn;
      console.warn = () => {};
      try {
        globalThis.fetch = async () => {
          throw new Error("Fixture network failure");
        };
        assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:106"), "tmdb:106");
      } finally {
        console.warn = warn;
      }
    }
  ],
  [
    "Concurrent opens share one ID request and retain conversion caches",
    async () => {
      const lookup = deferred();
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return lookup.promise;
      };
      const first = screen.resolveCanonicalDetailItemId("tmdb:107", "series");
      const second = screen.resolveCanonicalDetailItemId("tmdb:107", "tv");
      try {
        await settle();
        assert.equal(requests, 1);
      } finally {
        lookup.resolve(response({ imdb_id: "tt1010007", external_ids: { imdb_id: "tt1010007" } }));
        await Promise.allSettled([first, second]);
      }
      assert.deepEqual(await Promise.all([first, second]), ["tt1010007", "tt1010007"]);
      assert.equal(await screen.resolveCanonicalDetailItemId("tmdb:107", "series"), "tt1010007");
      assert.equal(await TmdbService.ensureTmdbId("tt1010007", "series"), "107");
      assert.equal(requests, 1);
    }
  ]
];

let failures = 0;
try {
  for (const [name, run] of tests) {
    TmdbService.clearCache();
    settings();
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`Detail startup priority: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
