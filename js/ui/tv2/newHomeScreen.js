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
import { loadHomeRows } from "./homeModel.js";
import { cardGeometry } from "./railEngine.js";
import { createFocus, focusedIndex, moveFocus, focusSnapshot, restoreFocus } from "./focusModel.js";
import { createImageQueue } from "./imagePipeline.js";
import { createDomHomeRenderer } from "./renderer.js";
import { createLightningHomeRenderer } from "./render/lightning/lightningHomeRenderer.js";
import { sessionNewHomeMode, homeEngine, noteHomeEngine } from "./newHomeSetting.js";

// New TV Home (nuv-091). Enabled by the "Nouvel accueil (bêta)" setting: DOM renderer, or the
// full WebGL prototype (lot B2), which falls back to DOM when WebGL fails.

const DIRECTIONS = { 37: "left", 38: "up", 39: "right", 40: "down" };
const HERO_CALM_MS = 450;

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
    this.view = this.createView(token);
    this.rows = [];
    this.focus = createFocus();
    this.sidebarIndex = -1;
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
      onRows: (rows) => this.applyRows(rows)
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
    this.view.setRows(this.rows);
    this.render();
    this.view.setHero(this.currentItem());
  },

  applyRows(rows) {
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

  render() {
    this.view?.update(this.rows, this.focus, { sidebarIndex: this.sidebarIndex });
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
    this.imageQueue?.clear();
    this.view?.destroy();
    this.view = null;
    ScreenUtils.hide(this.container);
  }
};
