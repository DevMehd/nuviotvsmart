// Lot P, P5: in-player Sources of the new VIDAA player (js/ui/tv2/player/playerSourcesPanel.js):
// route candidates, addon filter, failure marks, reload on request only (chunks, abort, stale),
// and the render window. The switch itself is checked in tests/test-vidaa-player2-sources.html.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "vidaa";

const { createPlayerSources, sourceWindowStart, SOURCE_WINDOW } =
  await import("../js/ui/tv2/player/playerSourcesPanel.js");

const a = { id: "a", url: "http://media.invalid/a.mkv", name: "A 4K", addonName: "One" };
const b = { id: "b", url: "http://media.invalid/b.mkv", name: "B 1080p", addonName: "Two" };
const group = (addonName, streams) => ({
  status: "success",
  data: [{ addonName, streams }]
});

function fakeRepository() {
  const calls = [];
  const paused = [];
  let pending = null;
  return {
    calls,
    paused,
    setLocalPluginSearchPaused: (value) => paused.push(value),
    getStreamsFromAllAddons(type, videoId, options) {
      calls.push({ type, videoId, options });
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, options };
      });
    },
    get pending() {
      return pending;
    }
  };
}

// 1. Route candidates, ordered, deduplicated; a synthetic route link is listed for the focus.
{
  const changes = [];
  const sources = createPlayerSources(
    { itemType: "movie", itemId: "tt1", streamCandidates: [a, b, { ...a }] },
    { repository: fakeRepository(), onChange: () => changes.push(1) }
  );
  assert.deepEqual(
    sources.list().map((stream) => stream.id),
    ["a", "b"]
  );
  assert.deepEqual(sources.filters(), ["all", "One", "Two"]);
  const synthetic = { url: "http://media.invalid/c.mp4", addonName: "Current", isSynthetic: true };
  sources.include(synthetic);
  sources.include(a);
  assert.equal(sources.list().length, 3);
  assert.ok(
    sources.isSame(
      synthetic,
      sources.list().find((stream) => stream.isSynthetic)
    )
  );
  assert.ok(sources.isSame({ ...a }, a), "same source by merge key");
  assert.ok(!sources.isSame(a, b));

  // 2. Filter by addon, wrapping both ways.
  sources.cycleFilter(1);
  assert.equal(sources.filter, "Current");
  sources.cycleFilter(1);
  sources.cycleFilter(1);
  assert.equal(sources.filter, "Two");
  assert.deepEqual(
    sources.list().map((stream) => stream.id),
    ["b"]
  );
  sources.cycleFilter(1);
  assert.equal(sources.filter, "all");
  sources.cycleFilter(-1);
  assert.equal(sources.filter, "Two");

  // 3. Failure marks: by merge key, once; an image shown clears it.
  sources.markFailed({ ...b });
  sources.markFailed(b);
  assert.equal(changes.length, 1, "one change for one mark");
  assert.ok(sources.isFailed(b));
  sources.markFailed(b, false);
  assert.ok(!sources.isFailed(b));
}

// 4. Reload on request: chunks merge as addons answer, forced refresh, plugins resumed then
// paused again on cancel; a cancelled reload is ignored.
{
  const repository = fakeRepository();
  const sources = createPlayerSources(
    {
      itemType: "series",
      itemId: "tt2",
      videoId: "tt2:1:3",
      season: 1,
      episode: 3,
      streamCandidates: [a]
    },
    { repository }
  );
  assert.equal(repository.calls.length, 0, "opening the list asks no addon");
  const loading = sources.reload();
  assert.equal(sources.loading, true);
  assert.deepEqual(repository.paused, [false]);
  const call = repository.calls[0];
  assert.equal(call.type, "series");
  assert.equal(call.videoId, "tt2:1:3");
  assert.equal(call.options.season, 1);
  assert.equal(call.options.episode, 3);
  assert.equal(call.options.forceRefresh, true);
  assert.ok(call.options.signal, "abortable");
  void sources.reload();
  assert.equal(repository.calls.length, 1, "no second request while loading");
  call.options.onChunk(group("Two", [{ url: b.url, name: "B 1080p" }]));
  assert.equal(sources.list().length, 2, "a chunk joins the list");
  repository.pending.resolve(group("Three", [{ url: "http://media.invalid/d.mkv", name: "D" }]));
  await loading;
  assert.equal(sources.loading, false);
  assert.equal(sources.list().length, 3);

  const second = sources.reload();
  const signal = repository.calls[1].options.signal;
  sources.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(sources.loading, false);
  assert.deepEqual(repository.paused, [false, false, true]);
  repository.calls[1].options.onChunk(group("Late", [{ url: "http://media.invalid/e.mkv" }]));
  repository.pending.resolve(group("Late", [{ url: "http://media.invalid/f.mkv" }]));
  await second;
  assert.equal(sources.list().length, 3, "a cancelled reload adds nothing");

  const failing = sources.reload();
  repository.pending.reject(new Error("offline"));
  await failing;
  assert.equal(sources.error, true);
  assert.equal(sources.loading, false);
}

// 5. Render window: about nine rows around the focus, inside the list.
assert.equal(SOURCE_WINDOW, 9);
assert.equal(sourceWindowStart(5, 3), 0);
assert.equal(sourceWindowStart(200, 0), 0);
assert.equal(sourceWindowStart(200, 100), 96);
assert.equal(sourceWindowStart(200, 199), 191);

console.log(
  "PASS: new VIDAA player Sources (candidates, filter, failure marks, reload on request)"
);
