import { renderLegacySidebar } from "../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { railWindow, slotFor, rowsOffset } from "./railEngine.js";
import { focusedIndex } from "./focusModel.js";
import { sizedImageUrl } from "./imagePipeline.js";

// Renderers of the new TV Home (nuv-091) share one interface:
//   setRows(rows), update(rows, focus, { sidebarIndex }), setHero(item), setProfile(state),
//   sidebarItems(), destroy().
// This is the DOM one, the universal fallback; render/lightning/ is the WebGL one (lot B2).

export const ROW_TITLE_HEIGHT = 56;
export const VIEWPORT_WIDTH = 1920 - 220;

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

/** Card dataset read by openDetail and the diagnostic driver; skipped when already filled. */
export function fillCard(node, item, index, row) {
  if (node.dataset.index === String(index) && node.dataset.rowKey === row.key) return;
  node.dataset.index = String(index);
  node.dataset.rowKey = row.key;
  node.dataset.itemId = String(item.id || "");
  node.dataset.itemType = String(item.type || item.apiType || "movie");
  node.dataset.itemTitle = String(item.name || item.title || "");
  node.dataset.posterSrc = String(item.poster || "");
  node.dataset.backdropSrc = String(item.background || item.backdrop || "");
  node.dataset.addonBaseUrl = String(item.addonBaseUrl || "");
  node.dataset.addonId = String(item.addonId || "");
  node.dataset.addonName = String(item.addonName || "");
  node.dataset.catalogType = String(item.catalogType || item.type || "movie");
  node.querySelector(".tv2-card-title").textContent = node.dataset.itemTitle;
}

export function createDomHomeRenderer(container, { geometry, imageQueue, layout = {} }) {
  container.innerHTML = `
    <div class="tv2-home">
      ${renderLegacySidebar({ selectedRoute: "home", layout })}
      <div class="tv2-hero"><img class="tv2-hero-backdrop" alt="" decoding="async" />
        <div class="tv2-hero-text"><h1 class="tv2-hero-title"></h1><p class="tv2-hero-description"></p></div>
      </div>
      <div class="home-main tv2-main"><div class="tv2-rows"></div></div>
    </div>`;
  const root = container.querySelector(".tv2-home");
  const rowsHost = container.querySelector(".tv2-rows");
  const heroBackdrop = container.querySelector(".tv2-hero-backdrop");
  const heroTitle = container.querySelector(".tv2-hero-title");
  const heroDescription = container.querySelector(".tv2-hero-description");
  const views = new Map();
  let focusedNode = null;

  const sizeFor = (kind) => (kind === "continue" ? geometry.landscape : geometry.poster);

  function setRows(rows) {
    const keys = new Set(rows.map((row) => row.key));
    for (const [key, view] of views) {
      if (!keys.has(key)) {
        view.section.remove();
        views.delete(key);
      }
    }
    rows.forEach((row) => {
      let view = views.get(row.key);
      if (!view) {
        const section = document.createElement("section");
        section.className = "tv2-row";
        section.innerHTML = `<h2 class="tv2-row-title"></h2><p class="tv2-row-status"></p><div class="tv2-track"></div>`;
        view = { section, track: section.querySelector(".tv2-track"), slots: [], kind: row.kind };
        views.set(row.key, view);
      }
      rowsHost.appendChild(view.section);
      view.section.querySelector(".tv2-row-title").textContent = row.title || "";
      const status = row.items.length
        ? ""
        : row.status === "loading"
          ? "Chargement…"
          : "Indisponible pour le moment";
      view.section.querySelector(".tv2-row-status").textContent = status;
      const { height } = sizeFor(row.kind);
      view.section.style.height = `${height + ROW_TITLE_HEIGHT + geometry.gap}px`;
    });
  }

  function slotNode(view, slot) {
    let node = view.slots[slot];
    if (!node) {
      node = document.createElement("article");
      node.className = `${view.kind === "continue" ? "home-continue-card" : "home-poster-card"} tv2-card focusable`;
      node.dataset.action = "openDetail";
      node.innerHTML = `<img class="tv2-card-image" alt="" decoding="async" /><div class="tv2-card-title"></div>`;
      const { width, height } = sizeFor(view.kind);
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      view.track.appendChild(node);
      view.slots[slot] = node;
    }
    return node;
  }

  function update(rows, focus, { sidebarIndex = -1 } = {}) {
    const heights = [];
    rows.forEach((row, rowIndex) => {
      const view = views.get(row.key);
      const size = sizeFor(row.kind);
      heights.push(size.height + ROW_TITLE_HEIGHT + geometry.gap);
      if (!view) return;
      const pitch = size.width + geometry.gap;
      const column = Number(focus.columns[row.key] || 0);
      const win = railWindow({
        count: row.items.length,
        focusIndex: column,
        pitch,
        viewport: VIEWPORT_WIDTH
      });
      const loadImages = rowIndex >= focus.row - 1 && rowIndex <= focus.row + 2;
      view.slots.forEach((node) => (node.style.visibility = "hidden"));
      for (let i = win.start; i < win.end; i += 1) {
        const node = slotNode(view, slotFor(i, win.poolSize));
        fillCard(node, row.items[i], i, row);
        node.style.visibility = "";
        node.style.transform = `translate3d(${i * pitch}px,0,0)`;
        const image = node.querySelector(".tv2-card-image");
        const source =
          row.kind === "continue"
            ? row.items[i].landscapePoster || row.items[i].backdrop
            : row.items[i].poster;
        imageQueue.request(image, loadImages ? sizedImageUrl(source, size.width) : "");
      }
      view.track.style.transform = `translate3d(${win.offset}px,0,0)`;
    });
    rowsHost.style.transform = `translate3d(0,${rowsOffset(heights, focus.row)}px,0)`;

    focusedNode?.classList.remove("focused");
    focusedNode = null;
    if (sidebarIndex >= 0) {
      focusedNode = sidebarItems()[sidebarIndex] || null;
    } else {
      const row = rows[focus.row];
      const view = row && views.get(row.key);
      const index = focusedIndex(focus, rows);
      focusedNode =
        view?.slots.find(
          (node) => node.dataset.index === String(index) && node.style.visibility !== "hidden"
        ) || null;
    }
    focusedNode?.classList.add("focused");
    root.classList.toggle("tv2-sidebar-open", sidebarIndex >= 0);
    container.querySelector(".home-sidebar")?.classList.toggle("expanded", sidebarIndex >= 0);
  }

  function setHero(item) {
    heroTitle.textContent = item?.name || item?.title || "";
    heroDescription.textContent = item?.description || "";
    imageQueue.request(
      heroBackdrop,
      sizedImageUrl(item?.background || item?.backdrop || item?.poster, 1280)
    );
  }

  function setProfile(profile) {
    const sidebar = container.querySelector(".home-sidebar");
    if (!sidebar) return;
    sidebar.outerHTML = renderLegacySidebar({ selectedRoute: "home", layout, profile });
  }

  function sidebarItems() {
    return Array.from(container.querySelectorAll(".home-sidebar .focusable"));
  }

  return {
    setRows,
    update,
    setHero,
    setProfile,
    sidebarItems,
    focusedNode: () => focusedNode,
    destroy() {
      views.clear();
      focusedNode = null;
    }
  };
}
