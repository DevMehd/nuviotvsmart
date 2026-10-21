import assert from "node:assert/strict";

const storage = new Map([
  [
    "nuvio.stream.addonLogoCache.v1",
    JSON.stringify({ "https://old.example/logo.png": { dataUrl: "data:image/png;base64,AAAA" } })
  ]
]);
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const images = [];
globalThis.Image = class {
  constructor() {
    images.push(this);
  }
};
globalThis.document = {
  createElement: () => {
    throw new Error("VIDAA badges must not be drawn through a canvas");
  }
};

const { requestAddonLogo, getCachedAddonLogoDisplayUrl, warmAddonLogoPreview } =
  await import("../js/core/media/addonLogoCache.js");

// VIDAA shows badges from their URL (no canvas, no data URL re-decoded in every row).
const url = "https://example.test/badges/elite.webp";
assert.equal(await requestAddonLogo(url), true);
assert.equal(getCachedAddonLogoDisplayUrl(url), url);
assert.equal(await warmAddonLogoPreview("https://example.test/badges/nard.webp"), true);
assert.equal(
  getCachedAddonLogoDisplayUrl("https://example.test/badges/nard.webp"),
  "https://example.test/badges/nard.webp"
);
assert.ok(images.every((image) => !String(image.src || "").startsWith("data:")));
assert.ok(
  ![...storage.values()].some((value) => String(value).includes("data:image")),
  "old data URL cache removed"
);

console.log("PASS: VIDAA addon logos and badges load directly from their URL.");
