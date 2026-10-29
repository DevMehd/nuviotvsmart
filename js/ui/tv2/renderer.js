import { Platform } from "../../platform/index.js";
import { getTvHeroTransitionMode } from "../../platform/tvRuntimePerformance.js";
import {
  getRootSidebarNodes,
  renderRootSidebar,
  setModernSidebarPillIconOnly
} from "../components/sidebarNavigationHelpers-03-render-root-sidebar.js";
import { posterCardModel } from "../screens/home/homeScreenHelpers-15-create-poster-card-markup.js";
import {
  buildHeroIndicators,
  buildPosterSubtitle,
  continueCardModel,
  resolveContinueWatchingBlurNextUp
} from "../screens/home/homeScreenHelpers-12-build-hero-indicators.js";
import { firstNonEmpty } from "../screens/home/homeUtils.js";
import {
  HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS,
  HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS
} from "../screens/home/homeConstants.js";
import {
  buildHeroDisplayModel,
  buildModernHeroPresentation,
  renderMetaTokens,
  renderModernHeroPrimary,
  renderModernHeroSecondary
} from "../screens/home/homeScreenHelpers-11-build-hero-display-model.js";
import { animateHeroBackdropSwap } from "../screens/home/homeScreenHelpers-03-animate-hero-backdrop-swap.js";
import { animateHeroLogoSwap } from "../screens/home/homeScreenHelpers-04-animate-hero-logo-swap.js";
import { buildHeroIdentity } from "../screens/home/homeScreenHelpers-10-get-cached-continue-watching-enrichment.js";
import {
  buildImageFallbackErrorHandler,
  encodeHeroBackdropFallbacks
} from "../screens/home/homeImageHelpers.js";
import { setHomeHtmlIfChanged } from "../screens/home/homeStableMarkup.js";
import {
  mountTrailerMedia,
  pauseTrailerMedia,
  releaseTrailerMedia
} from "../screens/home/homeTrailerLayer.js";
import { getVidaaArtworkOriginal } from "../screens/home/vidaaArtworkOptimization.js";
import { useVidaaHeroTransition } from "../screens/home/vidaaHeroTransition.js";
import { isTitleItemWatched, renderTitleWatchedBadge } from "../components/watchedTitleBadge.js";
import { I18n } from "../../i18n/index.js";
import { t } from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import {
  gridStickyTitle,
  slotFor,
  homeLayout,
  rowCardSize,
  rowHeight,
  rowLabelHeight
} from "./railEngine.js";
import { focusedIndex } from "./focusModel.js";
import { sizedImageUrl } from "./imagePipeline.js";

// Renderers of the new TV Home (nuv-091) share one interface:
//   setRows(rows), update(rows, focus, { sidebarIndex, hideFocus }), setHero(item, { loading, candidates }),
//   setProfile(state),
//   sidebarItems(), destroy(); optionally setWatched(ids), playHeroTrailer(source),
//   stopHeroTrailer({ deferred }), setFocusGif(url), setSidebarPill(iconOnly) and suspend() (DOM only
//   for now: Lightning has none of them and keeps the legacy sidebar).
// This is the DOM one, the universal fallback and the only one drawing classic and grid (D9);
// render/lightning/ draws the modern Home in WebGL.

/**
 * Card image at its displayed size with the current Home's source order (posterCardModel for
 * catalog cards, cover for folders) and fallbacks: the custom poster's original, then the
 * unoptimized nuvio-art source. `model` is the catalog card model and `cw` the Continue Watching
 * one (continueCardModel, its own source order and fallbacks), both used by the DOM card.
 * The WebGL layer passes glImageUrl as `urlFor`.
 */
