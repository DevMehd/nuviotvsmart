// Personal ratings on VIDAA: merge, document format, recommendations, remote keys, end-of-playback offer.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const ratings = await import("../js/core/perso/titleRatings.js");
const { mergeRatings, makeStamp, activeValue, pickLatestReco, createTitleRatings, activeProfileIndex, RATING_SCALE } = ratings;

// Scale identical to Android TitleRating.
assert.deepEqual(RATING_SCALE.map((r) => r.value), [-2, -1, 0, 1, 2]);

// Latest stamp wins per title; a later removal beats an older rating.
const merged = mergeRatings(
  { "movie:a": { value: 2, atMs: 10 }, "movie:b": { value: -1, atMs: 50 } },
  { "movie:a": { atMs: 20 }, "movie:b": { value: 1, atMs: 40 } }
);
assert.equal(activeValue(merged["movie:a"]), null);
assert.equal(activeValue(merged["movie:b"]), -1);

// Document format: value omitted when removed, poster optional.
assert.deepEqual(makeStamp(2, "Dune", "p.jpg", 5), { atMs: 5, name: "Dune", value: 2, poster: "p.jpg" });
assert.deepEqual(makeStamp(null, "Dune", null, 6), { atMs: 6, name: "Dune" });

// Most recent recommendations document of all devices.
const reco = pickLatestReco({ phone1: { updatedAt: 5, forYou: [{ id: "old" }] }, phone2: { updatedAt: 9, forYou: [{ id: "new" }] }, junk: {} });
assert.equal(reco.forYou[0].id, "new");

// Store with a fake cloud: rating, pull merge, recommendations without rated titles.
const docs = {
  "ratings:2": { phone: { "series:tt1": { value: 1, atMs: 100, name: "Show" } } },
  "reco:2": { phone: { updatedAt: 1, forYou: [{ type: "series", id: "tt1", name: "Show" }, { type: "movie", id: "tt9", name: "Film" }] } }
};
const puts = [];
const cloud = {
  available: true,
  spaceId: async () => "space-1",
  getDocs: async (_id, key) => docs[key] || {},
  putDoc: async (_id, key, device, payload) => {
    puts.push({ key, device, payload });
    return true;
  }
};
const local = new Map();
const tr = createTitleRatings({
  store: { get: (k, d) => (local.has(k) ? local.get(k) : d), set: (k, v) => local.set(k, v) },
  space: { get: () => ({ spaceCode: "ABCDEFGHJKLM", deviceId: "tv-1", deviceName: "TV" }) },
  cloud,
  now: () => 50,
  profileIndex: () => 2
});
tr.rate("movie", "tt5", "Five", null, -2);
assert.equal(tr.valueOf("movie", "tt5"), -2);
await tr.pull();
assert.equal(tr.valueOf("series", "tt1"), 1, "the phone's rating arrives");
const recs = await tr.recommendations();
assert.deepEqual(recs.map((r) => r.id), ["tt9"], "rated titles are not proposed again");

// Active profile index comes from the synced profiles.
const fake = new Map([["activeProfileId", "abc"], ["profiles", [{ id: "abc", profileIndex: 3 }]]]);
assert.equal(activeProfileIndex({ get: (k, d) => (fake.has(k) ? fake.get(k) : d) }), 3);

// Remote keys.
const { digitToRating, discoveryAction } = await import("../js/ui/components/persoRatingOverlays.js");
assert.equal(digitToRating(49), -2);
assert.equal(digitToRating(53), 2);
assert.equal(digitToRating(99), 0);
assert.deepEqual(discoveryAction(39), { type: "rate", value: 1 });
assert.deepEqual(discoveryAction(37), { type: "rate", value: -1 });
assert.deepEqual(discoveryAction(38), { type: "rate", value: 2 });
assert.deepEqual(discoveryAction(40), { type: "skip" });
assert.deepEqual(discoveryAction(13), { type: "open" });
assert.deepEqual(discoveryAction(461), { type: "close" });

// End-of-playback offer: films at ≥ 90 %, series only on the season's last episode.
const { shouldOfferRating } = await import("../js/ui/screens/player/persoRatingOffer.js");
assert.equal(shouldOfferRating({ itemType: "movie", positionSec: 95, durationSec: 100 }), true);
assert.equal(shouldOfferRating({ itemType: "movie", positionSec: 50, durationSec: 100 }), false);
assert.equal(shouldOfferRating({ itemType: "movie", positionSec: 95, durationSec: 100, alreadyRated: true }), false);
const eps = [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 1 }];
assert.equal(shouldOfferRating({ itemType: "series", positionSec: 95, durationSec: 100, season: 1, episode: 2, episodes: eps }), true);
assert.equal(shouldOfferRating({ itemType: "series", positionSec: 95, durationSec: 100, season: 1, episode: 1, episodes: eps }), false);

console.log("test-perso-ratings: ok");
