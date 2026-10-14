import { createApp, h, shallowRef, nextTick } from "vue";
import { style, tag, checkDom } from "../scene.js";
export function mount(root) {
  const nodes = shallowRef([]);
  const app = createApp({
    render: () =>
      nodes.value.map((p) =>
        h(
          tag(p),
          {
            key: p.id,
            "data-id": p.id,
            style: style(p),
            ...(p.type === "image" ? { src: p.src } : {})
          },
          p.type === "text" ? p.text : undefined
        )
      )
  });
  app.mount(root);
  return {
    async update(value) {
      nodes.value = value;
      await nextTick();
    },
    inspect: (value) => checkDom(root, value),
    destroy: () => app.unmount()
  };
}
