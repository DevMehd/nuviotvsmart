import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { addonRepository } = await import("../js/data/repository/addonRepository.js");
const { MetaApi } = await import("../js/data/remote/api/metaApi.js");
let { metaRepository } = await import("../js/data/repository/metaRepository.js");
if (process.argv.includes("--baseline")) {
  const fileUrl = new URL("../js/data/repository/metaRepository.js", import.meta.url);
  const source = execFileSync("git", ["show", "HEAD:js/data/repository/metaRepository.js"], {
    encoding: "utf8"
  }).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, path) => `from ${quote}${new URL(path, fileUrl).href}${quote}`
  );
  ({ metaRepository } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  ));
}

const originalInstalled = addonRepository.getInstalledAddons;
const originalMeta = MetaApi.getMeta;
const addons = ["first", "second"].map((name) => ({
  baseUrl: `https://${name}.example.test`,
  types: ["movie"],
  resources: [{ name: "meta", types: ["movie"] }]
}));
addonRepository.getInstalledAddons = async () => addons;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
const success = (id, name = "Fresh metadata") => ({ meta: { id, type: "movie", name } });
const observed = (request) =>
  request.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
const assertAborted = (result) => {
  assert.equal(result?.error?.name, "AbortError");
};
const tests = [
  [
    "Already aborted consumers cannot read cache or start requests",
    async () => {
      const controller = new AbortController();
      controller.abort();
      let calls = 0;
      MetaApi.getMeta = async () => {
        calls++;
        return success("cached");
      };
      metaRepository.metaCache.set("all:movie:cached", { id: "cached" });
      metaRepository.metaCache.set(`${addons[0].baseUrl}:movie:cached`, { id: "cached" });
      assertAborted(
        await observed(
          metaRepository.getMeta(addons[0].baseUrl, "movie", "cached", {
            signal: controller.signal
          })
        )
      );
      assertAborted(
        await observed(
          metaRepository.getMetaFromAllAddons("movie", "cached", null, {
            signal: controller.signal
          })
        )
      );
      assert.equal(calls, 0);
    }
  ],
  [
    "Direct abort reaches MetaApi and a late response never enters cache",
    async () => {
      const controller = new AbortController();
      const network = deferred();
      let receivedSignal;
      MetaApi.getMeta = (_url, options) => {
        receivedSignal = options?.signal;
        return network.promise;
      };
      const result = observed(
        metaRepository.getMeta(addons[0].baseUrl, "movie", "direct", { signal: controller.signal })
      );
      await flush();
      controller.abort();
      await flush();
      // Resolve even a transport which ignores cancellation; no response may be cached.
      network.resolve(success("direct", "Late metadata"));
      assert.equal(receivedSignal, controller.signal);
      assertAborted(await result);
      await flush();
      assert.equal(metaRepository.getCachedMeta("movie", "direct"), null);
    }
  ],
  [
    "Cancelling a candidate prevents probing another addon",
    async () => {
      const controller = new AbortController();
      const requests = [];
      MetaApi.getMeta = async (url) => {
        requests.push(url);
        controller.abort();
        return { meta: null };
      };
      const result = await observed(
        metaRepository.getMetaFromAllAddons("movie", "fallback", null, {
          signal: controller.signal
        })
      );
      assertAborted(result);
      assert.equal(requests.length, 1);
      assert.equal(metaRepository.getCachedMeta("movie", "fallback"), null);
    }
  ],
  [
    "Cancelling during shared manifest discovery retires only this consumer",
    async () => {
      const manifest = deferred();
      const controller = new AbortController();
      let calls = 0;
      let settled;
      addonRepository.getInstalledAddons = () => manifest.promise;
      MetaApi.getMeta = async () => {
        calls++;
        return success("manifest");
      };
      const pending = observed(
        metaRepository.getMetaFromAllAddons("movie", "manifest", null, {
          signal: controller.signal
        })
      ).then((value) => {
        settled = value;
        return value;
      });
      controller.abort();
      await flush();
      try {
        assertAborted(settled);
      } finally {
        manifest.resolve(addons);
        await pending;
        addonRepository.getInstalledAddons = async () => addons;
      }
      await flush();
      assert.equal(calls, 0);
    }
  ],
  [
    "A new signal for the same item does not inherit the old abort",
    async () => {
      const requests = [];
      MetaApi.getMeta = (_url, options) => {
        const network = deferred();
        requests.push({ ...network, signal: options?.signal });
        return network.promise;
      };
      const oldFocus = new AbortController();
      const newFocus = new AbortController();
      const old = observed(
        metaRepository.getMetaFromAllAddons("movie", "repeat", null, { signal: oldFocus.signal })
      );
      await flush();
      oldFocus.abort();
      const fresh = observed(
        metaRepository.getMetaFromAllAddons("movie", "repeat", null, { signal: newFocus.signal })
      );
      await flush();
      try {
        assert.equal(requests.length, 2);
        assert.equal(requests[0].signal.aborted, true);
        assert.equal(requests[1].signal.aborted, false);
        const joined = observed(
          metaRepository.getMetaFromAllAddons("movie", "repeat", null, { signal: newFocus.signal })
        );
        await flush();
        assert.equal(requests.length, 2);
        requests[1].resolve(success("repeat", "New focus"));
        assert.equal((await fresh).value.data.name, "New focus");
        assert.equal((await joined).value.data.name, "New focus");
      } finally {
        requests.forEach((request) => request.resolve(success("repeat", "Late old focus")));
        await Promise.all([old, fresh]);
      }
      assertAborted(await old);
      await flush();
      assert.equal(metaRepository.getCachedMeta("movie", "repeat").name, "New focus");
    }
  ],
  [
    "Default requests keep sharing while a cancellable consumer is active",
    async () => {
      const requests = [];
      MetaApi.getMeta = (_url, options) => {
        const network = deferred();
        requests.push({ ...network, signal: options?.signal });
        return network.promise;
      };
      const controller = new AbortController();
      const first = observed(metaRepository.getMeta(addons[0].baseUrl, "movie", "shared"));
      await flush();
      const cancel = observed(
        metaRepository.getMeta(addons[0].baseUrl, "movie", "shared", { signal: controller.signal })
      );
      await flush();
      const second = observed(metaRepository.getMeta(addons[0].baseUrl, "movie", "shared"));
      await flush();
      try {
        assert.equal(requests.length, 2);
        controller.abort();
        requests[0].resolve(success("shared", "Default request"));
        assert.equal((await first).value.data.name, "Default request");
        assert.equal((await second).value.data.name, "Default request");
      } finally {
        requests.forEach((request) => request.resolve(success("shared", "Cancelled response")));
        await Promise.all([first, second, cancel]);
      }
      assertAborted(await cancel);
      await flush();
      assert.equal(metaRepository.getCachedMeta("movie", "shared").name, "Default request");
    }
  ],
  [
    "Default all-addon discovery preserves fallback, deduplication and cache",
    async () => {
      const firstAddon = deferred();
      const requests = [];
      MetaApi.getMeta = async (url) => {
        requests.push(url);
        return url.includes("first.example.test")
          ? firstAddon.promise
          : success("normal", "Second addon");
      };
      const first = metaRepository.getMetaFromAllAddons("movie", "normal");
      const second = metaRepository.getMetaFromAllAddons("movie", "normal");
      await flush();
      assert.equal(requests.length, 1);
      firstAddon.resolve({ meta: null });
      const results = await Promise.all([first, second]);
      assert.ok(
        results.every(
          (result) => result.status === "success" && result.data.name === "Second addon"
        )
      );
      assert.equal(requests.length, 2);
      assert.equal(
        (await metaRepository.getMetaFromAllAddons("movie", "normal")).data.name,
        "Second addon"
      );
      assert.equal(requests.length, 2);
    }
  ]
];

let failures = 0;
try {
  for (const [name, run] of tests) {
    metaRepository.clearCache();
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  addonRepository.getInstalledAddons = originalInstalled;
  MetaApi.getMeta = originalMeta;
}
console.log(`Metadata cancellation: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
