import { getStreamImageBadges } from "../../../core/streams/streamBadgePresets.js";
import { getStreamPresentationBadges } from "../../../core/streams/streamPresentationBadges.js";

// Compare generated attributes, not live DOM: focus, filtering, image fallbacks
// and lazy badge hydration own state that a source update must not erase.
const sources = new WeakMap();

function children(node) {
  return Array.from(node.childNodes).filter(
    (child) => child.nodeType !== 3 || child.textContent.trim()
  );
}

function key(node) {
  if (node.nodeType !== 1) return `node:${node.nodeType}`;
  if (node.hasAttribute("data-stream-key")) return `stream:${node.dataset.streamKey}`;
  if (node.hasAttribute("data-addon")) return `addon:${node.dataset.addon}`;
  if (node.dataset.action) return `action:${node.dataset.action}`;
  if (node.dataset.streamVirtualSpacer) return `spacer:${node.dataset.streamVirtualSpacer}`;
  return `${node.tagName}:${node.classList.item(0) || ""}`;
}

function hashSignature(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function computeStreamSignature(stream, badgeSettings) {
  const imgBadges = getStreamImageBadges(stream, badgeSettings);
  const presBadges = getStreamPresentationBadges(stream);
  const size =
    badgeSettings?.showFileSizeBadges !== false ? stream.behaviorHints?.videoSize || 0 : 0;
  let token = "";
  for (let i = 0; i < imgBadges.length; i++) {
    const b = imgBadges[i];
    token += (typeof b === "object" && b ? b.key || b.label || b.url || "" : String(b)) + ",";
  }
  token += "|";
  for (let i = 0; i < presBadges.length; i++) {
    token += presBadges[i] + ",";
  }
  token += "|" + size;
  return hashSignature(token);
}

export function streamDomOptions(streams, badgeSettings) {
  const signatures = new Map();
  function signature(index) {
    if (!Number.isInteger(index) || !streams[index]) return "";
    if (!signatures.has(index)) {
      signatures.set(index, computeStreamSignature(streams[index], badgeSettings));
    }
    return signatures.get(index);
  }
  return {
    badgeSignature(node) {
      const row = node.closest?.("[data-stream-row]");
      const index = Number(row?.dataset.streamRow);
      return signature(index);
    },
    presentationSignature(start = 0, end = streams.length - 1) {
      const result = [];
      for (let index = start; index <= end; index++) result.push(signature(index));
      return result.join(";");
    }
  };
}

function snapshot(node, options) {
  const row = node.nodeType === 1 && node.hasAttribute("data-stream-key");
  const lazy = node.nodeType === 1 && node.hasAttribute("data-lazy-stream-badges");
  return {
    node: node.cloneNode(false),
    markup: row ? node.outerHTML : null,
    badges: row || lazy ? options.badgeSignature?.(node) : null
  };
}

export function registerStreamDomTree(node, options = {}) {
  sources.set(node, snapshot(node, options));
  children(node).forEach((child) => registerStreamDomTree(child, options));
}

function updateAttributes(node, previous, next) {
  const names = new Set(
    [...Array.from(previous.attributes), ...Array.from(next.attributes)].map((attr) => attr.name)
  );
  for (const name of names) {
    if (previous.getAttribute(name) === next.getAttribute(name)) continue;
    if (name === "class") {
      for (const token of previous.classList) {
        if (token !== "focused" && !next.classList.contains(token)) node.classList.remove(token);
      }
      for (const token of next.classList) {
        if (token !== "focused" && !previous.classList.contains(token)) node.classList.add(token);
      }
    } else if (name === "style") {
      const properties = new Set([...Array.from(previous.style), ...Array.from(next.style)]);
      for (const property of properties) {
        if (previous.style.getPropertyValue(property) === next.style.getPropertyValue(property))
          continue;
        const value = next.style.getPropertyValue(property);
        if (value)
          node.style.setProperty(property, value, next.style.getPropertyPriority(property));
        else node.style.removeProperty(property);
      }
    } else if (next.hasAttribute(name)) node.setAttribute(name, next.getAttribute(name));
    else node.removeAttribute(name);
  }
  // Stable filtering hides existing rows/cards in place. A new eager/virtual
  // presentation must not inherit that runtime-only hidden state.
  if (next.hasAttribute("data-stream-key") || next.hasAttribute("data-card-action")) {
    node.hidden = next.hidden;
    node.style.display = next.style.display;
  }
}

function updateNode(node, next, options) {
  const previous = sources.get(node) || snapshot(node, options);
  const current = snapshot(next, options);
  if (
    current.markup !== null &&
    previous.markup === current.markup &&
    previous.badges === current.badges
  )
    return;
  if (node.nodeType !== 1) {
    if (node.textContent !== next.textContent) node.textContent = next.textContent;
  } else {
    updateAttributes(node, previous.node, next);
    if (next.hasAttribute("data-lazy-stream-badges")) {
      if (previous.badges !== current.badges) {
        node.textContent = "";
        node.classList.add("stream-route-card-badges-lazy");
        node.dataset.badgesHydrated = "false";
      }
    } else updateChildren(node, next, options);
  }
  sources.set(node, current);
}

function updateChildren(parent, next, options) {
  const available = new Map();
  for (const child of children(parent)) {
    const identity = key(sources.get(child)?.node || child);
    if (!available.has(identity)) available.set(identity, []);
    available.get(identity).push(child);
  }
  const desired = children(next).map((source) => {
    const candidates = available.get(key(source));
    const node = candidates?.find(
      (candidate) =>
        candidate.nodeType === source.nodeType && candidate.nodeName === source.nodeName
    );
    if (node) {
      candidates.splice(candidates.indexOf(node), 1);
      updateNode(node, source, options);
      return node;
    }
    registerStreamDomTree(source, options);
    return source;
  });
  available.forEach((nodes) => nodes.forEach((node) => node.remove()));

  reorderStreamNodes(parent, desired, options.focusedNode);
}

export function reorderStreamNodes(parent, desired, focusedNode) {
  // Moving an ancestor of the active element blurs it on TV Chromium. Anchor
  // that branch and insert its siblings around it, including prepend updates.
  const wanted = new Set(desired);
  const nextManaged = (node) => {
    let sibling = node.nextSibling;
    while (sibling && !wanted.has(sibling)) sibling = sibling.nextSibling;
    return sibling;
  };
  const anchor = desired.findIndex((node) => node === focusedNode || node.contains(focusedNode));
  let before = anchor >= 0 ? desired[anchor] : null;
  for (let index = (anchor >= 0 ? anchor : desired.length) - 1; index >= 0; index--) {
    const node = desired[index];
    if (node.parentNode !== parent || nextManaged(node) !== before)
      parent.insertBefore(node, before);
    before = node;
  }
  if (anchor >= 0) {
    let after = desired[anchor];
    for (let index = anchor + 1; index < desired.length; index++) {
      const node = desired[index];
      if (node.parentNode !== parent || nextManaged(after) !== node)
        parent.insertBefore(node, after.nextSibling);
      after = node;
    }
  }
}

export function updateStreamDom(container, markup, options = {}) {
  const source = container.ownerDocument.createElement("div");
  source.innerHTML = markup;
  if (options.incremental && container.querySelector(".stream-route-shell")) {
    updateChildren(container, source, options);
  } else {
    container.textContent = "";
    registerStreamDomTree(source, options);
    while (source.firstChild) container.appendChild(source.firstChild);
  }
}
