import { createSignal, createRenderEffect, For, createComponent } from "solid-js";
import { render } from "solid-js/web";
import { style, tag, checkDom } from "../scene.js";
// Mirrors compiled Solid JSX: one element per keyed row and one render effect
// that patches style, src and text from the row signal. solid-js/h dynamic
// props stopped tracking the row signal after the first update in validation.
export function mount(root) {
  const [items, setItems] = createSignal([]),
    rows = new Map();
  const dispose = render(
    () =>
      createComponent(For, {
        get each() {
          return items();
        },
        children: (row) => {
          const element = document.createElement(tag(row.get()));
          element.dataset.id = row.id;
          createRenderEffect(() => {
            const p = row.get(),
              css = style(p);
            if (element.getAttribute("style") !== css) element.setAttribute("style", css);
            if (p.type === "image") {
              if (element.getAttribute("src") !== p.src) element.src = p.src;
            } else if (p.type === "text" && element.textContent !== p.text)
              element.textContent = p.text;
          });
          return element;
        }
      }),
    root
  );
  return {
    update(nodes) {
      const next = nodes.map((p) => {
        let row = rows.get(p.id);
        if (!row) {
          const [get, set] = createSignal(p);
          row = { id: p.id, get, set };
          rows.set(p.id, row);
        } else row.set(p);
        return row;
      });
      setItems(next);
      const keep = new Set(nodes.map((p) => p.id));
      for (const id of rows.keys()) if (!keep.has(id)) rows.delete(id);
    },
    inspect: (nodes) => checkDom(root, nodes),
    destroy() {
      dispose();
      rows.clear();
    }
  };
}
