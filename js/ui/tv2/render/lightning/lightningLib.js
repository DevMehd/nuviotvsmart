// Entry of dist/assets/runtime/tv2-lightning.js (scripts/build.mjs), loaded only by the WebGL
// Home prototype, so the app bundle and Tizen never carry Lightning. Same package and modules
// as benchmarks/vidaa-comparison/adapters/lightning.js; SDF text, canvas text only for
// characters outside the atlases.
import { RendererMain } from "@lightningjs/renderer";
import { WebGlCoreRenderer, SdfTextRenderer } from "@lightningjs/renderer/webgl";
import { CanvasTextRenderer } from "@lightningjs/renderer/canvas";
import { WebPlatform, WebPlatformLegacy } from "@lightningjs/renderer/platforms";
import { Rounded, RoundedWithBorder } from "@lightningjs/renderer/webgl/shaders";

globalThis.NuvioLightning = {
  RendererMain,
  WebGlCoreRenderer,
  SdfTextRenderer,
  CanvasTextRenderer,
  WebPlatform,
  WebPlatformLegacy,
  Rounded,
  RoundedWithBorder
};