export function cardImage(row, item, size, settings, urlFor = sizedImageUrl) {
  if (row.kind === "continue") {
    const cw = continueCardModel(item, {
      cardStyle: settings?.continueWatchingCardStyle || "card",
      useEpisodeThumbnails: settings?.useEpisodeThumbnailsInCw !== false,
      blurNextUp: resolveContinueWatchingBlurNextUp(settings)
    });
    const url = urlFor(cw.image, size.width);
    // Current Home order: custom poster original, nuvio-art original (unsized, sizing would
    // re-optimize it), then data-fallback-srcs.
    const fallbacks = [
      urlFor(cw.rawImage, size.width),
      getVidaaArtworkOriginal(url),
      ...cw.fallbacks.map((source) => urlFor(source, size.width))
    ].filter(Boolean);
    return { url, fallbacks: [...new Set(fallbacks)].filter((value) => value !== url), cw };
  }
  if (row.kind === "collection")
    return {
      url: urlFor(firstNonEmpty(item.poster, item.coverImageUrl, item.backdrop), size.width),
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
  const url = urlFor(model.posterSrc, size.width);
  const raw = landscape ? model.normalized.rawLandscapePosterUrl : model.normalized.rawPosterUrl;
  const fallbacks = [...new Set([raw && urlFor(raw, size.width), getVidaaArtworkOriginal(url)])];
  return { url, fallbacks: fallbacks.filter((value) => value && value !== url), model };
}

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

/**
 * Current Home modern hero (renderModernHeroMarkup) inside its own .home-screen-shell, so the
 * current hero CSS applies to this subtree only, never to the tv2 rails. Filled by setHero.
 */
const HERO_MARKUP = `
  <div class="home-screen-shell home-layout-modern tv2-hero-shell">
    <section class="home-hero home-hero-modern">
      <article class="home-hero-card home-modern-hero-card">
        <div class="home-modern-hero-media">
          <div class="home-hero-backdrop-wrap">
            <div class="home-hero-backdrop-loading"></div>
            <img class="home-hero-backdrop placeholder" alt="" decoding="async" fetchpriority="high" onerror="${buildImageFallbackErrorHandler()}" />
          </div>
          <div class="home-hero-trailer-layer"></div>
        </div>
        <div class="home-hero-copy home-modern-hero-copy">
          <div class="home-hero-brand"><h1 class="home-hero-title-text"></h1></div>
          <div class="home-modern-hero-meta-line is-empty"></div>
          <div class="home-modern-hero-secondary is-empty"></div>
          <p class="home-hero-description is-empty"></p>
        </div>
      </article>
    </section>
  </div>`;

/**
 * Current Home classic/grid hero (renderHeroMarkup): a focusable card, first row of the layout,
 * scrolled with the rows. Filled by setHero.
 */
const legacyHeroMarkup = (mode) => `
  <section class="home-hero home-hero-${mode}">
    <article class="home-hero-card focusable" data-action="openDetail">
      <div class="home-hero-backdrop-wrap">
        <img class="home-hero-backdrop placeholder" alt="" decoding="async" fetchpriority="high" onerror="${buildImageFallbackErrorHandler()}" />
      </div>
      <div class="home-hero-copy">
        <div class="home-hero-brand"><h1 class="home-hero-title-text"></h1></div>
        <div class="home-hero-meta-primary is-empty"></div>
        <div class="home-hero-chip-row is-empty"></div>
        <div class="home-hero-meta-secondary is-empty"></div>
        <div class="home-hero-mdb-ratings is-empty"></div>
        <p class="home-hero-description"></p>
      </div>
      <div class="home-hero-indicators"></div>
    </article>
  </section>`;

/** Row index as the driver counts it: empty rows are not navigable, so they are skipped. */
export const navRowOf = (rows, rowIndex) =>
  rows.slice(0, rowIndex).filter((row) => row.items.length).length;

/** Navigation position read by the benchmark driver; rewritten on every draw, outside the memo. */
export function setNavPosition(node, navRow, col) {
  node.dataset.navRow = String(navRow);
  node.dataset.navCol = String(col);
}

export function createDomHomeRenderer(container, { geometry, imageQueue, layout = {} }) {
  const mode = geometry.layoutMode || "modern";
  const legacy = mode !== "modern";
  container.innerHTML = `
    <div class="tv2-home tv2-layout-${mode}">
      ${renderRootSidebar({ selectedRoute: "home", layout })}
      ${legacy ? "" : HERO_MARKUP}
      <div class="home-main tv2-main">${mode === "grid" ? '<div class="tv2-grid-sticky"></div>' : ""}<div class="tv2-rows"></div></div>
    </div>`;
  const root = container.querySelector(".tv2-home");
  const rowsHost = container.querySelector(".tv2-rows");
  const gridSticky = mode === "grid" ? container.querySelector(".tv2-grid-sticky") : null;
  // Classic/grid: the hero is the "__hero__" row's section, inside the rows.
  const legacyHero = legacy ? document.createElement("div") : null;
  if (legacyHero) {
    legacyHero.className = `home-screen-shell home-layout-${mode} tv2-hero-shell tv2-hero-legacy`;
    legacyHero.innerHTML = legacyHeroMarkup(mode);
  }
  const heroNode = (selector) =>
    legacyHero
      ? legacyHero.querySelector(selector)
      : container.querySelector(`.tv2-hero-shell ${selector}`);
  const hero = {
    media: legacy ? null : heroNode(".home-modern-hero-media"),
    card: legacy ? heroNode(".home-hero-card") : null,
    backdrop: heroNode(".home-hero-backdrop"),
    brand: heroNode(".home-hero-brand"),
    title: heroNode(".home-hero-title-text"),
    primary: heroNode(legacy ? ".home-hero-meta-primary" : ".home-modern-hero-meta-line"),
    secondary: heroNode(legacy ? ".home-hero-meta-secondary" : ".home-modern-hero-secondary"),
    chips: legacy ? heroNode(".home-hero-chip-row") : null,
    ratings: legacy ? heroNode(".home-hero-mdb-ratings") : null,
    indicators: legacy ? heroNode(".home-hero-indicators") : null,
    description: heroNode(".home-hero-description"),
    trailerLayer: legacy ? null : heroNode(".home-hero-trailer-layer"),
    candidates: [],
    logo: null,
    identity: ""
  };
  const views = new Map();
  // Per pooled card: its child nodes and the image chosen at the last fill.
  const cards = new WeakMap();
  const watchedBadge = renderTitleWatchedBadge();
  let watchedIds = null;
  let watchedVersion = 0;
  // Bumped by every row emit: continue cards refill then, their release labels depend on time.
  let rowsVersion = 0;
  let focusedNode = null;
  let sidebarOpen = false;
  let pillIconOnly = false;
  // Stop of the hero trailer or folder video, and the card showing its focus GIF.
  let stopTrailer = null;
  let gifNode = null;
  // Current Home modernHeroFullScreenBackdropEnabled: its hero CSS (components-16/17) applies.
  if (!legacy && layout.modernHeroFullScreenBackdropEnabled)
    container.querySelector(".tv2-hero-shell").classList.add("home-modern-fullscreen-backdrop");
  // Current Home VIDAA balanced motion (components-60-vidaa.css), same gate as its hero swaps:
  // the focused card scales to 1.015 in 160 ms, never under reduced motion.
  const motion = useVidaaHeroTransition(root);
  root.style.setProperty("--tv2-card-radius", `${geometry.radius ?? 24}px`);
  root.style.setProperty("--tv2-content-start", `${geometry.contentStart ?? 220}px`);

  function setRows(rows) {
    rowsVersion += 1;
    const keys = new Set(rows.map((row) => row.key));
    for (const [key, view] of views) {
      if (!keys.has(key)) {
        view.section.remove();
        views.delete(key);
      }
    }
    // Sections already in order stay put (a kept view re-applies the same rows on return); from
    // the first out-of-order one, the rest are appended in order.
    let moved = false;
    rows.forEach((row, index) => {
      let view = views.get(row.key);
      if (!view && row.kind === "hero") {
        view = { section: legacyHero, slots: [], kind: "hero" };
        views.set(row.key, view);
      }
      if (!view) {
        const section = document.createElement("section");
        section.className = "tv2-row";
        section.innerHTML = `<h2 class="tv2-row-title"></h2><p class="tv2-row-subtitle"></p><p class="tv2-row-status"></p><div class="tv2-track"></div>`;
        view = {
          section,
          track: section.querySelector(".tv2-track"),
          slots: [],
          kind: row.kind,
          size: rowCardSize(row, geometry),
          labelHeight: rowLabelHeight(row, geometry),
          // Classic/grid catalogs end with their See All card.
          seeAll: legacy && Boolean(row.entry) && row.kind === "poster"
        };
        views.set(row.key, view);
      }
      if (moved || rowsHost.children[index] !== view.section) {
        rowsHost.appendChild(view.section);
        moved = true;
      }
      view.section.style.height = `${rowHeight(row, geometry)}px`;
      if (row.kind === "hero") return;
      view.section.querySelector(".tv2-row-title").textContent = row.title || "";
      view.section.querySelector(".tv2-row-subtitle").textContent = row.subtitle || "";
      // A loading row shows skeleton cards, or the loading text without a count (D1: no error text).
      const skeletons = row.items.length || row.status !== "loading" ? 0 : row.loadingCount || 0;
      setSkeletons(view, skeletons);
      view.section.querySelector(".tv2-row-status").textContent =
        row.items.length || skeletons || row.status !== "loading"
          ? ""
          : t("common.loading", {}, "Loading");
    });
  }

  /** Current Home loading cards: plain boxes, never focusable, no image or dataset. */
  function setSkeletons(view, count) {
    view.skeletons ||= [];
    if (view.skeletons.length === count) return;
    view.skeletons.forEach((node) => node.remove());
    const { width, height } = view.size;
    view.skeletons = Array.from({ length: count }, (_, index) => {
      const node = document.createElement("div");
      node.className = "tv2-card tv2-card-skeleton";
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      node.style.transform = `translate3d(${index * (width + geometry.gap)}px,0,0)`;
      return view.track.appendChild(node);
    });
  }

  function slotNode(view, slot) {
    let node = view.slots[slot];
    if (!node) {
      node = document.createElement("article");
      // Not .home-continue-card: constrained runtimes force its focused transform to none (tv2-home.css).
      node.className = `${view.kind === "continue" ? "tv2-continue-card" : "home-poster-card"} tv2-card focusable`;
      node.dataset.action = "openDetail";
      const title = `<div class="tv2-card-title" dir="auto"></div>`;
      const seeAll = view.seeAll
        ? `<div class="home-seeall-card-inner tv2-seeall"><span class="home-seeall-arrow${I18n.isRtl() ? " is-rtl" : ""}">→</span>
          <span class="home-seeall-label">${esc(t("action_see_all", {}, "See All"))}</span></div>`
        : "";
      const label = view.labelHeight
        ? `<div class="tv2-card-label"><div class="tv2-card-label-title" dir="auto"></div><div class="tv2-card-label-subtitle"></div></div>`
        : "";
      node.innerHTML = `<img class="tv2-card-image" alt="" decoding="async" />${watchedBadge}${seeAll}${label}
        <div class="tv2-card-overlay"><img class="tv2-card-logo" alt="" decoding="async" />
          <div class="tv2-card-overlay-title"></div><div class="tv2-card-overlay-subtitle"></div></div>
        ${view.kind === "collection" ? `<img class="tv2-card-gif" alt="" decoding="async" />` : ""}
        ${view.kind === "collection" && mode === "grid" ? `<div class="tv2-card-folder-title" dir="auto"></div>` : ""}
        ${
          view.kind === "continue"
            ? `<span class="tv2-cw-badge"></span><div class="tv2-cw-copy"><div class="tv2-cw-kicker"></div>
          ${title}<div class="tv2-cw-subtitle"></div></div><div class="tv2-cw-progress"><span></span></div>`
            : title
        }`;
      const { width, height } = view.size;
      node.style.width = `${width}px`;
      node.style.height = `${height + view.labelHeight}px`;
      if (view.labelHeight) {
        // Classic/grid: the artwork frame, then the title block under it (fixed height).
        node.classList.add("has-label");
        node.style.setProperty("--tv2-frame-height", `${height}px`);
      }
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
        gif: node.querySelector(".tv2-card-gif"),
        labelTitle: view.labelHeight ? node.querySelector(".tv2-card-label-title") : null,
        labelSubtitle: view.labelHeight ? node.querySelector(".tv2-card-label-subtitle") : null,
        folderTitle:
          view.kind === "collection" && mode === "grid"
            ? node.querySelector(".tv2-card-folder-title")
            : null,
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
    const seeAll = Boolean(item.seeAll);
    node.classList.toggle("is-seeall", seeAll);
    node.dataset.action = seeAll ? "openCatalogSeeAll" : "openDetail";
    // Folder title (current Home collectionDisplayTitle): under the card in classic, over it in grid.
    const folderTitle =
      row.kind === "collection" && !item.hideTitle
        ? item.name || item.heroTitle || item.collectionTitle || "Collection"
        : "";
    if (card.folderTitle) card.folderTitle.textContent = folderTitle;
    if (card.labelTitle) {
      card.labelTitle.textContent = seeAll
        ? ""
        : row.kind === "collection"
          ? folderTitle
          : item.name || item.title || "";
      card.labelSubtitle.textContent =
        seeAll || mode !== "classic" || item.hideTitle ? "" : buildPosterSubtitle(item, mode);
    }
    if (seeAll) {
      node.classList.remove("is-watched", "is-landscape", "tv2-card-emoji");
      card.title.textContent = "";
      card.source = { url: "", fallbacks: [], logo: "" };
      return;
    }
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

  /**
   * Card position and focus scale. Only a card staying in place tweens its scale (Web Animations,
   * transform only): a placed or recycled card jumps instead of sliding across the rail.
   */
  function placeCard(node, x, scaled) {
    const card = cards.get(node);
    if (card.x === x && card.scaled === scaled) return;
    const transform = `translate3d(${x}px,0,0)${scaled ? " scale(1.015)" : ""}`;
    card.tween?.cancel();
    card.tween =
      card.x === x
        ? node.animate([{ transform: node.style.transform }, { transform }], {
            duration: 160,
            easing: "cubic-bezier(0.2, 0, 0, 1)"
          })
        : null;
    card.x = x;
    card.scaled = scaled;
    node.style.transform = transform;
  }

  function update(rows, focus, { sidebarIndex = -1, hideFocus = false } = {}) {
    const placed = homeLayout(rows, focus, geometry);
    const focusIndex = focusedIndex(focus, rows);
    const focusShown = sidebarIndex < 0 && !hideFocus;
    const logos = [];
    placed.rows.forEach(({ row, pitch, win }, rowIndex) => {
      const view = views.get(row.key);
      if (!view) return;
      if (row.kind === "hero") {
        setNavPosition(hero.card, navRowOf(rows, rowIndex), 0);
        return;
      }
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
        placeCard(
          node,
          i * pitch,
          motion && focusShown && rowIndex === focus.row && i === focusIndex
        );
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
    if (gridSticky) {
      // The last title stays while the header fades out.
      const stickyTitle = gridStickyTitle(placed);
      if (stickyTitle && gridSticky.textContent !== stickyTitle)
        gridSticky.textContent = stickyTitle;
      gridSticky.classList.toggle("is-visible", Boolean(stickyTitle));
    }

    focusedNode?.classList.remove("focused");
    focusedNode = null;
    if (sidebarIndex >= 0) {
      focusedNode = sidebarItems()[sidebarIndex] || null;
    } else {
      const row = rows[focus.row];
      const view = row && views.get(row.key);
      focusedNode =
        row?.kind === "hero"
          ? hero.card
          : view?.slots.find(
              (node) =>
                node?.dataset.index === String(focusIndex) && node.style.visibility !== "hidden"
            ) || null;
    }
    // A hold menu is open (current Home lockHomeHoldFocus): no focused card.
    if (hideFocus) focusedNode = null;
    focusedNode?.classList.add("focused");
    root.classList.toggle("tv2-sidebar-open", sidebarIndex >= 0);
    sidebarOpen = sidebarIndex >= 0;
    if (layout.modernSidebar) {
      // Class writes of the current Home's setModernSidebarExpanded fast path, never measured.
      const shell = container.querySelector(".modern-sidebar-shell");
      shell?.classList.toggle("expanded", sidebarOpen);
      shell?.classList.toggle("panel-visible", sidebarOpen);
      container
        .querySelector(".modern-sidebar-panel")
        ?.setAttribute("aria-hidden", sidebarOpen ? "false" : "true");
      return;
    }
    const sidebar = container.querySelector(".home-sidebar");
    sidebar?.classList.toggle("expanded", sidebarOpen);
    // Labels show only with content-expanded, as the current Home's setLegacySidebarExpanded.
    sidebar?.classList.toggle("content-expanded", sidebarOpen);
  }

  /**
   * Current Home applyHeroToDom for the modern hero, on cached nodes: backdrop crossfade with its
   * fallbacks, logo once loaded (title until then or on failure), meta lines and description.
   * The hero image stays out of the card image queue. `loading` shows the skeleton (no item yet).
   */
  function setHero(item, { loading = false, candidates } = {}) {
    hero.media?.classList.toggle("home-modern-hero-media-loading", !item && loading);
    if (candidates) hero.candidates = candidates;
    const display = !item
      ? null
      : legacy
        ? buildHeroDisplayModel(item, mode)
        : buildModernHeroPresentation(item);
    if (!display) return;
    const identity = buildHeroIdentity(item);
    hero.identity = identity;
    const crossfadeMs = Platform.isVidaa()
      ? 200
      : legacy
        ? HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS
        : HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS;
    const transitionMode = getTvHeroTransitionMode();
    hero.backdrop.dataset.fallbackSrcs = encodeHeroBackdropFallbacks(
      display.backdropFallbacks || []
    );
    animateHeroBackdropSwap(
      hero.backdrop,
      display.backdrop || "",
      display.title || "featured",
      crossfadeMs,
      { transitionMode }
    );
    hero.title.textContent = display.title || "";
    hero.title.classList.remove("is-hidden");
    if (display.logo) {
      // animateHeroLogoSwap removes a logo that failed or was cleared: a new one is made then.
      if (!hero.logo || hero.logo.parentNode !== hero.brand) {
        hero.logo = document.createElement("img");
        hero.logo.className = "home-hero-logo";
        hero.logo.setAttribute("decoding", "async");
        hero.logo.setAttribute("fetchpriority", "high");
        hero.brand.insertBefore(hero.logo, hero.brand.firstChild);
      }
      const isCurrent = () => hero.identity === identity;
      animateHeroLogoSwap(hero.logo, display.logo, display.title || "logo", crossfadeMs, {
        transitionMode,
        isCurrent,
        onReady: (ready) => isCurrent() && hero.title.classList.toggle("is-hidden", ready)
      });
    } else if (hero.logo) animateHeroLogoSwap(hero.logo, "");
    hero.description.textContent = display.description || " ";
    hero.description.classList.toggle("is-empty", !display.description);
    if (legacy) {
      setLegacyHeroCopy(item, display);
      return;
    }
    setHomeHtmlIfChanged(hero.primary, renderModernHeroPrimary(display));
    hero.primary.classList.toggle(
      "is-empty",
      !display.leadingMeta.length && !display.trailingMeta.length && !display.showImdbPrimary
    );
    setHomeHtmlIfChanged(hero.secondary, renderModernHeroSecondary(display));
    hero.secondary.classList.toggle(
      "is-empty",
      !display.secondaryHighlightText &&
        !display.badges.length &&
        !display.showImdbSecondary &&
        !display.languageText &&
        !display.mdbListMarkup
    );
  }

  /** Current Home applyHeroToDom for classic/grid: IMDb and year, genre chips, ratings, dots. */
  function setLegacyHeroCopy(item, display) {
    hero.card.dataset.itemId = String(item.id || "");
    hero.card.dataset.itemType = String(item.type || "movie");
    hero.card.dataset.itemTitle = String(item.name || "Untitled");
    setHomeHtmlIfChanged(hero.primary, renderMetaTokens(display.metaPrimary));
    hero.primary.classList.toggle("is-empty", !display.metaPrimary.length);
    setHomeHtmlIfChanged(hero.secondary, renderMetaTokens(display.metaSecondary));
    hero.secondary.classList.toggle("is-empty", !display.metaSecondary.length);
    setHomeHtmlIfChanged(
      hero.chips,
      display.chips.map((chip) => `<span class="home-hero-chip">${esc(chip)}</span>`).join("")
    );
    hero.chips.classList.toggle("is-empty", !display.chips.length);
    setHomeHtmlIfChanged(hero.ratings, display.mdbListMarkup || "");
    hero.ratings.classList.toggle("is-empty", !display.mdbListMarkup);
    setHomeHtmlIfChanged(hero.indicators, buildHeroIndicators(hero.candidates, item));
  }

  /** Current Home hero_media trailer (or folder hero video): the backdrop fades out once it shows. */
  function playHeroTrailer(source) {
    stopHeroTrailer();
    // A deferred stop's paused media leaves at once, as the current Home's mount does.
    releaseTrailerMedia(hero.trailerLayer);
    stopTrailer = mountTrailerMedia(
      hero.trailerLayer,
      source,
      () => {
        hero.media.classList.add("trailer-active");
        // Fullscreen backdrop: the rails fade while the trailer shows (components-17.css).
        root.classList.add("tv2-hero-trailer-active");
      },
      () => stopHeroTrailer()
    );
  }

  /** `deferred`: paused now, unloaded once idle (constrained TVs, as the current Home). */
  function stopHeroTrailer({ deferred = false } = {}) {
    hero.media?.classList.remove("trailer-active");
    root.classList.remove("tv2-hero-trailer-active");
    stopTrailer?.({ deferred });
    stopTrailer = null;
  }

  /** Current Home collection focus GIF over the focused folder card, through the image queue; "" clears it. */
  function setFocusGif(url = "") {
    if (gifNode) {
      gifNode.classList.remove("is-focus-gif-active");
      imageQueue.request(cards.get(gifNode).gif, "");
      gifNode = null;
    }
    const gif = url && focusedNode && cards.get(focusedNode)?.gif;
    if (!gif) return;
    gifNode = focusedNode;
    gifNode.classList.add("is-focus-gif-active");
    imageQueue.request(gif, url, { priority: true });
  }

  function setProfile(profile) {
    const sidebar = container.querySelector(
      layout.modernSidebar ? ".modern-sidebar-shell" : ".home-sidebar"
    );
    if (!sidebar) return;
    sidebar.outerHTML = renderRootSidebar({
      selectedRoute: "home",
      layout,
      profile,
      expanded: sidebarOpen,
      pillIconOnly
    });
  }

  /** Modern sidebar pill (modernSidebar): icon only or with its label. */
  function setSidebarPill(iconOnly) {
    pillIconOnly = Boolean(iconOnly);
    setModernSidebarPillIconOnly(container, pillIconOnly);
  }

  /** Legacy items, or the modern panel's (the pill itself is not a stop). */
  function sidebarItems() {
    return getRootSidebarNodes(container, layout);
  }

  /** Watched title ids (homeModel onWatched): visible cards refill at the next update. */
  function setWatched(ids) {
    // The same set again (route return, refresh): visible cards keep their fill.
    if (
      ids &&
      watchedIds &&
      ids.size === watchedIds.size &&
      [...ids].every((id) => watchedIds.has(id))
    )
      return;
    watchedIds = ids;
    watchedVersion += 1;
  }

  /** Home hidden with its view kept: trailer media unloaded now (no audio), focus GIF cleared. */
  function suspend() {
    stopHeroTrailer();
    if (hero.trailerLayer) {
      pauseTrailerMedia(hero.trailerLayer);
      releaseTrailerMedia(hero.trailerLayer);
    }
    setFocusGif("");
  }

  return {
    setRows,
    update,
    setWatched,
    setHero,
    playHeroTrailer,
    stopHeroTrailer,
    setFocusGif,
    setProfile,
    setSidebarPill,
    sidebarItems,
    focusedNode: () => focusedNode,
    suspend,
    destroy() {
      suspend();
      views.clear();
      focusedNode = null;
    }
  };
}
