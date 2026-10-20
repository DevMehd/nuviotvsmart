// Episode release instants on VIDAA (nuv-087): bare US dates, exact times, TVmaze, calendar.
process.env.TZ = "Europe/Paris";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const release = await import("../js/core/util/episodeReleaseTime.js");
const {
  parseEpisodeReleaseInstant,
  episodeReleaseEpochMs,
  hasEpisodeReleaseAired,
  episodeReleaseLocalDate,
  episodeReleaseLocalTime,
  daysUntilEpisodeRelease,
  withEpisodeReleaseTime,
  parseTvMazeEpisodes,
  applyEpisodeReleaseTimes,
  needsReleaseTimes,
  enrichEpisodeReleaseTimes,
  resetEpisodeReleaseTimesCache
} = release;

// VisionQuest: Disney+ lists 2026-10-20 (US). In Paris on the 20th at 22:00 it is not out yet.
const parisEvening = Date.parse("2026-10-20T20:00:00Z");
assert.equal(hasEpisodeReleaseAired("2026-10-20", parisEvening), false);
assert.equal(episodeReleaseEpochMs("2026-10-20"), Date.parse("2026-10-21T02:00:00Z"));
assert.equal(episodeReleaseLocalDate("2026-10-20"), "2026-10-21");
assert.equal(daysUntilEpisodeRelease("2026-10-20", parisEvening), 1, "tomorrow, not today");
assert.equal(episodeReleaseLocalTime("2026-10-20"), null, "no time for a bare date");

// Midnight UTC is a bare date in disguise.
assert.equal(episodeReleaseEpochMs("2026-10-20T00:00:00.000Z"), episodeReleaseEpochMs("2026-10-20"));
assert.equal(parseEpisodeReleaseInstant("2026-10-20T00:00:00Z").exact, false);

// An exact instant keeps its time: 01:00 UTC is 03:00 in Paris (summer time).
assert.equal(episodeReleaseLocalTime("2026-10-21T01:00:00.000Z"), "03:00");
assert.equal(episodeReleaseLocalDate("2026-10-21T01:00:00.000Z"), "2026-10-21");
assert.equal(episodeReleaseEpochMs("2026-10-21T03:00:00+02:00"), Date.parse("2026-10-21T01:00:00Z"));
assert.equal(withEpisodeReleaseTime("Diffusion demain", "2026-10-21T01:00:00.000Z"), "Diffusion demain · 03:00");
assert.equal(withEpisodeReleaseTime("Diffusion demain", "2026-10-20"), "Diffusion demain");
assert.equal(hasEpisodeReleaseAired("2026-10-21T01:00:00.000Z", Date.parse("2026-10-21T00:59:59Z")), false);
assert.equal(hasEpisodeReleaseAired("2026-10-21T01:00:00.000Z", Date.parse("2026-10-21T01:00:00Z")), true);
assert.equal(hasEpisodeReleaseAired("not a date"), null);

// TVmaze: only episodes with a real air time.
const tvmaze = [
  { season: 1, number: 3, airtime: "", airstamp: "2026-10-20T12:00:00+00:00" },
  { season: 2, number: 1, airtime: "21:00", airstamp: "2026-10-21T01:00:00+00:00" }
];
assert.deepEqual(parseTvMazeEpisodes(tvmaze), { "2:1": Date.parse("2026-10-21T01:00:00Z") });

const meta = {
  id: "tt23112594",
  type: "series",
  name: "VisionQuest",
  videos: [
    { id: "e3", season: 1, episode: 3, released: "2026-10-20" },
    { id: "s2e1", season: 2, episode: 1, released: "2026-10-20" },
    { id: "old", season: 1, episode: 1, released: "2024-01-01" }
  ]
};
assert.equal(needsReleaseTimes(meta.videos, parisEvening), true);
assert.equal(needsReleaseTimes([{ season: 1, released: "2024-01-01" }], parisEvening), false);
const applied = applyEpisodeReleaseTimes(meta, parseTvMazeEpisodes(tvmaze));
assert.equal(applied.videos[1].released, "2026-10-21T01:00:00.000Z");
assert.equal(applied.videos[0].released, "2026-10-20");
assert.equal(applyEpisodeReleaseTimes(meta, {}), meta, "unchanged reference without times");

// Enrichment: TVmaze lookup then episodes, cached; failures leave the meta untouched.
const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  if (url.includes("/lookup/shows")) return { ok: true, json: async () => ({ id: 64950 }) };
  return { ok: true, json: async () => tvmaze };
};
const storage = { data: {}, get(key, d) { return this.data[key] ?? d; }, set(key, v) { this.data[key] = v; } };
resetEpisodeReleaseTimesCache();
const enriched = await enrichEpisodeReleaseTimes(meta, "tt23112594", { fetch: fakeFetch, now: () => parisEvening, storage });
assert.equal(enriched.videos[1].released, "2026-10-21T01:00:00.000Z");
assert.deepEqual(calls, [
  "https://api.tvmaze.com/lookup/shows?imdb=tt23112594",
  "https://api.tvmaze.com/shows/64950/episodes"
]);
await enrichEpisodeReleaseTimes(meta, "tt23112594", { fetch: fakeFetch, now: () => parisEvening, storage });
assert.equal(calls.length, 2, "cached for six hours");
resetEpisodeReleaseTimesCache();
const failing = async () => { throw new Error("offline"); };
assert.equal(
  await enrichEpisodeReleaseTimes(meta, "tt23112594", { fetch: failing, now: () => parisEvening, storage: null }),
  meta
);
const slow = () => new Promise(() => {});
resetEpisodeReleaseTimesCache();
assert.equal(
  await enrichEpisodeReleaseTimes(meta, "tt23112594", { fetch: slow, now: () => parisEvening, storage: null, timeoutMs: 20 }),
  meta,
  "never waits past the timeout"
);

// Calendar: the episode lands on the 21st, with its local time when exact.
const { calendarEpisodes, calendarReleaseDate } = await import("../js/core/perso/personalCalendar.js");
assert.equal(calendarReleaseDate("2026-10-20"), "2026-10-21");
const episodes = calendarEpisodes(applied, { id: "tt23112594", name: "VisionQuest", sources: ["Library"] }, parisEvening);
const byId = Object.fromEntries(episodes.map((ep) => [ep.videoId, ep]));
assert.equal(byId.e3.releaseDate, "2026-10-21");
assert.equal(byId.e3.releaseTime, null);
assert.equal(byId.s2e1.releaseTime, "03:00");

// Next Up policy and the player use the same instant.
const { shouldSurfaceNextUpForUntrackedSeries } = await import("../js/ui/screens/home/nextUpWatchingPolicy.js");
assert.equal(
  shouldSurfaceNextUpForUntrackedSeries({ seedUpdatedAt: Date.parse("2026-10-21T01:00:00Z"), released: "2026-10-20", nowMs: parisEvening }),
  true,
  "a bare date releases after a seed watched at 01:00 UTC on the 21st"
);

const { hasEpisodeAired } = await import("../js/ui/screens/player/playerNextEpisodeRules.js");
assert.equal(hasEpisodeAired("2026-10-20", parisEvening), false, "the next episode is not offered before it reaches Europe");
assert.equal(hasEpisodeAired("2026-10-20", Date.parse("2026-10-21T02:00:00Z")), true);

console.log("perso release times tests passed");
