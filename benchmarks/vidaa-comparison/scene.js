import { WIDTH, HEIGHT, ANIMATION } from "./protocol.js";
export const ASSETS = [
  ...Array.from({ length: 24 }, (_, i) => `fixtures/poster-${i}.jpg`),
  ...Array.from({ length: 6 }, (_, i) => `fixtures/badge-${i}.png`),
  ...Array.from({ length: 4 }, (_, i) => `fixtures/backdrop-${i}.jpg`)
];
const rect = (id, x, y, w, h, color, extra = {}) => ({
  id,
  type: "rect",
  x,
  y,
  w,
  h,
  color,
  opacity: 1,
  ...extra
});
const text = (id, x, y, w, label, font = 24) => ({
  id,
  type: "text",
  x,
  y,
  w,
  h: Math.ceil(font * 1.25),
  text: label,
  font,
  color: "#f1f4fb",
  opacity: 1
});
const image = (id, x, y, w, h, src, extra = {}) => ({
  id,
  type: "image",
  x,
  y,
  w,
  h,
  src,
  color: "#ffffff",
  opacity: 1,
  ...extra
});
export function sceneAt(scene, step) {
  const nodes = [rect("base", 0, 0, WIDTH, HEIGHT, "#101525")];
  if (scene === "hero") {
    // Two fixed image layers alternate opacity. The concealed layer changes first.
    const current = step % 2;
    for (let layer = 0; layer < 2; layer++)
      nodes.push(
        image(`hero-${layer}`, 0, 0, 1920, 1080, `fixtures/backdrop-${layer}.jpg`, {
          opacity: layer === current ? 1 : 0,
          animate: true
        })
      );
    nodes.push(
      rect("shade", 0, 710, 1920, 370, "#101525"),
      text("hero-title", 80, 750, 1500, `Exploration ${(Math.floor(step / 2) % 24) + 1}`, 52),
      text("hero-info", 80, 825, 1600, "2026 · Aventure · 4K · Dolby · Version française", 28)
    );
    for (let i = 0; i < 6; i++)
      nodes.push(image(`hero-badge-${i}`, 80 + i * 148, 900, 128, 44, `fixtures/badge-${i}.png`));
    nodes.push(
      image("logo", 1480, 80, 300, 450, `fixtures/poster-${Math.floor(step / 2) % 24}.jpg`)
    );
    return nodes;
  }
  nodes.push(
    text(
      "title",
      64,
      28,
      1700,
      scene === "sources"
        ? "Sources de test · données synthétiques"
        : "Nuvio · catalogue de comparaison",
      36
    )
  );
  if (scene === "sources") {
    const first = Math.max(0, step - 3),
      selected = Math.min(step, 3);
    for (let i = 0; i < 10; i++) {
      const id = first + i,
        y = 110 + i * 90;
      nodes.push(rect(`row-${id}`, 70, y, 1770, 80, id % 2 ? "#202c43" : "#26334c"));
      nodes.push(
        text(
          `name-${id}`,
          90,
          y + 8,
          650,
          `Source ${String(id + 1).padStart(3, "0")} · UHD 2160p · HEVC`,
          26
        )
      );
      nodes.push(
        text(`info-${id}`, 90, y + 45, 600, `FR / EN · ${18 + (id % 70)} Go · cache disponible`, 20)
      );
      for (let b = 0; b < 6; b++)
        nodes.push(
          image(
            `badge-${id}-${b}`,
            800 + b * 162,
            y + 20,
            128,
            44,
            `fixtures/badge-${(b + Math.floor(step / 5)) % 6}.png`
          )
        );
    }
    nodes.push(rect("focus", 66, 106 + selected * 90, 1778, 4, "#ff5cac", { animate: true }));
  } else {
    const firstRow = scene === "vertical" ? Math.max(0, step - 1) : 0;
    const firstCol = scene === "horizontal" ? Math.max(0, step - 3) : 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 8; c++) {
        const id = (firstRow + r) * 100 + firstCol + c,
          x = 64 + c * 230,
          y = 125 + r * 310;
        nodes.push(image(`poster-${id}`, x, y, 200, 250, `fixtures/poster-${id % 24}.jpg`));
        nodes.push(text(`label-${id}`, x, y + 260, 215, `Film ${id + 1}`, 22));
      }
    const col = scene === "horizontal" ? Math.min(step, 3) : 0,
      row = scene === "vertical" ? Math.min(step, 1) : 0;
    nodes.push(
      rect("focus", 60 + col * 230, 117 + row * 310, 208, 5, "#ff5cac", { animate: true })
    );
  }
  return nodes;
}
export function style(p) {
  return `position:absolute;left:0;top:0;transform:translate(${p.x}px,${p.y}px);width:${p.w}px;height:${p.h}px;opacity:${p.opacity};color:${p.color};background:${p.type === "rect" ? p.color : "transparent"};font:${p.font || 24}px/1.25 Bench;white-space:nowrap;overflow:hidden;${p.animate ? `transition:transform ${ANIMATION}ms linear,opacity ${ANIMATION}ms linear;` : ""}`;
}
export const tag = (p) => (p.type === "image" ? "img" : "div");
export function checksum(nodes) {
  let hash = 2166136261;
  for (const node of nodes)
    for (const c of JSON.stringify(node)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
export async function preload() {
  await document.fonts.load("24px Bench");
  const images = new Map();
  await Promise.all(
    ASSETS.map(
      (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = async () => {
            try {
              await image.decode();
              images.set(src, image);
              resolve();
            } catch {
              reject(Error("image-decode-failed"));
            }
          };
          image.onerror = () => reject(Error("image-load-failed"));
          image.src = src;
        })
    )
  );
  return images;
}
export function checkDom(root, nodes) {
  const elements = Array.from(root.children);
  const expected = nodes.map((n) => n.id);
  const actual = elements.map((e) => e.dataset.id);
  const issues = [];
  if (JSON.stringify(expected) !== JSON.stringify(actual)) issues.push("node-order-or-count");
  nodes.forEach((p, i) => {
    const e = elements[i];
    if (!e) return;
    if (e.style.transform !== `translate(${p.x}px, ${p.y}px)`) issues.push("geometry");
    if (p.type === "text" && e.textContent !== p.text) issues.push("text");
    if (p.type === "image" && (!e.complete || !e.naturalWidth || !e.src.endsWith(p.src)))
      issues.push("image");
  });
  return { ok: !issues.length, count: elements.length, issues: [...new Set(issues)] };
}
