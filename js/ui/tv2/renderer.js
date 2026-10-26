import { renderLegacySidebar } from "../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { posterCardModel } from "../screens/home/homeScreenHelpers-15-create-poster-card-markup.js";
import {
  continueCardModel,
  resolveContinueWatchingBlurNextUp
} from "../screens/home/homeScreenHelpers-12-build-hero-indicators.js";
import { firstNonEmpty } from "../screens/home/homeUtils.js";
import { getVidaaArtworkOriginal } from "../screens/home/vidaaArtworkOptimization.js";
import { isTitleItemWatched, renderTitleWatchedBadge } from "../components/watchedTitleBadge.js";
import { slotFor, homeLayout, rowCardSize, ROW_TITLE_HEIGHT } from "./railEngine.js";
import { focusedIndex } from "./focusModel.js";
import { sizedImageUrl } from "./imagePipeline.js";

// Renderers of the new TV Home (nuv-091) share one interface:
//   setRows(rows), update(rows, focus, { sidebarIndex }), setHero(item), setProfile(state),
//   sidebarItems(), destroy(); optionally setWatched(ids) (DOM only, Lightning stays poster-only).
// This is the DOM one, the universal fallback; render/lightning/ draws the whole Home in WebGL.

/**
 * Card image at its displayed size with the current Home's source order (posterCardModel for
 * catalog cards, cover for folders) and fallbacks: the custom poster's original, then the
 * unoptimized nuvio-art source. `model` is the catalog card model and `cw` the Continue Watching
 * one (continueCardModel, its own source order and fallbacks), both used by the DOM card.
 */
export function cardImage(row, item, size, settings) {
  if (row.kind === "continue") {
    const cw = continueCardModel(item, {
      cardStyle: settings?.continueWatchingCardStyle || "card",
      useEpisodeThumbnails: settings?.useEpisodeThumbnailsInCw !== false,
      blurNextUp: resolveContinueWatchingBlurNextUp(settings)
    });
    const url = sizedImageUrl(cw.image, size.width);
    // Current Home order: custom poster original, nuvio-art original (unsized, sizing would
    // re-optimize it), then data-fallback-srcs.
    const fallbacks = [
      sizedImageUrl(cw.rawImage, size.width),
      getVidaaArtworkOriginal(url),
      ...cw.fallbacks.map((source) => sizedImageUrl(source, size.width))
    ].filter(Boolean);
    return { url, fallbacks: [...new Set(fallbacks)].filter((value) => value !== url), cw };
  }
  if (row.kind === "collection")
    return {
      url: sizedImageUrl(firstNonEmpty(item.poster, item.coverImageUrl, item.backdrop), size.width),
      fallbacks: []
    };
  // Landscape catalog sizes only exist in the modern layout (cardGeometry).
  const landscape = size.width > size.height;
  const model = posterCardModel(item, row.entry, {
    itemType: row.entry?.type,
    layoutMode: "modern",
    preferLandscapePoster: landscape,
    settings
  });
  const url = sizedImageUrl(model.posterSrc, size.width);
  const raw = landscape ? model.normalized.rawLandscapePosterUrl : model.normalized.rawPosterUrl;
  const fallbacks = [
    ...new Set([raw && sizedImageUrl(raw, size.width), getVidaaArtworkOriginal(url)])
  ];
  return { url, fallbacks: fallbacks.filter((value) => value && value !== url), model };
}

/** Card image URL alone; the WebGL layer asks for the very same URL. */
export const cardImageUrl = (row, item, size, settings) => cardImage(row, item, size, settings).url;
export const heroImageUrl = (item) =>
  sizedImageUrl(item?.background || item?.backdrop || item?.poster, 1280);

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

// Item each card node was filled with: a row can replace an item at the same index.
const filledItems = new WeakMap();

/**
 * Card dataset read by openDetail and the diagnostic driver; skipped when already filled with the
 * same item for the same `version` (the watched-state revision). Returns whether it was refilled.
 */
