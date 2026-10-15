# VIDAA comparison laboratory

This laboratory is loaded through a full navigation from the VIDAA diagnostic.
Its framework bundles do not enter the normal Nuvio application bundle.
`npm run package:vidaa` builds the laboratory separately for **Chrome 111** under
`dist/comparison/<content-hash>/`. Compilation is not hardware emulation: the
report records the actual browser, viewport and GPU information when available.

## Protocol v2

- Eight adapters: retained DOM, React, Vue, Svelte, Solid, Canvas 2D,
  Lightning WebGL and Lightning Canvas. Installed versions and source, asset,
  binary hashes are in `manifest.json`. Lightning uses CanvasTextRenderer,
  WebPlatform, DPR 1 and no image workers. This is not a Blits/SDF comparison.
- Five fixed-size, bounded scenes: idle, horizontal cards, vertical recycling,
  sources/badges and hero crossfades. All share local synthetic images, font,
  data, target geometry, 140 ms linear motion and input cadence. Retained nodes
  animate their window shifts in v2. Newly inserted nodes appear at destination.
- Full: eight rounds, 3.5 seconds per measured scene, 500 ms minimum warmup,
  three preparatory actions, bounded readiness validation and one-second gaps.
  Approximately 30–35 minutes on the target, depending on actual throughput and
  readiness. Short: one exploratory round; never use it as a decisive ranking.
- An eight-row Williams design gives every engine every position once and every
  ordered predecessor pair once within rounds. The order seed is generated for
  each run and exported; `?seed=<uint32>` on the hashed laboratory URL reproduces
  an order. Dataset seed stays fixed. No temperature or power sensor is available.
- Endurance runs DOM/WebGL then WebGL/DOM, one minute each, separately from short
  scenes. They do not establish hour-long stability or concurrent video behavior.
- Every adapter has a new iframe per round. HTTP/OS/driver caches are uncontrolled;
  “first observed load” is not a genuinely cold start. The ready message precedes
  first scene rendering. `settleBeforeMs` records additional pre-measurement waits.

## Measurements and validity

`frame` summarizes rendering-timeline rAF intervals; `callbackCadence` separately
summarizes actual callback execution intervals. Neither is a displayed-frame or
GPU-time counter. `input` measures **scheduled action to callback execution** using
`performance.now()`. It is not physical remote-control latency or time to photons.
The v2 action columns are explicitly named in each scene:

1. planned due time relative to scene start;
2. actual dispatch time;
3. common scene construction duration;
4. construction plus adapter submission/commit duration;
5. actual next rAF callback execution time;
6. rAF rendering-timeline timestamp (diagnostic only).

`commit` is not total render time: DOM still has layout/paint work, Lightning has
its rendering loop, while Canvas submits immediate drawing commands. Long tasks
and their excess over 50 ms are additional signals. No single overall score is
computed. Report medians of per-round p95s, full distributions and paired-round
bootstrap intervals; a small number of rounds and refresh quantization limit
confidence. Invalid scenes are excluded individually, not their valid neighbors.

Before measurement, computed DOM geometry/opacity, Lightning node state, or
Canvas drawing commands must converge within five seconds. All also validate
text/image state and counts. `ok:false` always invalidates the scene, even without
an error message. Checks happen outside the timed hot loop. They are **not pixel
comparisons**: visual validation and a representative Nuvio prototype remain
necessary before selecting a rendering engine. Hidden documents, viewport changes,
resource errors, context loss, missing actions and timeouts invalidate results.

Only approximate JS heap data is exposed. It excludes important native, GPU,
texture and video memory. A null measurement is unavailable, never zero.

## Targeted C++/Wasm

The checked-in Wasm is compiled from `wasm/kernels.cpp` with Emscripten 6.0.12,
`-O3`, no threads/SIMD/DOM. `wasm/provenance.json` holds compiler flags and hashes.
Rebuild with `NUVIO_EMXX=/path/to/em++ npm run build:comparison:wasm`. Ordinary
Vercel builds verify and copy that binary, without downloading a compiler.

Three bounded numeric kernels operate on 300/3000/30000 items: row-height prefix
sums, numeric filtering/scoring, already-tokenized badge flags. They do not model
addon regexes, decoding, C++ DOM rendering, a native VIDAA application or assembly.
All outputs are checked against JS. JS main, JS Worker clone/transfer, Wasm main
and Wasm Worker transfer are compared; single-call end-to-end costs include
preparing transferable ownership and retrieving output. Retained-memory batches
are separate throughput experiments, not single-call latency. Clock quantization,
warmup and batch iteration/duration metadata must accompany interpretations.

## Export, recovery and compatibility

Reports are stored locally after each complete trial, and may be downloaded or
sent to the existing temporary QR exchange. The server accepts v1 and v2 reports,
with bounded body sizes and aggregate in-memory storage. Private addons and login
state are never read by this laboratory. Old v1 local results use their original
storage key; v2 does not overwrite or resume them. No automatic upload occurs.

The first real TV run used v1 (`6ad820b48ee8f086`, source commit `187aac08`). Its
`input` values are unusable because they used the shared rAF timestamp instead of
callback execution time. Its cadence and long-task data remain useful within the
v1 workload. Its scrolling was mostly discrete and its Canvas validation weaker.
**Do not combine v1 and v2 rounds** or attribute v1 results to continuous scrolling.

## Verification

`npm run test:comparison` runs deterministic protocol/Wasm checks and real-browser
fixtures for all adapters. The fixtures check settled geometry, text, image state,
action counts and callback/commit chronology. These are functional desktop checks,
not TV performance measurements. `node tests/test-vidaa-diagnostic-report.mjs`
checks the QR exchange. Physical TV runs provide the actual performance evidence.
