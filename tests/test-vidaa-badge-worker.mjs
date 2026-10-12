import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import { build } from "esbuild";
import { prepareStreamBadgeMatches } from "../js/core/streams/streamBadgeWarmup.js";
import {
  resolveStreamBadgePresetRules,
  getStreamImageBadges
} from "../js/core/streams/streamBadgePresets.js";
import { badgeMatchCandidates, matchStreamBadges } from "../js/core/streams/streamBadgeRules.js";

const compiled = await build({
  entryPoints: [new URL("../js/core/streams/streamBadgeWorker.js", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  target: "chrome56"
});
const workers = [];
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.Worker = class {
  constructor(path) {
    assert.equal(path, "assets/runtime/stream-badges-worker.js");
    this.thread = new NodeWorker(
      `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=data=>parentPort.postMessage(data);parentPort.on('message',data=>self.onmessage({data}));${compiled.outputFiles[0].text}`,
      { eval: true }
    );
    this.thread.on("message", (data) => this.onmessage?.({ data }));
    this.thread.on("error", (error) => this.onerror?.(error));
    workers.push(this);
  }
  postMessage(data) {
    assert.ok(!JSON.stringify(data).includes("secret-token"));
    this.thread.postMessage(data);
  }
  terminate() {
    this.thread.terminate();
  }
};

try {
  const streams = [
    { name: "𝟰𝗞", title: "BluRay REMUX HEVC HDR10+ Dolby Vision Atmos 5.1 French" },
    { title: "1080p WEB-DL H264 AAC English" },
    { title: "2160p REMUX DTS-HD MA MULTI Netflix" },
    { title: "720p x265 AC3 French" }
  ].map((stream, i) => ({
    ...stream,
    url: "https://example.test/secret-token",
    behaviorHints: { filename: `Sample${i}.mkv` }
  }));
  let totalTicks = 0;
  for (const id of ["NARD", "ELITE"]) {
    const rules = resolveStreamBadgePresetRules({ personalBadgePreset: id }, true);
    const expected = streams.map((stream) => matchStreamBadges(stream, rules));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    assert.equal(await prepareStreamBadgeMatches(streams, { rules }), true);
    clearInterval(timer);
    totalTicks += ticks;
    assert.deepEqual(
      streams.map((stream) => getStreamImageBadges(stream, { rules })),
      expected
    );
  }
  assert.ok(
    totalTicks > 0,
    "the main event loop remains available during worker initialization and matching"
  );
  assert.ok(badgeMatchCandidates(streams[0]).every((text) => !text.includes("secret-token")));
  console.log(
    "PASS: actual isolated badge worker matches both presets and keeps the main event loop available"
  );
} finally {
  workers.forEach((worker) => worker.terminate());
}
