import { createSignal, For, createComponent } from "solid-js";
import { render } from "solid-js/web";
import h from "solid-js/h";
import { style, tag, checkDom } from "../scene.js";
export function mount(root) {
  const [items, setItems] = createSignal([]),
    rows = new Map();
  const dispose = render(
    () =>
      createComponent(For, {
        get each() {
          return items();
        },
        children: (row) =>
          h(
            tag(row.get()),
            {
              "data-id": row.id,
              style: () => style(row.get()),
              ...(row.get().type === "image" ? { src: () => row.get().src } : {})
            },
            () => (row.get().type === "text" ? row.get().text : "")
          )
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
