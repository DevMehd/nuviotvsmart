import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { CatalogApi } = await import("../js/data/remote/api/catalogApi.js");
let { catalogRepository } = await import("../js/data/repository/catalogRepository.js");
if (process.argv.includes("--baseline")) {
  const fileUrl = new URL("../js/data/repository/catalogRepository.js", import.meta.url);
  const source = execFileSync("git", ["show", "HEAD:js/data/repository/catalogRepository.js"], {
    encoding: "utf8"
  }).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, path) => `from ${quote}${new URL(path, fileUrl).href}${quote}`
  );
  ({ catalogRepository } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  ));
}

const originalCatalog = CatalogApi.getCatalog;
const args = {
  addonBaseUrl: "https://catalog.example.test",
  addonId: "fixture",
  addonName: "Fixture addon",
  catalogId: "popular",
  catalogName: "Popular",
  type: "movie",
  supportsSkip: true
};
const response = (name = "Fresh item") => ({ metas: [{ id: "tt1", name, type: "movie" }] });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
const tests = [
  [
    "A burst of callers shares one pending request and maps one result",
    async () => {
      const network = deferred();
      let calls = 0;
      CatalogApi.getCatalog = () => {
        calls++;
        return network.promise;
      };
      const pending = Array.from({ length: 100 }, () => catalogRepository.getCatalog(args));
      try {
        await flush();
        assert.equal(calls, 1, "A slow addon must not receive 100 copies of the same request");
      } finally {
        network.resolve(response());
        await Promise.all(pending);
      }
      const results = await Promise.all(pending);
      assert.ok(results.every((result) => result.status === "success"));
      assert.ok(results.every((result) => result.data === results[0].data));
      assert.equal((await catalogRepository.getCatalog(args)).data, results[0].data);
      assert.equal(calls, 1);
    }
  ],
  [
    "Aborted signals cannot read cache or start a new request",
    async () => {
      let calls = 0;
      CatalogApi.getCatalog = async () => {
        calls++;
        return response();
      };
      assert.equal((await catalogRepository.getCatalog(args)).status, "success");
      const controller = new AbortController();
      controller.abort();
      assert.match(
        (await catalogRepository.getCatalog({ ...args, signal: controller.signal })).message,
        /aborted/
      );
      assert.match(
        (await catalogRepository.getCatalog({ ...args, skip: 100, signal: controller.signal }))
          .message,
        /aborted/
      );
      assert.equal(calls, 1);
    }
  ],
  [
    "Cancellation settles promptly even when the transport ignores abort",
    async () => {
      const network = deferred();
      const controller = new AbortController();
      let receivedSignal;
      CatalogApi.getCatalog = (_url, options) => {
        receivedSignal = options.signal;
        return network.promise;
      };
      let result;
      const pending = catalogRepository
        .getCatalog({ ...args, signal: controller.signal })
        .then((value) => {
          result = value;
        });
      await flush();
      controller.abort();
      try {
        await flush();
        assert.equal(receivedSignal, controller.signal);
        assert.equal(
          result?.status,
          "error",
          "The consumer must retire without waiting for native fetch"
        );
        assert.match(result.message, /aborted/);
        assert.equal(catalogRepository.inFlightCatalogs.size, 0);
      } finally {
        network.resolve(response("Late cancelled item"));
        await pending;
      }
      await flush();
      assert.equal(
        catalogRepository.catalogCache.size,
        0,
        "A cancelled response must never be cached"
      );
    }
  ],
  [
    "Independent signals and default callers retain independent cancellation",
    async () => {
      const requests = [];
      CatalogApi.getCatalog = (_url, options) => {
        const network = deferred();
        requests.push({ ...network, signal: options.signal || null });
        return network.promise;
      };
      const first = new AbortController();
      const second = new AbortController();
      const defaults = [catalogRepository.getCatalog(args), catalogRepository.getCatalog(args)];
      const old = catalogRepository.getCatalog({ ...args, signal: first.signal });
      const fresh = [
        catalogRepository.getCatalog({ ...args, signal: second.signal }),
        catalogRepository.getCatalog({ ...args, signal: second.signal })
      ];
      try {
        await flush();
        assert.equal(requests.length, 3);
        first.abort();
        requests[0].resolve(response("Default consumer"));
        requests[2].resolve(response("New consumer"));
        assert.ok(
          (await Promise.all(defaults)).every(
            (result) => result.data.items[0].name === "Default consumer"
          )
        );
        assert.ok(
          (await Promise.all(fresh)).every((result) => result.data.items[0].name === "New consumer")
        );
      } finally {
        requests.forEach((request) => request.resolve(response("Old cancelled consumer")));
        await Promise.all([...defaults, old, ...fresh]);
      }
      assert.match((await old).message, /aborted/);
      await flush();
      assert.equal((await catalogRepository.getCatalog(args)).data.items[0].name, "New consumer");
    }
  ],
  [
    "Invalidation starts a fresh request and a late prior generation cannot overwrite it",
    async () => {
      const requests = [];
      CatalogApi.getCatalog = () => {
        const network = deferred();
        requests.push(network);
        return network.promise;
      };
      const old = catalogRepository.getCatalog(args);
      catalogRepository.clearCache();
      const fresh = catalogRepository.getCatalog(args);
      try {
        assert.equal(requests.length, 2);
        requests[1].resolve(response("Fresh generation"));
        assert.equal((await fresh).data.items[0].name, "Fresh generation");
        requests[0].resolve(response("Obsolete generation"));
        await old;
        assert.equal(
          (await catalogRepository.getCatalog(args)).data.items[0].name,
          "Fresh generation"
        );
        assert.equal(requests.length, 2);
      } finally {
        requests.forEach((request) => request.resolve(response()));
        await Promise.all([old, fresh]);
      }
    }
  ],
  [
    "Failed requests retire so a retry can recover",
    async () => {
      let calls = 0;
      CatalogApi.getCatalog = async () => {
        if (++calls === 1) throw new Error("Temporary addon failure");
        return response();
      };
      assert.equal((await catalogRepository.getCatalog(args)).status, "error");
      assert.equal((await catalogRepository.getCatalog(args)).status, "success");
      assert.equal(calls, 2);
    }
  ],
  [
    "Synchronous transport abort observes its rejected native Promise",
    async () => {
      const controller = new AbortController();
      const unhandled = [];
      const onUnhandled = (error) => unhandled.push(error);
      process.on("unhandledRejection", onUnhandled);
      CatalogApi.getCatalog = () => {
        controller.abort();
        return Promise.reject(new Error("Native abort rejection"));
      };
      try {
        const result = await catalogRepository.getCatalog({ ...args, signal: controller.signal });
        assert.equal(result.status, "error");
        assert.match(result.message, /aborted/);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
        assert.equal(catalogRepository.catalogCache.size, 0);
      } finally {
        process.removeListener("unhandledRejection", onUnhandled);
      }
    }
  ],
  [
    "The real HTTP deadline retires one shared stalled request even without caller signals",
    async () => {
      const originalFetch = globalThis.fetch;
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const timers = new Map();
      const requests = [];
      let nextId = 0;
      globalThis.setTimeout = (callback, delay) => {
        const id = ++nextId;
        timers.set(id, { callback, delay });
        return id;
      };
      globalThis.clearTimeout = (id) => timers.delete(id);
      globalThis.fetch = (_url, options) => {
        const network = deferred();
        requests.push({ ...network, signal: options.signal });
        return network.promise;
      };
      CatalogApi.getCatalog = originalCatalog;
      const pending = Array.from({ length: 100 }, () => catalogRepository.getCatalog(args));
      try {
        await flush();
        assert.equal(requests.length, 1);
        assert.equal(timers.size, 1);
        const timer = [...timers.values()][0];
        assert.equal(timer.delay, 60000, "Keep the HTTP transport's existing addon deadline");
        timer.callback();
        const results = await Promise.all(pending);
        assert.ok(
          results.every((result) => result.status === "error" && /timed out/.test(result.message))
        );
        assert.equal(requests[0].signal.aborted, true);
        assert.equal(catalogRepository.inFlightCatalogs.size, 0);
        assert.equal(catalogRepository.catalogCache.size, 0);
      } finally {
        requests.forEach((request) =>
          request.resolve({ ok: true, status: 200, text: async () => JSON.stringify(response()) })
        );
        await Promise.all(pending);
        globalThis.fetch = originalFetch;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
      }
    }
  ],
  [
    "Different addon URLs, filters and pages never share a request",
    async () => {
      const requests = [];
      CatalogApi.getCatalog = (url) => {
        requests.push(url);
        return Promise.resolve(response());
      };
      await Promise.all([
        catalogRepository.getCatalog(args),
        catalogRepository.getCatalog({ ...args, addonBaseUrl: "https://second.example.test" }),
        catalogRepository.getCatalog({ ...args, extraArgs: { genre: "Comedy" } }),
        catalogRepository.getCatalog({ ...args, skip: 100 })
      ]);
      assert.equal(new Set(requests).size, 4);
    }
  ]
];

let failures = 0;
try {
  for (const [name, run] of tests) {
    catalogRepository.clearCache();
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  CatalogApi.getCatalog = originalCatalog;
}
console.log(`Catalog request lifetime: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
