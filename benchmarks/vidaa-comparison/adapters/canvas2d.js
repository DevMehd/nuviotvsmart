import { WIDTH, HEIGHT, ANIMATION } from "../protocol.js";
export function mount(root, { images }) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  root.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw Error("canvas2d-unavailable");
  let nodes = [],
    old = new Map(),
    animations = new Map(),
    raf = 0,
    lastDraw = [];
  function draw(now) {
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
      lastDraw.push(p.id);
    }
    ctx.globalAlpha = 1;
    raf = active ? requestAnimationFrame(draw) : 0;
  }
  return {
    update(next) {
      const now = performance.now();
      animations.clear();
      for (const p of next) {
        const from = old.get(p.id);
        if (p.animate && from && (p.x !== from.x || p.y !== from.y || p.opacity !== from.opacity))
          animations.set(p.id, { from, at: now });
      }
      nodes = next;
      old = new Map(next.map((p) => [p.id, p]));
      if (raf) cancelAnimationFrame(raf);
      draw(now);
    },
    inspect(expected) {
      return {
        ok: JSON.stringify(lastDraw) === JSON.stringify(expected.map((p) => p.id)),
        count: lastDraw.length,
        issues: []
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
