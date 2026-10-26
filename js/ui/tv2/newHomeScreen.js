import { Router } from "../navigation/routerState.js";
import { ScreenUtils } from "../navigation/screen.js";
import { allowDpadRepeat } from "../navigation/dpadRepeatThrottle.js";
import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";
import { Platform } from "../../platform/index.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import {
  activateLegacySidebarAction,
  getSidebarProfileState
} from "../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { loadHomeRows, loadNextCatalogPage } from "./homeModel.js";
import { cardGeometry, rowCardSize, RAIL_VIEWPORT } from "./railEngine.js";
import { createFocus, focusedIndex, moveFocus, focusSnapshot, restoreFocus } from "./focusModel.js";
import { createImageQueue } from "./imagePipeline.js";
import { createDomHomeRenderer } from "./renderer.js";
import { createLightningHomeRenderer } from "./render/lightning/lightningHomeRenderer.js";
import { sessionNewHomeMode, homeEngine, noteHomeEngine } from "./newHomeSetting.js";

// New TV Home (nuv-091). Enabled by the "Nouvel accueil (bêta)" setting: DOM renderer, or the
// full WebGL prototype (lot B2), which falls back to DOM when WebGL fails.

const DIRECTIONS = { 37: "left", 38: "up", 39: "right", 40: "down" };
const HERO_CALM_MS = 450;
// Current Home modern pagination: next page once the projected last visible card is within 4
// cards of the end (trackPaginationLoadAheadItems).
const PAGE_AHEAD_ITEMS = 4;
const PAGE_BUSY_RETRY_MS = 50;

