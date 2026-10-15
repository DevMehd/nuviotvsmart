import { WIDTH, HEIGHT, ANIMATION } from "../protocol.js";
export function mount(root, { images }) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  root.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw Error("canvas2d-unavailable");
  let nodes = [],
    animations = new Map(),
    raf = 0,
    lastDraw = [];
  function draw() {
    const now = performance.now();
    let active = false;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    lastDraw = [];
    for (const p of nodes) {
      const a = animations.get(p.id),
        t = a ? Math.min(1, (now - a.at) / ANIMATION) : 1;
      const x = a ? a.from.x + (p.x - a.from.x) * t : p.x,
        y = a ? a.from.y + (p.y - a.from.y) * t : p.y,
        opacity = a ? a.from.opacity + (p.opacity - a.from.opacity) * t : p.opacity;
      if (t < 1) active = true;
      ctx.globalAlpha = opacity;
      if (p.type === "image") ctx.drawImage(images.get(p.src), x, y, p.w, p.h);
      else if (p.type === "text") {
        ctx.font = `${p.font}px Bench`;
        ctx.textBaseline = "top";
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, p.w, p.h);
      }
      lastDraw.push({ ...p, x, y, opacity });
    }
    ctx.globalAlpha = 1;
    raf = active ? requestAnimationFrame(draw) : 0;
  }
  return {
    update(next) {
      const now = performance.now();
      animations.clear();
      const drawn = new Map(lastDraw.map((p) => [p.id, p]));
      for (const p of next) {
        const from = drawn.get(p.id);
        if (p.animate && from && (p.x !== from.x || p.y !== from.y || p.opacity !== from.opacity))
          animations.set(p.id, { from, at: now });
      }
      nodes = next;
      if (raf) cancelAnimationFrame(raf);
      draw(now);
    },
    inspect(expected) {
      const issues = [];
      if (lastDraw.length !== expected.length) issues.push("node-count");
      expected.forEach((p, i) => {
        const actual = lastDraw[i];
        if (!actual || actual.id !== p.id) {
          issues.push("node-order");
          return;
        }
        if (
          Math.abs(actual.x - p.x) > 0.5 ||
          Math.abs(actual.y - p.y) > 0.5 ||
          Math.abs(actual.opacity - p.opacity) > 0.01 ||
          actual.w !== p.w ||
          actual.h !== p.h
        )
          issues.push("geometry");
        if (actual.text !== p.text || actual.font !== p.font) issues.push("text");
        if (actual.src !== p.src || (p.type === "image" && !images.get(p.src)?.naturalWidth))
          issues.push("image");
      });
      return {
        ok: !issues.length,
        count: lastDraw.length,
        issues: [...new Set(issues)],
        method: "drawing-commands-and-image-state; not pixel comparison"
      };
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.remove();
      images.clear();
    },
    info: { engine: "CanvasRenderingContext2D", backing: [WIDTH, HEIGHT] }
  };
}
