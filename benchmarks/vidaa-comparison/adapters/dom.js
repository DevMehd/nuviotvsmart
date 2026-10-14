import { style, tag, checkDom } from "../scene.js";
export function mount(root) {
  const rows = new Map();
  return {
    update(nodes) {
      const keep = new Set(nodes.map((p) => p.id));
      for (const [id, e] of rows)
        if (!keep.has(id)) {
          e.remove();
          rows.delete(id);
        }
      let previous = null;
      for (const p of nodes) {
        let e = rows.get(p.id);
        if (!e) {
          e = document.createElement(tag(p));
          e.dataset.id = p.id;
          rows.set(p.id, e);
        }
        const css = style(p);
        if (e.getAttribute("style") !== css) e.setAttribute("style", css);
        if (p.type === "image") {
          if (e.getAttribute("src") !== p.src) e.src = p.src;
        } else if (p.type === "text" && e.textContent !== p.text) e.textContent = p.text;
        const next = previous ? previous.nextSibling : root.firstChild;
        if (e !== next) root.insertBefore(e, next);
        previous = e;
      }
    },
    inspect: (nodes) => checkDom(root, nodes),
    destroy() {
      root.replaceChildren();
      rows.clear();
    }
  };
}
