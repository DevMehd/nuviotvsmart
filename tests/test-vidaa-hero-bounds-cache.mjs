import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("Unexpected network request");
};

const { modernHeroCopyLayoutKey } =
  await import("../js/ui/screens/home/homeScreenMethods-14-activate-focused-poster-flow.js");

// VIDAA performance mode measures the hero description bounds once per copy layout.
const node = (className, text, { logo = false } = {}) => ({
  className,
  textContent: text,
  classList: { contains: (name) => className.split(" ").includes(name) },
  querySelector: (selector) => (selector === "img" && logo ? {} : null)
});
const description = node("home-hero-description", "A long synopsis that is clamped.");
const copy = (title, meta, { logo = false } = {}) => ({
  children: [
    node("home-hero-brand", title, { logo }),
    node("home-modern-hero-meta-line", meta),
    description
  ]
});
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;

const oneLine = modernHeroCopyLayoutKey(copy("Dune", "2021 · Film"), description);
assert.equal(
  oneLine,
  modernHeroCopyLayoutKey(copy("Heat", "1995 · Film"), description),
  "same layout, same key"
);
assert.notEqual(
  oneLine,
  modernHeroCopyLayoutKey(
    copy("A much longer title that wraps on two lines", "2021 · Film"),
    description
  ),
  "a longer title can take another line"
);
assert.notEqual(
  oneLine,
  modernHeroCopyLayoutKey(copy("Dune", "2021 · Film", { logo: true }), description),
  "logo vs title"
);
assert.ok(!oneLine.includes("synopsis"), "the description itself is not part of the key");

console.log("PASS: VIDAA hero description bounds are cached per copy layout.");
