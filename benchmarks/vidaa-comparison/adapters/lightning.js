import { RendererMain } from "@lightningjs/renderer";
import { WebGlCoreRenderer } from "@lightningjs/renderer/webgl";
import { CanvasCoreRenderer, CanvasTextRenderer } from "@lightningjs/renderer/canvas";
import { WebPlatform } from "@lightningjs/renderer/platforms";
import { WIDTH, HEIGHT, ANIMATION } from "../protocol.js";
const color = (value) => (parseInt(value.slice(1), 16) * 256 + 255) >>> 0;
export function mount(root, { engine }) {
  const canvasMode = engine === "lightning-canvas";
  const renderer = new RendererMain(
    {
      appWidth: WIDTH,
      appHeight: HEIGHT,
      deviceLogicalPixelRatio: 1,
      devicePhysicalPixelRatio: 1,
      renderEngine: canvasMode ? CanvasCoreRenderer : WebGlCoreRenderer,
      fontEngines: [CanvasTextRenderer],
      platform: WebPlatform,
      numImageWorkers: 0,
      clearColor: 0x101525ff,
      textureMemory: { criticalThreshold: 96 * 1024 * 1024 },
      enableContextSpy: false
    },
    root
  );
  const rows = new Map(),
    failures = [];
  let lost = false;
  const canvas = root.querySelector("canvas");
  canvas.addEventListener("webglcontextlost", () => {
    lost = true;
  });
  const gl = canvasMode ? null : canvas.getContext("webgl2") || canvas.getContext("webgl");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  const info = {
    engine: canvasMode ? "Lightning Canvas" : "Lightning WebGL",
    textEngine: "CanvasTextRenderer",
    imageWorkers: 0,
    backing: [canvas.width, canvas.height],
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    glVersion: gl?.getParameter(gl.VERSION) || null,
    maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) || null,
    gpuTimerAvailable: Boolean(
      gl?.getExtension("EXT_disjoint_timer_query_webgl2") ||
      gl?.getExtension("EXT_disjoint_timer_query")
    )
  };
  return {
    info,
    update(nodes) {
      const keep = new Set(nodes.map((p) => p.id));
      for (const [id, row] of rows)
        if (!keep.has(id)) {
          row.animation?.stop();
          renderer.destroyNode(row.node);
          rows.delete(id);
        }
      nodes.forEach((p, index) => {
        let row = rows.get(p.id);
        if (!row) {
          const props = {
            parent: renderer.root,
            x: p.x,
            y: p.y,
            width: p.w,
            height: p.h,
            color: color(p.color),
            alpha: p.opacity,
            zIndex: index
          };
          const node =
            p.type === "text"
              ? renderer.createTextNode({
                  ...props,
                  text: p.text,
                  fontFamily: "Bench",
                  fontSize: p.font,
                  lineHeight: p.font * 1.25,
                  contain: "both"
                })
              : renderer.createNode({ ...props, ...(p.type === "image" ? { src: p.src } : {}) });
          node.on("failed", () => failures.push(p.id));
          row = { node, p, animation: null };
          rows.set(p.id, row);
        }
        const n = row.node,
          previous = row.p;
        n.zIndex = index;
        n.width = p.w;
        n.height = p.h;
        n.color = color(p.color);
        if (p.type === "text") {
          if (n.text !== p.text) n.text = p.text;
          n.fontSize = p.font;
        }
        if (p.type === "image" && previous.src !== p.src) n.src = p.src;
        if (
          p.animate &&
          (previous.x !== p.x || previous.y !== p.y || previous.opacity !== p.opacity)
        ) {
          row.animation?.stop();
          row.animation = n.animate(
            { x: p.x, y: p.y, alpha: p.opacity },
            { duration: ANIMATION, easing: "linear" }
          );
          row.animation.start();
        } else if (!row.animation) {
          n.x = p.x;
          n.y = p.y;
          n.alpha = p.opacity;
        }
        row.p = p;
      });
    },
    inspect(nodes) {
      const issues = [];
      if (lost) issues.push("context-lost");
      if (failures.length) issues.push("texture-or-font-error");
      for (const p of nodes) {
        const n = rows.get(p.id)?.node;
        if (
          !n ||
          Math.abs(n.x - p.x) > 0.1 ||
          Math.abs(n.y - p.y) > 0.1 ||
          Math.abs(n.alpha - p.opacity) > 0.01
        )
          issues.push("geometry");
        if (p.type === "text" && n?.text !== p.text) issues.push("text");
        if (p.type === "image" && n?.texture?.state !== "loaded") issues.push("image-not-loaded");
      }
      if (rows.size !== nodes.length) issues.push("node-count");
      return { ok: !issues.length, count: rows.size, issues: [...new Set(issues)] };
    },
    destroy() {
      renderer.close();
      rows.clear();
    }
  };
}