export function fillCard(node, item, index, row, version = "") {
  if (
    filledItems.get(node) === item &&
    node.dataset.index === String(index) &&
    node.dataset.rowKey === row.key &&
    node.dataset.version === version
  )
    return false;
  filledItems.set(node, item);
  node.dataset.index = String(index);
  node.dataset.rowKey = row.key;
  node.dataset.version = version;
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
  return true;
}

/** Row index as the driver counts it: empty rows are not navigable, so they are skipped. */
export const navRowOf = (rows, rowIndex) =>
  rows.slice(0, rowIndex).filter((row) => row.items.length).length;

/** Navigation position read by the benchmark driver; rewritten on every draw, outside the memo. */
export function setNavPosition(node, navRow, col) {
  node.dataset.navRow = String(navRow);
  node.dataset.navCol = String(col);
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
  // Per pooled card: its child nodes and the image chosen at the last fill.
  const cards = new WeakMap();
  const watchedBadge = renderTitleWatchedBadge();
  let watchedIds = null;
  let watchedVersion = 0;
  // Bumped by every row emit: continue cards refill then, their release labels depend on time.
  let rowsVersion = 0;
  let focusedNode = null;
  root.style.setProperty("--tv2-card-radius", `${geometry.radius ?? 24}px`);

  function setRows(rows) {
    rowsVersion += 1;
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
        view = {
          section,
          track: section.querySelector(".tv2-track"),
          slots: [],
          kind: row.kind,
          size: rowCardSize(row, geometry)
        };
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
      const { height } = view.size;
      view.section.style.height = `${height + ROW_TITLE_HEIGHT + geometry.gap}px`;
    });
  }

  function slotNode(view, slot) {
    let node = view.slots[slot];
    if (!node) {
      node = document.createElement("article");
      node.className = `${view.kind === "continue" ? "home-continue-card" : "home-poster-card"} tv2-card focusable`;
      node.dataset.action = "openDetail";
      const title = `<div class="tv2-card-title" dir="auto"></div>`;
      node.innerHTML = `<img class="tv2-card-image" alt="" decoding="async" />${watchedBadge}
        <div class="tv2-card-overlay"><img class="tv2-card-logo" alt="" decoding="async" />
          <div class="tv2-card-overlay-title"></div><div class="tv2-card-overlay-subtitle"></div></div>
        ${
          view.kind === "continue"
            ? `<span class="tv2-cw-badge"></span><div class="tv2-cw-copy"><div class="tv2-cw-kicker"></div>
          ${title}<div class="tv2-cw-subtitle"></div></div><div class="tv2-cw-progress"><span></span></div>`
            : title
        }`;
      const { width, height } = view.size;
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      cards.set(node, {
        image: node.querySelector(".tv2-card-image"),
        logo: node.querySelector(".tv2-card-logo"),
        title: node.querySelector(".tv2-card-title"),
        overlayTitle: node.querySelector(".tv2-card-overlay-title"),
        overlaySubtitle: node.querySelector(".tv2-card-overlay-subtitle"),
        badge: node.querySelector(".tv2-cw-badge"),
        kicker: node.querySelector(".tv2-cw-kicker"),
        subtitle: node.querySelector(".tv2-cw-subtitle"),
        progress: node.querySelector(".tv2-cw-progress span"),
        source: null
      });
      view.track.appendChild(node);
      view.slots[slot] = node;
    }
    return node;
  }

  /**
   * Current Home card content: watched badge, landscape logo/title overlay, folder emoji, and the
   * Continue Watching badge, episode code, title, episode title, progress and Next Up blur.
   */
  function fillContent(node, row, item, size) {
    const card = cards.get(node);
    const source = cardImage(row, item, size, layout);
    const { model, cw } = source;
    const landscape = Boolean(model) && size.width > size.height;
    const emoji = row.kind === "collection" && !source.url ? item.coverEmoji || "" : "";
    node.classList.toggle(
      "is-watched",
      Boolean(model) && isTitleItemWatched(model.normalized, watchedIds)
    );
    node.classList.toggle("is-landscape", landscape);
    node.classList.toggle("tv2-card-emoji", Boolean(emoji));
    // Posters show no title (D2).
    card.title.textContent = cw ? cw.title : emoji;
    if (cw) {
      node.classList.toggle("home-continue-card-blur-next-up", cw.blur);
      card.badge.textContent = cw.badge;
      card.kicker.textContent = cw.kicker;
      card.subtitle.textContent = cw.subtitle;
      card.progress.style.width = `${cw.progressPct}%`;
    }
    const logo = landscape ? model.normalized.logo || "" : "";
    card.overlayTitle.textContent = landscape && !logo ? model.normalized.name || "Untitled" : "";
    card.overlaySubtitle.textContent = landscape ? model.subtitle || "" : "";
    card.source = { url: source.url, fallbacks: source.fallbacks, logo };
  }

  function update(rows, focus, { sidebarIndex = -1 } = {}) {
    const placed = homeLayout(rows, focus, geometry);
    const focusIndex = focusedIndex(focus, rows);
    const logos = [];
    placed.rows.forEach(({ row, pitch, win }, rowIndex) => {
      const view = views.get(row.key);
      if (!view) return;
      const loadImages = rowIndex >= focus.row - 1 && rowIndex <= focus.row + 2;
      const navRow = navRowOf(rows, rowIndex);
      view.slots.forEach((node) => (node.style.visibility = "hidden"));
      for (let i = win.start; i < win.end; i += 1) {
        const node = slotNode(view, slotFor(i, win.poolSize));
        const version =
          row.kind === "continue" ? `${watchedVersion}:${rowsVersion}` : String(watchedVersion);
        if (fillCard(node, row.items[i], i, row, version))
          fillContent(node, row, row.items[i], view.size);
        setNavPosition(node, navRow, i);
        node.style.visibility = "";
        node.style.transform = `translate3d(${i * pitch}px,0,0)`;
        const { image, logo, source } = cards.get(node);
        imageQueue.request(image, loadImages ? source.url : "", {
          fallbacks: source.fallbacks,
          priority: rowIndex === focus.row && i === focusIndex
        });
        logos.push([logo, loadImages ? source.logo : ""]);
      }
      view.track.style.transform = `translate3d(${win.offset}px,0,0)`;
    });
    // Landscape logos after every artwork: the lowest priority in the same bounded queue.
    logos.forEach(([node, url]) => imageQueue.request(node, url));
    rowsHost.style.transform = `translate3d(0,${placed.offsetY}px,0)`;

    focusedNode?.classList.remove("focused");
    focusedNode = null;
    if (sidebarIndex >= 0) {
      focusedNode = sidebarItems()[sidebarIndex] || null;
    } else {
      const row = rows[focus.row];
      const view = row && views.get(row.key);
      focusedNode =
        view?.slots.find(
          (node) => node?.dataset.index === String(focusIndex) && node.style.visibility !== "hidden"
        ) || null;
    }
    focusedNode?.classList.add("focused");
    root.classList.toggle("tv2-sidebar-open", sidebarIndex >= 0);
    const sidebar = container.querySelector(".home-sidebar");
    sidebar?.classList.toggle("expanded", sidebarIndex >= 0);
    // Labels show only with content-expanded, as the current Home's setLegacySidebarExpanded.
    sidebar?.classList.toggle("content-expanded", sidebarIndex >= 0);
  }

  function setHero(item) {
    heroTitle.textContent = item?.name || item?.title || "";
    heroDescription.textContent = item?.description || "";
    imageQueue.request(heroBackdrop, heroImageUrl(item));
  }

  function setProfile(profile) {
    const sidebar = container.querySelector(".home-sidebar");
    if (!sidebar) return;
    sidebar.outerHTML = renderLegacySidebar({ selectedRoute: "home", layout, profile });
  }

  function sidebarItems() {
    return Array.from(container.querySelectorAll(".home-sidebar .focusable"));
  }

  /** Watched title ids (homeModel onWatched): visible cards refill at the next update. */
  function setWatched(ids) {
    watchedIds = ids;
    watchedVersion += 1;
  }

  return {
    setRows,
    update,
    setWatched,
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
