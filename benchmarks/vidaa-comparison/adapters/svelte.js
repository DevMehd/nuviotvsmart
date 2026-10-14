import { mount as attach, unmount, tick } from "svelte";
import { createRawSnippet } from "svelte";
import Scene from "./Scene.svelte";
import { checkDom } from "../scene.js";
// Legacy component API is compiled explicitly for a stable imperative test contract.
import { createClassComponent } from "svelte/legacy";
export function mount(root) {
  const app = createClassComponent({ component: Scene, target: root, props: { nodes: [] } });
  return {
    async update(nodes) {
      app.$set({ nodes });
      await tick();
    },
    inspect: (nodes) => checkDom(root, nodes),
    destroy: () => app.$destroy()
  };
}
