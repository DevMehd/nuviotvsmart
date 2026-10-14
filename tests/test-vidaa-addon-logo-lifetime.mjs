import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const images = [];
const activeImages = new Set();
let decodeCalls = 0;
let canvasWrites = 0;
globalThis.Image = class {
  constructor() {
    this.naturalWidth = this.naturalHeight = 100;
    images.push(this);
  }
  set src(value) {
    this._src = value;
    if (value) activeImages.add(this);
    else activeImages.delete(this);
  }
  get src() {
    return this._src || "";
  }
  removeAttribute(name) {
    if (name === "src") this.src = "";
  }
  decode() {
    decodeCalls++;
    return this.decodeResult || Promise.resolve();
  }
};
globalThis.document = {
  createElement() {
    return {
      getContext: () => ({ clearRect() {}, drawImage() {} }),
      toDataURL: () => {
        canvasWrites++;
        return "data:image/png;base64,fixture";
      }
    };
  }
};

let now = 0;
let nextId = 0;
const timers = new Map();
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextId;
  timers.set(id, { callback, at: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
Date.now = () => now;
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
const advance = async (delta) => {
  const target = now + delta;
  for (;;) {
    const pending = [...timers]
      .filter(([, timer]) => timer.at <= target)
      .sort((left, right) => left[1].at - right[1].at)[0];
    if (!pending) break;
    const [id, timer] = pending;
    now = timer.at;
    timers.delete(id);
    timer.callback();
    await flush();
  }
  now = target;
  await flush();
};

let logos = await import("../js/core/media/addonLogoCache.js");
if (process.argv.includes("--baseline")) {
  const fileUrl = new URL("../js/core/media/addonLogoCache.js", import.meta.url);
  const source = execFileSync("git", ["show", "HEAD:js/core/media/addonLogoCache.js"], {
    encoding: "utf8"
  }).replace(
    /from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote, path) => `from ${quote}${new URL(path, fileUrl).href}${quote}`
  );
  logos = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const {
  requestAddonLogo,
  warmAddonLogoPreview,
  preloadAddonLogoUrls,
  resetAddonLogoCache,
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo
} = logos;
const url = (id) => `https://logos.example.test/${id}.png`;
const observe = (promise) => {
  const state = { settled: false, value: null };
  state.promise = promise.then((value) => {
    state.settled = true;
    state.value = value;
    return value;
  });
  return state;
};

const tests = [
  [
    "Missing native events release the request and permit a later retry",
    async () => {
      const pending = observe(requestAddonLogo(url("missing-events")));
      const image = images.at(-1);
      const lateLoad = image.onload;
      try {
        await advance(6000);
        assert.equal(pending.settled, true, "An Image with no events must have a bounded lifetime");
        assert.equal(pending.value, false);
        assert.equal(image.src, "");
        assert.equal(image.onload, null);
        assert.equal(activeImages.size, 0);
        assert.equal(hasFailedAddonLogo(url("missing-events")), false);
        const decodesBefore = decodeCalls;
        lateLoad();
        await flush();
        assert.equal(decodeCalls, decodesBefore, "A retired event cannot restart decode work");
        const retry = observe(requestAddonLogo(url("missing-events")));
        const fresh = images.at(-1);
        assert.notEqual(fresh, image);
        fresh.onload();
        assert.equal(await retry.promise, true);
      } finally {
        lateLoad();
        await pending.promise;
      }
    }
  ],
  [
    "A decode which never settles cannot stall or later overwrite a retry",
    async () => {
      let finishDecode;
      const pending = observe(warmAddonLogoPreview(url("decode")));
      const image = images.at(-1);
      image.decodeResult = new Promise((resolve) => {
        finishDecode = resolve;
      });
      image.onload();
      await flush();
      try {
        await advance(6000);
        assert.equal(pending.settled, true, "The same deadline must also cover decode");
        assert.equal(pending.value, false);
        assert.equal(image.src, "");
        assert.equal(getCachedAddonLogoDisplayUrl(url("decode")), "");
        const retry = requestAddonLogo(url("decode"));
        images.at(-1).onload();
        assert.equal(await retry, true);
        const writesBefore = canvasWrites;
        finishDecode();
        await flush();
        assert.equal(
          canvasWrites,
          writesBefore,
          "The obsolete decode cannot write artwork into cache"
        );
        assert.equal(getCachedAddonLogoDisplayUrl(url("decode")), "data:image/png;base64,fixture");
      } finally {
        finishDecode();
        await pending.promise;
      }
    }
  ],
  [
    "CORS fallback shares the original lifetime and releases both images",
    async () => {
      const pending = observe(requestAddonLogo(url("cors")));
      const originalImage = images.at(-1);
      originalImage.onerror();
      const directImage = images.at(-1);
      const lateLoad = directImage.onload;
      try {
        assert.notEqual(originalImage, directImage);
        await advance(6000);
        assert.equal(pending.settled, true);
        assert.equal(pending.value, false);
        assert.equal(activeImages.size, 0);
        assert.equal(originalImage.src, "");
        assert.equal(directImage.src, "");
      } finally {
        lateLoad();
        await pending.promise;
      }
    }
  ],
  [
    "Reset retires pending work without allowing a late response to repopulate cache",
    async () => {
      const pending = observe(requestAddonLogo(url("reset")));
      const image = images.at(-1);
      const lateLoad = image.onload;
      resetAddonLogoCache();
      try {
        await flush();
        assert.equal(pending.settled, true);
        assert.equal(pending.value, false);
        assert.equal(activeImages.size, 0);
        lateLoad();
        await flush();
        assert.equal(getCachedAddonLogoDisplayUrl(url("reset")), "");
        assert.equal(timers.size, 0);
      } finally {
        lateLoad();
        await pending.promise;
      }
    }
  ],
  [
    "Successful requests stay shared and release decoder images",
    async () => {
      let callbacks = 0;
      const first = requestAddonLogo(url("success"), () => {
        callbacks++;
      });
      const second = requestAddonLogo(url("success"));
      assert.equal(first, second);
      images.at(-1).onload();
      assert.deepEqual(await Promise.all([first, second]), [true, true]);
      assert.equal(callbacks, 1);
      assert.equal(activeImages.size, 0);
      assert.equal(getCachedAddonLogoDisplayUrl(url("success")), "data:image/png;base64,fixture");
      const count = images.length;
      assert.equal(await warmAddonLogoPreview(url("success")), true);
      assert.equal(images.length, count);
      await advance(800);
      assert.equal(timers.size, 0);
    }
  ],
  [
    "An unavailable native Image constructor retires cleanly and stays retryable",
    async () => {
      const originalImage = globalThis.Image;
      globalThis.Image = class {
        constructor() {
          throw new Error("Native image allocation failed");
        }
      };
      try {
        assert.equal(await requestAddonLogo(url("allocation")), false);
        assert.equal(await warmAddonLogoPreview(url("allocation")), false);
        assert.equal(timers.size, 0);
        assert.equal(hasFailedAddonLogo(url("allocation")), false);
      } finally {
        globalThis.Image = originalImage;
      }
      const retry = requestAddonLogo(url("allocation"));
      images.at(-1).onload();
      assert.equal(await retry, true);
    }
  ],
  [
    "A stalled batch releases workers and terminates",
    async () => {
      const pending = observe(
        preloadAddonLogoUrls(Array.from({ length: 10 }, (_, index) => url(`batch-${index}`)))
      );
      await advance(24000);
      try {
        assert.equal(
          pending.settled,
          true,
          "Every concurrency worker must advance past a stalled logo"
        );
        assert.equal(images.length, 10);
        assert.equal(activeImages.size, 0);
        assert.equal(timers.size, 0);
      } finally {
        // Baseline failures can be cleaned up without waiting on real time.
        for (let pass = 0; pass < 5 && !pending.settled; pass++) {
          images.forEach((image) => image.onload?.());
          await flush();
        }
        await pending.promise;
      }
    }
  ]
];
let failures = 0;
for (const [name, run] of tests) {
  resetAddonLogoCache();
  images.length = 0;
  activeImages.clear();
  timers.clear();
  now = 0;
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
resetAddonLogoCache();
console.log(`Addon logo lifetime: ${tests.length - failures}/${tests.length} passed.`);
if (failures) process.exitCode = 1;