export const NewHomeScreen = {
  async mount(params = {}, navigation = {}) {
    this.token = (this.token || 0) + 1;
    const token = this.token;
    this.container = document.getElementById("home");
    ScreenUtils.show(this.container);
    const layout = LayoutPreferences.get();
    this.imageQueue = createImageQueue({ isBusy: () => isVidaaNavigationBusy() });
    this.viewOptions = { geometry: cardGeometry(layout), imageQueue: this.imageQueue, layout };
    this.profile = null;
    this.watchedTitleIds = null;
    this.view = this.createView(token);
    this.rows = [];
    this.focus = createFocus();
    this.sidebarIndex = -1;
    this.pagesInFlight = new Set();
    this.pendingSnapshot =
      (navigation.isBackNavigation && navigation.restoredState) || this.lastSnapshot || null;
    void getSidebarProfileState({ cacheOnly: true })
      .then((profile) => {
        if (token !== this.token) return;
        this.profile = profile;
        this.view?.setProfile(profile);
      })
      .catch(() => {});
    void loadHomeRows({
      isCurrent: () => token === this.token,
      onRows: (rows) => this.applyRows(rows),
      onWatched: (ids) => this.applyWatched(ids)
    });
  },

  /** Renderer of the chosen mode when WebGL works, else the DOM one; the engine goes to Diagnostic. */
  createView(token) {
    const mode = sessionNewHomeMode();
    const fallBack = (why) => token === this.token && this.fallBackToDom(why);
    if (mode === "webgl" && homeEngine() === "webgl") {
      noteHomeEngine("webgl");
      return createLightningHomeRenderer(this.container, {
        ...this.viewOptions,
        onFailure: fallBack
      });
    }
    noteHomeEngine("dom");
    return this.domView();
  },

  domView() {
    return createDomHomeRenderer(this.container, this.viewOptions);
  },

  /** WebGL failed under a mounted Home: same rows, focus and hero, drawn by the DOM renderer. */
  fallBackToDom(reason) {
    noteHomeEngine(`dom:${reason}`);
    this.imageQueue?.clear();
    this.view?.destroy();
    this.view = this.domView();
    if (this.profile) this.view.setProfile(this.profile);
    if (this.watchedTitleIds) this.view.setWatched(this.watchedTitleIds);
    this.view.setRows(this.rows);
    this.render();
    this.view.setHero(this.currentItem());
  },

  applyRows(rows) {
    // Catalog rows arrive out of order: keep focus on the same row key, not the same index.
    const focusedKey = this.rows?.[this.focus.row]?.key;
    const keptRow = rows.findIndex((row) => row.key === focusedKey);
    if (keptRow >= 0) this.focus = { ...this.focus, row: keptRow };
    this.rows = rows;
    if (
      this.pendingSnapshot &&
      rows.some((row) => row.key === this.pendingSnapshot.rowKey && row.items.length)
    ) {
      this.focus = restoreFocus(this.pendingSnapshot, rows);
      this.pendingSnapshot = null;
    }
    if (!rows[this.focus.row]?.items.length) {
      const firstFilled = rows.findIndex((row) => row.items.length);
      if (firstFilled >= 0 && !this.pendingSnapshot)
        this.focus = { ...this.focus, row: firstFilled };
    }
    this.view.setRows(rows);
    this.render();
    this.scheduleHero();
  },

  /** Watched badges: DOM only, the WebGL renderer has no setWatched. */
  applyWatched(ids) {
    this.watchedTitleIds = ids;
    this.view?.setWatched?.(ids);
    this.render();
  },

  render() {
    this.view?.update(this.rows, this.focus, { sidebarIndex: this.sidebarIndex });
  },

  /** Focused card or sidebar item, read by the benchmark driver. */
  getCurrentFocusedNode() {
    return this.view?.focusedNode() || null;
  },

  currentItem() {
    const row = this.rows[this.focus.row];
    return row?.items[focusedIndex(this.focus, this.rows)] || null;
  },

  scheduleHero() {
    clearTimeout(this.heroTimer);
    // One hero write after the user stops, like the current Home on VIDAA.
    this.heroTimer = setTimeout(() => this.view?.setHero(this.currentItem()), HERO_CALM_MS);
  },

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (Platform.isBackEvent(event)) {
      event.preventDefault?.();
      this.consumeBackRequest();
      return;
    }
    const direction = DIRECTIONS[code];
    if (direction) {
      event.preventDefault?.();
      if (!allowDpadRepeat(this, event)) return;
      if (this.sidebarIndex >= 0) this.moveInSidebar(direction);
      else this.moveInRails(direction);
      return;
    }
    if (code === 13) {
      event.preventDefault?.();
      if (this.sidebarIndex >= 0) {
        const action = this.view.sidebarItems()[this.sidebarIndex]?.dataset.action;
        activateLegacySidebarAction(action, "home");
      } else {
        this.openDetail();
      }
    }
  },

  moveInRails(direction) {
    const next = moveFocus(this.focus, this.rows, direction);
    if (next === null) {
      this.sidebarIndex = 0;
    } else {
      this.focus = next;
      this.scheduleHero();
    }
    this.render();
    if (direction === "right") this.requestNextPage();
  },

  /**
   * Modern pagination (current Home methods-29) from focus alone, never a DOM measure: near the
   * end of a catalog row, its next page once; appended in place, focus keeps its column. Waits
   * while VIDAA navigation is busy. A page of duplicates waits for the next move right.
   */
  requestNextPage() {
    clearTimeout(this.pageTimer);
    const row = this.rows[this.focus.row];
    if (row?.kind !== "poster" || !row.entry || !row.hasMore || !row.supportsSkip) return;
    // Visible cards from the rail tables, as the current Home's ceil(track width / stride).
    const { geometry } = this.viewOptions;
    const visible = Math.ceil(RAIL_VIEWPORT / (rowCardSize(row, geometry).width + geometry.gap));
    const lastVisible = focusedIndex(this.focus, this.rows) + visible - 1;
    if (lastVisible < row.items.length - PAGE_AHEAD_ITEMS) return;
    const inFlight = this.pagesInFlight;
    if (inFlight.has(row.key)) return;
    if (isVidaaNavigationBusy()) {
      this.pageTimer = setTimeout(() => this.requestNextPage(), PAGE_BUSY_RETRY_MS);
      return;
    }
    const token = this.token;
    inFlight.add(row.key);
    loadNextCatalogPage(row.entry, { isCurrent: () => token === this.token })
      .then((page) => {
        if (!page) return;
        const { added, ...state } = page;
        const live = this.rows.find((candidate) => candidate.key === row.key);
        if (!live) return;
        Object.assign(live, state);
        if (added) this.render();
      })
      .catch((error) => console.warn("New Home pagination failed for", row.key, error))
      .finally(() => inFlight.delete(row.key));
  },

  moveInSidebar(direction) {
    const count = this.view.sidebarItems().length;
    if (direction === "right") this.sidebarIndex = -1;
    else if (direction === "up") this.sidebarIndex = Math.max(0, this.sidebarIndex - 1);
    else if (direction === "down") this.sidebarIndex = Math.min(count - 1, this.sidebarIndex + 1);
    this.render();
  },

  openDetail() {
    const node = this.view?.focusedNode();
    const item = this.currentItem();
    if (!node || !item?.id) return;
    this.lastSnapshot = focusSnapshot(this.focus, this.rows);
    if (item.type === "collection_folder") {
      Router.navigate("folderDetail", {
        collectionId: item.collectionId,
        folderId: item.folderId,
        collectionTitle: item.collectionTitle || ""
      });
      return;
    }
    const data = node.dataset;
    Router.navigate("detail", {
      itemId: data.itemId,
      itemType: data.itemType || "movie",
      fallbackTitle: data.itemTitle || "Untitled",
      fallbackPoster: data.posterSrc || "",
      fallbackBackground: data.backdropSrc || "",
      addonBaseUrl: data.addonBaseUrl || "",
      addonId: data.addonId || "",
      addonName: data.addonName || "",
      catalogType: data.catalogType || data.itemType || "movie"
    });
  },

  consumeBackRequest() {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) return true;
    if (this.sidebarIndex >= 0) {
      Platform.exitApp();
      return true;
    }
    this.sidebarIndex = 0;
    this.render();
    return true;
  },

  captureRouteState() {
    return focusSnapshot(this.focus, this.rows);
  },

  cleanup() {
    this.lastSnapshot = focusSnapshot(this.focus, this.rows) || this.lastSnapshot;
    this.token = (this.token || 0) + 1;
    clearTimeout(this.heroTimer);
    clearTimeout(this.pageTimer);
    this.imageQueue?.clear();
    this.view?.destroy();
    this.view = null;
    ScreenUtils.hide(this.container);
  }
};
