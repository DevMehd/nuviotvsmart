import React, { useLayoutEffect, useState, memo } from "react";
import { createRoot } from "react-dom/client";
import { tag, checkDom } from "../scene.js";
const Node = memo(
  ({ p }) =>
    React.createElement(tag(p), {
      "data-id": p.id,
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(${p.x}px, ${p.y}px)`,
        width: p.w,
        height: p.h,
        opacity: p.opacity,
        color: p.color,
        background: p.type === "rect" ? p.color : "transparent",
        font: `${p.font || 24}px/1.25 Bench`,
        whiteSpace: "nowrap",
        overflow: "hidden",
        transition: p.animate ? "transform 140ms linear,opacity 140ms linear" : undefined
      },
      ...(p.type === "image" ? { src: p.src } : { children: p.text })
    }),
  (a, b) =>
    Object.keys(a.p).length === Object.keys(b.p).length &&
    Object.keys(a.p).every((k) => a.p[k] === b.p[k])
);
export async function mount(root) {
  let setNodes, ready, committed;
  const started = new Promise((r) => (ready = r));
  function Scene() {
    const [nodes, set] = useState([]);
    setNodes = set;
    useLayoutEffect(() => {
      ready();
      committed?.();
      committed = null;
    });
    return nodes.map((p) => React.createElement(Node, { key: p.id, p }));
  }
  const app = createRoot(root);
  app.render(React.createElement(Scene));
  await started;
  return {
    update: (nodes) =>
      new Promise((resolve) => {
        committed = resolve;
        setNodes(nodes);
      }),
    inspect: (nodes) => checkDom(root, nodes),
    destroy: () => app.unmount()
  };
}
