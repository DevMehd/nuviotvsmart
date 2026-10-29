// Entry of dist/assets/runtime/tv2-lightning.js (scripts/build.mjs), loaded only by the WebGL
// Home prototype, so the app bundle and Tizen never carry Lightning. Same package and modules
// as benchmarks/vidaa-comparison/adapters/lightning.js; SDF text instead of canvas text.
import { RendererMain } from "@lightningjs/renderer";
import { WebGlCoreRenderer, SdfTextRenderer } from "@lightningjs/renderer/webgl";
import { WebPlatform, WebPlatformLegacy } from "@lightningjs/renderer/platforms";

globalThis.NuvioLightning = {
  RendererMain,
  WebGlCoreRenderer,
  SdfTextRenderer,
  WebPlatform,
  WebPlatformLegacy
};
