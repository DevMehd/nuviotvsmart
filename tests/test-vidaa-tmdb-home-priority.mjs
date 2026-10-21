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
const currentMetadata = await import("../js/core/tmdb/tmdbMetadataService.js");
let { TmdbMetadataService } = currentMetadata;
let { TmdbService } = await import("../js/core/tmdb/tmdbService.js");
if (process.argv.includes("--baseline")) {
  const importBaseline = async (path) => {
    const fileUrl = new URL(`../${path}`, import.meta.url);
    const source = execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }).replace(
      /from\s+(["'])(\.\.?\/[^"']+)\1/g,
      (_match, quote, relative) => `from ${quote}${new URL(relative, fileUrl).href}${quote}`
    );
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  };
  const baselineMetadata = await importBaseline(
    "js/core/tmdb/tmdbMetadataServiceMethods-01-fetch-enrichment.js"
  );
  TmdbMetadataService = {
    ...TmdbMetadataService,
    ...baselineMetadata.createTmdbMetadataServiceMethods01()
  };
  ({ TmdbService } = await importBaseline("js/core/tmdb/tmdbService.js"));
}

TmdbSettingsStore.replaceForProfile(
  "1",
  { enabled: true, language: "it-IT" },
  { silentSync: true }
);
const originalFetch = globalThis.fetch;
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
const settle = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
const response = (data) => ({ ok: true, json: async () => data });
const details = {
  title: "Titolo italiano",
  original_title: "Original title",
  original_language: "en",
  overview: "Descrizione italiana",
  images: {
    logos: [
      { file_path: "/english.png", iso_639_1: "en", vote_average: 10 },
      { file_path: "/italian.png", iso_639_1: "it", vote_average: 1 }
    ]
  },
  credits: { cast: [{ id: 9, name: "俳優", original_name: "俳優" }] },
  videos: { results: [] }
};
const tests = [
  [
    "Home publishes localized text and logo without waiting for optional requests",
    async () => {
      const optional = deferred();
      const requests = [];
      globalThis.fetch = async (rawUrl) => {
        const url = new URL(rawUrl);
        requests.push(url);
        return url.searchParams.get("append_to_response")?.includes("images")
          ? response(details)
          : optional.promise;
      };
      let result;
      const pending = TmdbMetadataService.fetchEnrichment({
        tmdbId: 101,
        contentType: "movie",
        includeExtras: false
      }).then((value) => {
        result = value;
      });
      try {
        await settle();
        assert.equal(result?.localizedTitle, "Titolo italiano");
        assert.equal(result?.description, "Descrizione italiana");
        assert.ok(result.logo.endsWith("/italian.png"));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].searchParams.get("language"), "it-IT");
        const appended = requests[0].searchParams.get("append_to_response").split(",");
        assert.ok(!appended.includes("credits") && !appended.includes("videos"));
        assert.equal(result.credits, null);
        assert.deepEqual(result.trailers, []);
      } finally {
        optional.resolve(
          response({
            credits: { cast: [{ id: 9, name: "Actor" }] },
            results: [{ site: "YouTube", key: "trailer", type: "Trailer", iso_639_1: "en" }]
          })
        );
        await pending;
      }
    }
  ],
  [
    "Full enrichment retains credit and trailer fallback",
    async () => {
      const requests = [];
      globalThis.fetch = async (rawUrl) => {
        const url = new URL(rawUrl);
        requests.push(url);
        if (url.pathname.endsWith("/videos")) {
          return response({
            results: [{ site: "YouTube", key: "trailer", type: "Trailer", iso_639_1: "en" }]
          });
        }
        return response(
          url.searchParams.get("language") === "en-US"
            ? { credits: { cast: [{ id: 9, name: "Actor" }] } }
            : details
        );
      };
      const result = await TmdbMetadataService.fetchEnrichment({
        tmdbId: 102,
        contentType: "movie"
      });
      assert.equal(result.credits.cast[0].name, "Actor");
      assert.equal(result.trailers[0].ytId, "trailer");
      assert.equal(requests.length, 3);
    }
  ],
  [
    "A valid Italian title may match the original title",
    async () => {
      globalThis.fetch = async () =>
        response({
          ...details,
          title: "Titanic",
          original_title: "Titanic",
          credits: null,
          videos: { results: [{ site: "YouTube", key: "it", type: "Trailer", iso_639_1: "it" }] }
        });
      const result = await TmdbMetadataService.fetchEnrichment({
        tmdbId: 103,
        contentType: "movie"
      });
      assert.equal(result.localizedTitle, "Titanic");
    }
  ],
  [
    "Revisiting a title does not inherit an aborted ID lookup",
    async () => {
      TmdbService.clearCache();
      const requests = [];
      globalThis.fetch = async (_url, options) => {
        const request = deferred();
        requests.push({ ...request, signal: options.signal });
        return request.promise;
      };
      const oldFocus = new AbortController();
      const newFocus = new AbortController();
      const oldLookup = TmdbService.ensureTmdbId("tt0000104", "movie", { signal: oldFocus.signal });
      const oldSettled = oldLookup.then(
        () => null,
        (error) => error
      );
      oldFocus.abort();
      const newLookup = TmdbService.ensureTmdbId("tt0000104", "movie", { signal: newFocus.signal });
      const newSettled = newLookup.then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      try {
        await settle();
        assert.equal(requests.length, 2);
        assert.equal(requests[0].signal.aborted, true);
        assert.equal(requests[1].signal.aborted, false);
        const joined = TmdbService.ensureTmdbId("tt0000104", "movie", { signal: newFocus.signal });
        requests[1].resolve(response({ movie_results: [{ id: 104 }] }));
        assert.deepEqual(await newSettled, { value: "104" });
        assert.equal(await joined, "104");
        assert.match((await oldSettled).message, /aborted/);
        assert.equal(requests.length, 2);
      } finally {
        requests.forEach((request) => request.resolve(response({ movie_results: [{ id: 104 }] })));
        await Promise.allSettled([oldSettled, newSettled]);
      }
    }
  ],
  [
    "Home cancellation preserves default lookup deduplication for the same ID",
    async () => {
      TmdbService.clearCache();
      const requests = [];
      globalThis.fetch = async (_url, options) => {
        const network = deferred();
        requests.push({ ...network, signal: options.signal });
        return network.promise;
      };
      const controller = new AbortController();
      const first = TmdbService.ensureTmdbId("tt0000106", "movie");
      const home = TmdbService.ensureTmdbId("tt0000106", "movie", { signal: controller.signal });
      const homeSettled = home.then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      const second = TmdbService.ensureTmdbId("tt0000106", "movie");
      try {
        await settle();
        assert.equal(requests.length, 2);
        controller.abort();
        await settle();
        assert.equal(requests[0].signal.aborted, false);
        assert.equal(requests[1].signal.aborted, true);
        requests[0].resolve(response({ movie_results: [{ id: 106 }] }));
        assert.deepEqual(await Promise.all([first, second]), ["106", "106"]);
        assert.match((await homeSettled).error.message, /aborted/);
        assert.equal(await TmdbService.ensureTmdbId("tt0000106", "movie"), "106");
        assert.equal(requests.length, 2);
      } finally {
        requests.forEach((request) => request.resolve(response({ movie_results: [{ id: 106 }] })));
        await Promise.allSettled([first, second, homeSettled]);
      }
    }
  ],
  [
    "ID lookups without a signal still share their request",
    async () => {
      TmdbService.clearCache();
      const lookup = deferred();
      let count = 0;
      globalThis.fetch = async () => {
        count++;
        return lookup.promise;
      };
      const first = TmdbService.ensureTmdbId("tt0000105", "movie");
      const second = TmdbService.ensureTmdbId("tt0000105", "movie");
      lookup.resolve(response({ movie_results: [{ id: 105 }] }));
      assert.deepEqual(await Promise.all([first, second]), ["105", "105"]);
      assert.equal(count, 1);
    }
  ]
];

let failures = 0;
try {
  for (const [name, run] of tests) {
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
console.log(`TMDB Home priority: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
