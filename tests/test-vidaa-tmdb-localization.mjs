import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = { TMDB_API_KEY: "test-tmdb-key" };

const { TmdbSettingsStore, normalizeTmdbLanguageCode } =
  await import("../js/data/local/tmdbSettingsStore.js");
const {
  TmdbMetadataService,
  selectBestLocalizedLogoPath,
  selectBestLocalizedImagePath,
  selectBestBackdropPath
} = await import("../js/core/tmdb/tmdbMetadataService.js");
const { fetchTmdbJson } = await import("../js/core/tmdb/tmdbTransport.js");
const { TmdbService } = await import("../js/core/tmdb/tmdbService.js");
const { PluginServiceClient } = await import("../js/platform/pluginServiceClient.js");
const { Platform } = await import("../js/platform/index.js");
const originalFetch = globalThis.fetch;
const originalServiceFetch = PluginServiceClient.fetch;
const originalPlatform = Platform.current;
const apiUrl = "https://api.themoviedb.org/3/movie/99";

const italianDetails = {
  id: 99,
  title: "Titolo italiano",
  original_title: "English title",
  original_language: "en",
  overview: "Descrizione italiana del film.",
  poster_path: "/english-poster.jpg",
  backdrop_path: "/english-backdrop.jpg",
  images: {
    logos: [
      { file_path: "/english-logo.png", iso_639_1: "en", vote_average: 10 },
      { file_path: "/italian-logo.png", iso_639_1: "it", vote_average: 1 }
    ],
    posters: [
      { file_path: "/english-poster.jpg", iso_639_1: "en" },
      { file_path: "/italian-poster.jpg", iso_639_1: "it" }
    ],
    backdrops: [
      { file_path: "/english-backdrop.jpg", iso_639_1: "en", vote_average: 10 },
      { file_path: "/italian-backdrop.jpg", iso_639_1: "it", vote_average: 10 },
      { file_path: "/textless-backdrop.jpg", iso_639_1: null, vote_average: 1 }
    ]
  },
  videos: {
    results: [{ site: "YouTube", key: "italian-trailer", type: "Trailer", iso_639_1: "it" }]
  }
};

