import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePersonalChangelog } from "../scripts/personalChangelog.mjs";
import {
  getStreamPresentationBadges,
  getDeclaredStreamBadges
} from "../js/core/streams/streamPresentationBadges.js";
import {
  isVidaaHomePreviewBusy,
  getVidaaHeroFocusDelay
} from "../js/ui/screens/home/vidaaHomePreviewPolicy.js";
import {
  setHomeCollectionFocusGif,
  clearHomeCollectionFocusGif
} from "../js/ui/screens/home/homeCollectionFocusGif.js";

const stream = {
  name: "[TB+] 𝟮𝟭𝟲𝟬𝗽",
  title: "Film HEVC HDR10+ Atmos 🇫🇷 MULTI",
  behaviorHints: { filename: "Film.mkv" }
};
assert.deepEqual(getStreamPresentationBadges(stream), [
  "2160p",
  "HEVC",
  "HDR10+",
  "Atmos",
  "FR",
  "MULTI",
  "TorBox"
]);
assert.ok(
  !getStreamPresentationBadges(stream).includes("En cache"),
  "Provider branding alone never proves caching"
);
assert.deepEqual(getStreamPresentationBadges({ name: "🚀 FHD", title: "⚡Ready (TB)" }), [
  "1080p",
  "TorBox"
]);
assert.deepEqual(
  getStreamPresentationBadges({
    name: "Unknown",
    url: "https://example.test/2160p-HDR-FRENCH?secret=key"
  }),
  []
);
assert.deepEqual(
  getStreamPresentationBadges({ name: "Unknown", title: "https://example.test/2160p-HDR-FRENCH" }),
  []
);
assert.ok(
  getStreamPresentationBadges({
    streamPresentation: { resolution: "1080p", encode: "AV1", languages: "French", cached: true }
  }).includes("En cache")
);
assert.deepEqual(
  getDeclaredStreamBadges({
    badges: [],
    raw: { badges: [{ name: "Fixture", imageURL: "https://example.test/badge.svg" }] }
  }).map((b) => b.name),
  ["Fixture"]
);
assert.ok(
  getStreamPresentationBadges({ streamPresentation: { visualTags: {}, languages: null } })
    .length === 0
);
assert.equal(getVidaaHeroFocusDelay(), 80);
assert.equal(getVidaaHeroFocusDelay({ rapid: true }), 140);
assert.equal(
  isVidaaHomePreviewBusy({ lastHomeInputAt: 1000, homeDirectionalInputBurst: true }, 1100),
  true
);
assert.equal(
  isVidaaHomePreviewBusy({ lastHomeInputAt: 1000, homeDirectionalInputBurst: true }, 1250),
  false
);
assert.equal(isVidaaHomePreviewBusy({ isModernVerticalScrollActive: () => true }), true);

function card(source) {
  const attributes = new Map();
  const classes = new Set(["focused"]);
  const image = {
    tagName: "IMG",
    dataset: { src: source },
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    removeAttribute: (k) => attributes.delete(k)
  };
  return {
    isConnected: true,
    classList: {
      contains: (k) => classes.has(k),
      add: (k) => classes.add(k),
      remove: (k) => classes.delete(k)
    },
    querySelector: () => image,
    image
  };
}
const a = card("a.gif"),
  b = card("b.gif");
let focused = a;
const owner = { getCurrentFocusedNode: () => focused };
setHomeCollectionFocusGif(owner, a, true, 10);
focused = b;
setHomeCollectionFocusGif(owner, b, true, 10);
await new Promise((r) => setTimeout(r, 20));
assert.equal(a.image.getAttribute("src"), undefined, "Cancelled hover never starts an old GIF");
assert.equal(b.image.getAttribute("src"), "b.gif");
clearHomeCollectionFocusGif(owner);
assert.equal(b.image.getAttribute("src"), undefined, "Home cleanup releases the active GIF");
assert.equal(owner.collectionFocusGifPending, null);

const notes = await readFile(new URL("../CHANGELOG.fr.md", import.meta.url), "utf8");
const changelog = parsePersonalChangelog(notes, "1.2.4");
assert.equal(changelog.date, "2026-10-12");
assert.ok(changelog.notes.includes("badges"));
assert.ok(
  !changelog.notes.includes("2026-10-11"),
  "Only the latest entry is included in the TV prompt"
);
assert.throws(() => parsePersonalChangelog(notes, "1.2.5"));
console.log(
  "Presentation restoration checks passed: declared badges, safe source labels, bounded GIF lifecycle, preview timing and French changelog."
);