try {
  TmdbSettingsStore.replaceForProfile(
    "1",
    { enabled: true, language: "IT_it", useMoreLikeThis: true },
    { silentSync: true }
  );
  assert.equal(TmdbSettingsStore.get().language, "it-IT");
  assert.equal(normalizeTmdbLanguageCode(" it_IT "), "it-IT");

  for (const platform of ["webos", "tizen"]) {
    Platform.current = { name: platform };
    const requests = [];
    globalThis.fetch = async () => {
      throw new Error("Direct TV fetch unavailable");
    };
    PluginServiceClient.fetch = async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("language"), "it-IT");
      assert.ok(url.searchParams.get("include_image_language").split(",").includes("it"));
      assert.equal(request.timeoutMs, 10000);
      return { ok: true, status: 200, body: JSON.stringify(italianDetails) };
    };
    const result = await TmdbMetadataService.fetchEnrichment({ tmdbId: 99, contentType: "movie" });
    assert.equal(result.localizedTitle, "Titolo italiano");
    assert.equal(result.description, italianDetails.overview);
    assert.ok(result.logo.endsWith("/italian-logo.png"));
    assert.ok(result.poster.endsWith("/italian-poster.jpg"));
    assert.ok(
      result.backdrop.endsWith("/textless-backdrop.jpg"),
      "Backdrops prefer no text while logos and posters stay Italian"
    );
    assert.equal(requests.length, 1);
  }

  // Italian region variants should rank consistently whether stored as it or it-IT.
  const regionalLogos = [
    { file_path: "/generic.png", iso_639_1: "it" },
    { file_path: "/italy.png", iso_639_1: "it", iso_3166_1: "IT" }
  ];
  assert.equal(selectBestLocalizedLogoPath(regionalLogos, "it"), "/italy.png");
  assert.equal(
    selectBestLocalizedLogoPath([{ file_path: "/german.png", iso_639_1: "de" }], "it"),
    null
  );
  assert.equal(
    selectBestLocalizedImagePath([{ file_path: "/german.jpg", iso_639_1: "de" }], "it"),
    null
  );
  assert.equal(
    selectBestBackdropPath(italianDetails.images.backdrops, "/english-backdrop.jpg"),
    "/textless-backdrop.jpg"
  );
  assert.equal(
    selectBestBackdropPath(
      [
        { file_path: "/first-textless.jpg", iso_639_1: null },
        { file_path: "/standard-textless.jpg", iso_639_1: null }
      ],
      "/standard-textless.jpg"
    ),
    "/standard-textless.jpg",
    "Preserve TMDB's standard selection when it is textless"
  );
  assert.equal(
    selectBestBackdropPath([{ file_path: "", iso_639_1: null }], "/standard.jpg"),
    "/standard.jpg"
  );
  assert.equal(
    selectBestBackdropPath([{ file_path: "/italian.jpg", iso_639_1: "it" }], "/standard.jpg"),
    "/standard.jpg"
  );
  assert.equal(selectBestBackdropPath([{ file_path: "/italian.jpg", iso_639_1: "it" }]), null);

  Platform.current = { name: "vidaa" };
  PluginServiceClient.fetch = async () => {
    throw new Error("VIDAA must use direct metadata fetch");
  };
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/videos")) throw new Error("Trailer provider unavailable");
    assert.equal(parsed.searchParams.get("language"), "it-IT");
    return { ok: true, json: async () => ({ ...italianDetails, videos: { results: [] } }) };
  };
  const withoutTrailer = await TmdbMetadataService.fetchEnrichment({
    tmdbId: 99,
    contentType: "movie"
  });
  assert.equal(withoutTrailer.description, italianDetails.overview);
  assert.ok(withoutTrailer.backdrop.endsWith("/textless-backdrop.jpg"));
  assert.deepEqual(withoutTrailer.trailers, []);

  // The lightweight Home request and full Detail/stream request share clean
  // backdrops regardless of the text language or film/series type.
  globalThis.fetch = async () => ({ ok: true, json: async () => italianDetails });
  for (const language of ["it-IT", "en-US"]) {
    for (const contentType of ["movie", "series"]) {
      const home = await TmdbMetadataService.fetchEnrichment({
        tmdbId: 99,
        contentType,
        language,
        includeExtras: false
      });
      const detail = await TmdbMetadataService.fetchEnrichment({
        tmdbId: 99,
        contentType,
        language
      });
      assert.ok(home.backdrop.endsWith("/textless-backdrop.jpg"));
      assert.equal(home.backdrop, detail.backdrop);
      assert.ok(
        home.logo.endsWith(language.startsWith("it") ? "/italian-logo.png" : "/english-logo.png")
      );
      assert.ok(
        home.poster.endsWith(
          language.startsWith("it") ? "/italian-poster.jpg" : "/english-poster.jpg"
        )
      );
    }
  }

  globalThis.fetch = async (rawUrl) => ({
    ok: true,
    json: async () =>
      new URL(rawUrl).pathname.endsWith("/images")
        ? italianDetails.images
        : {
            results: [
              {
                id: 199,
                title: "Similar film",
                original_language: "en",
                backdrop_path: "/english-backdrop.jpg",
                vote_average: 8,
                release_date: "2025-01-01"
              }
            ]
          }
  });
  for (const language of ["it-IT", "en-US"]) {
    const similar = await TmdbMetadataService.fetchMoreLikeThis({
      tmdbId: 99,
      contentType: "movie",
      language
    });
    assert.equal(similar.length, 1);
    assert.ok(similar[0].background.endsWith("/textless-backdrop.jpg"));
    assert.equal(similar[0].backdrop, similar[0].background);
  }

  // Standalone lookups must request the preferred language, including English.
  for (const language of ["it-IT", "en-US"]) {
    const trailerRequests = [];
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      trailerRequests.push(parsed);
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              site: "YouTube",
              key: "localized-trailer",
              type: "Trailer",
              iso_639_1: language.slice(0, 2)
            }
          ]
        })
      };
    };
    const trailers = await TmdbMetadataService.fetchTrailerCandidates({
      tmdbId: 99,
      contentType: "movie",
      language
    });
    assert.equal(trailers[0].ytId, "localized-trailer");
    assert.equal(trailerRequests.length, 1);
    assert.equal(trailerRequests[0].searchParams.get("language"), language);
  }

  Platform.current = { name: "webos" };
  let directRequests = 0;
  globalThis.fetch = async () => {
    directRequests++;
    return { ok: true, json: async () => ({ fallback: true }) };
  };
  PluginServiceClient.fetch = async () => {
    throw new Error("Service unavailable");
  };
  assert.deepEqual(await fetchTmdbJson(apiUrl), { fallback: true });
  PluginServiceClient.fetch = async () => ({ ok: true, status: 200, body: "{", truncated: true });
  assert.deepEqual(await fetchTmdbJson(apiUrl), { fallback: true });
  assert.equal(directRequests, 2);
  PluginServiceClient.fetch = async () => ({ ok: false, status: 401 });
  assert.equal(await fetchTmdbJson(apiUrl), null);
  assert.equal(directRequests, 2);

  // ID lookup and metadata use the same TV transport.
  PluginServiceClient.fetch = async (request) => {
    assert.ok(new URL(request.url).pathname.endsWith("/find/tt0000099"));
    return { ok: true, status: 200, body: JSON.stringify({ movie_results: [{ id: 99 }] }) };
  };
  assert.equal(await TmdbService.ensureTmdbId("tt0000099", "movie"), "99");
  assert.equal(directRequests, 2);

  Platform.current = { name: "browser" };
  let cancelled = false;
  globalThis.fetch = async (_url, options) => {
    options.signal.addEventListener("abort", () => {
      cancelled = true;
    });
    return new Promise(() => {});
  };
  await assert.rejects(fetchTmdbJson(apiUrl, { timeoutMs: 10 }), /timed out/);
  assert.equal(cancelled, true);

  const controller = new AbortController();
  const pending = fetchTmdbJson(apiUrl, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
  globalThis.fetch = async () => {
    throw new Error("Aborted request should not start");
  };
  await assert.rejects(fetchTmdbJson(apiUrl, { signal: controller.signal }), /aborted/);
} finally {
  globalThis.fetch = originalFetch;
  PluginServiceClient.fetch = originalServiceFetch;
  Platform.current = originalPlatform;
}

console.log(
  "TMDB checks passed: textless Home/Detail backdrops in Italian/English, localized logos/posters, TV transport, fallback and cancellation."
);
