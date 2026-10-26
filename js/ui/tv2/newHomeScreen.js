import { Router } from "../navigation/routerState.js";
import { ScreenUtils } from "../navigation/screen.js";
import { allowDpadRepeat } from "../navigation/dpadRepeatThrottle.js";
import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";
import { Platform } from "../../platform/index.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import {
  watchedItemIdentityValues,
  watchedItemsShareIdentity
} from "../../data/repository/watchedIdentity.js";
import { NuvioDialog } from "../components/nuvioDialog.js";
import { PosterOptionsDialogController } from "../components/posterOptionsMenu.js";
import {
  activateLegacySidebarAction,
  getSidebarProfileState
} from "../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js";
import { CW_HOLD_DELAY_MS } from "../screens/home/homeConstants.js";
import { t } from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import {
  isCloudContinueWatchingItem,
  normalizeContinueWatchingItem
} from "../screens/home/homeScreenHelpers-09-normalize-continue-watching-item.js";
import {
  buildHeroIdentity,
  clearContinueWatchingDisplaySnapshot
} from "../screens/home/homeScreenHelpers-10-get-cached-continue-watching-enrichment.js";
import {
  continueWatchingDetailParams,
  continueWatchingDetailsMenuParams,
  continueWatchingMenuOptions,
  removeContinueWatchingProgress
} from "../screens/home/homeScreenHelpers-13-continue-watching-stream-params.js";
import { createHomeScreenMethods08 } from "../screens/home/homeScreenMethods-08-open-hold-menu-for-node.js";
import { createHomeScreenMethods22 } from "../screens/home/homeScreenMethods-22-pick-initial-hero.js";
import { createHomeScreenMethods27 } from "../screens/home/homeScreenMethods-27-enrich-continue-watching.js";
import { normalizeHomeRowItem } from "../screens/home/homeScreenHelpers-05-normalize-collection-folder-item.js";
import { preloadHeroAssets } from "../screens/home/homeScreenHelpers-02-extract-release-date-text.js";
import { MODERN_HOME_CONSTANTS } from "../screens/home/modernHomeLayout.js";
import {
  getVidaaHeroFocusDelay,
  getVidaaHeroPreloadDelay
} from "../screens/home/vidaaHomePreviewPolicy.js";
import { loadHomeRows, loadNextCatalogPage } from "./homeModel.js";
import { cardGeometry, rowCardSize, RAIL_VIEWPORT } from "./railEngine.js";
import {
  createFocus,
  focusedIndex,
  itemIdentity,
  moveFocus,
  focusSnapshot,
  restoreFocus
} from "./focusModel.js";
import { createImageQueue } from "./imagePipeline.js";
import { createDomHomeRenderer } from "./renderer.js";
import { createLightningHomeRenderer } from "./render/lightning/lightningHomeRenderer.js";
import { sessionNewHomeMode, homeEngine, noteHomeEngine } from "./newHomeSetting.js";

// New TV Home (nuv-091). Enabled by the "Nouvel accueil (bêta)" setting: DOM renderer, or the
// full WebGL prototype (lot B2), which falls back to DOM when WebGL fails.

const DIRECTIONS = { 37: "left", 38: "up", 39: "right", 40: "down" };
// Current Home scheduleModernHeroUpdate: busy navigation re-polls the hero every 60 ms.
const HERO_BUSY_POLL_MS = MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs;
// Current Home modern pagination: next page once the projected last visible card is within 4
// cards of the end (trackPaginationLoadAheadItems).
const PAGE_AHEAD_ITEMS = 4;
const PAGE_BUSY_RETRY_MS = 50;
// The current Home's cloud resume uses no screen state.
const { openCloudContinueWatchingFromItem } = createHomeScreenMethods08();
// Hero choice of the current Home, called on plain objects (they read only what is passed).
const { pickInitialHero } = createHomeScreenMethods22();
const { pickHeroItem, collectHeroCandidates } = createHomeScreenMethods27();

/** Hero source of a card, as the current Home's getNodeHeroSource (personal rows have no entry). */
function heroSource(row, item) {
  if (!row || !item) return null;
  if (row.kind === "continue") return normalizeContinueWatchingItem(item);
  return normalizeHomeRowItem(row.entry || { type: item.type }, item);
}

/** Current Home openDetailFromNode params, read from the card's item instead of its dataset. */
const detailParams = (item) => ({
  itemId: String(item.id),
  itemType: String(item.type || item.apiType || "movie"),
  fallbackTitle: String(item.name || item.title || "") || "Untitled",
  fallbackPoster: String(item.poster || ""),
  fallbackBackground: String(item.background || item.backdrop || ""),
  addonBaseUrl: String(item.addonBaseUrl || ""),
  addonId: String(item.addonId || ""),
  addonName: String(item.addonName || ""),
  catalogType: String(item.catalogType || item.type || "movie")
});

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
    this.sidebarOpenedByBack = false;
    this.pagesInFlight = new Set();
    this.removedContinue = [];
    this.interacted = false;
    this.heroItem = null;
    this.heroCandidates = [];
    this.heroLoading = false;
    this.lastHeroNavAt = 0;
    this.pendingSnapshot =
      (navigation.isBackNavigation && navigation.restoredState) || this.lastSnapshot || null;
    this.restoring = Boolean(this.pendingSnapshot);
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
    this.view.setHero(this.heroItem, { loading: this.heroLoading });
  },

  applyRows(nextRows) {
    const rows = this.withoutRemoved(nextRows);
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
    // Current Home late focus (shouldApplyLateContinueWatchingFocus): Continue Watching filled
    // before any key takes focus, except on a return.
    const continueRow = rows.findIndex(
      (row) => row.key === "continue_watching" && row.items.length
    );
    if (continueRow >= 0 && !this.interacted && !this.restoring)
      this.focus = { ...this.focus, row: continueRow };
    this.view.setRows(rows);
    this.render();
    this.applyInitialHero(rows);
    this.scheduleHero();
  },

  /**
   * Current Home initial hero (pickInitialHero): until the first key, a filled Continue Watching
   * row's first title, else the first hero candidate; a skeleton while Continue Watching loads.
   * A return shows the restored card's title.
   */
  applyInitialHero(rows) {
    const layoutPrefs = this.viewOptions.layout;
    const entries = rows.map((row) => row.entry).filter(Boolean);
    this.heroCandidates = collectHeroCandidates.call({ layoutPrefs }, entries);
    if (this.interacted) return;
    const continueRow = rows.find((row) => row.key === "continue_watching");
    if (this.heroItem && !continueRow?.items.length) return;
    let hero = null;
    if (this.restoring) hero = this.pendingSnapshot ? null : this.focusedHeroSource();
    else
      hero = pickInitialHero.call({
        layoutMode: "modern",
        layoutPrefs,
        continueWatchingLoading: continueRow?.status === "loading",
        continueWatchingDisplay: continueRow?.items || [],
        heroCandidates: this.heroCandidates,
        rows: entries,
        pickHeroItem
      });
    if (hero) {
      this.showHero(hero);
      return;
    }
    const loading = continueRow?.status === "loading";
    if (loading === this.heroLoading) return;
    this.heroLoading = loading;
    this.view.setHero(null, { loading });
  },

  /** One hero write per title: the same identity is never written again. */
  showHero(hero) {
    this.heroLoading = false;
    if (!hero || buildHeroIdentity(hero) === buildHeroIdentity(this.heroItem)) return;
    this.heroItem = hero;
    this.view?.setHero(hero);
  },

  focusedHeroSource() {
    return heroSource(this.rows[this.focus.row], this.currentItem());
  },

  /** Removed Continue Watching titles stay out of the running load's later emits. */
  withoutRemoved(rows) {
    if (!this.removedContinue?.length) return rows;
    return rows.flatMap((row) => {
      if (row.kind !== "continue") return [row];
      const items = row.items.filter(
        (item) => !this.removedContinue.some((gone) => watchedItemsShareIdentity(item, gone))
      );
      if (items.length === row.items.length) return [row];
      return items.length ? [{ ...row, items }] : [];
    });
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

  /**
   * Current Home scheduleModernHeroUpdate without DOM: the focused title becomes the hero once
   * the user settles (VIDAA 450 ms, 600 ms after moves under 130 ms apart), its artwork warmed
   * just before; both wait while VIDAA navigation is busy. The current hero is not rescheduled.
   */
  scheduleHero() {
    this.cancelHero();
    const hero = this.focusedHeroSource();
    const identity = buildHeroIdentity(hero);
    if (!hero?.id || identity === buildHeroIdentity(this.heroItem)) return;
    const token = this.heroToken;
    const now = Date.now();
    const previous = Number(this.lastHeroNavAt || 0);
    const rapid = previous > 0 && now - previous < MODERN_HOME_CONSTANTS.heroRapidNavThresholdMs;
    this.lastHeroNavAt = now;
    const vidaa = Platform.isVidaa();
    const delay = vidaa
      ? getVidaaHeroFocusDelay({ rapid })
      : rapid
        ? MODERN_HOME_CONSTANTS.heroRapidSettleMs
        : MODERN_HOME_CONSTANTS.heroFocusDelayMs;
    const preloadDelay = vidaa
      ? getVidaaHeroPreloadDelay(delay, { rapid })
      : Math.max(0, Math.min(120, delay - 80));
    const whenCalm = (timer, run) => {
      if (token !== this.heroToken) return;
      const focused = this.focusedHeroSource();
      if (buildHeroIdentity(focused) !== identity) return;
      if (isVidaaNavigationBusy({ quietMs: HERO_BUSY_POLL_MS })) {
        this[timer] = setTimeout(() => whenCalm(timer, run), HERO_BUSY_POLL_MS);
        return;
      }
      run(focused);
    };
    this.heroPreloadTimer = setTimeout(
      () => whenCalm("heroPreloadTimer", (focused) => void preloadHeroAssets(focused, "modern")),
      preloadDelay
    );
    this.heroTimer = setTimeout(
      () => whenCalm("heroTimer", (focused) => this.showHero(focused)),
      delay
    );
  },

  /** Drops the pending hero (move, sidebar, leaving Home). */
  cancelHero() {
    this.heroToken = (this.heroToken || 0) + 1;
    clearTimeout(this.heroTimer);
    clearTimeout(this.heroPreloadTimer);
  },

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const direction = DIRECTIONS[code];
    if (direction || code === 13) {
      // Current Home: the first key cancels a late focus restore or Continue Watching jump.
      this.interacted = true;
      this.pendingSnapshot = null;
    }
    if (code !== 13) this.cancelPendingContinueWatchingHold();
    if (direction) {
      event.preventDefault?.();
      if (!allowDpadRepeat(this, event)) return;
      if (this.sidebarIndex >= 0) this.moveInSidebar(direction);
      else this.moveInRails(direction);
      return;
    }
    if (code !== 13) return;
    event.preventDefault?.();
    if (this.sidebarIndex >= 0) {
      const action = this.view.sidebarItems()[this.sidebarIndex]?.dataset.action;
      activateLegacySidebarAction(action, "home");
      return;
    }
    const row = this.rows[this.focus.row];
    const item = this.currentItem();
    if (!item) return;
    // Folders are no hold target: they open on key-down, like the current Home.
    if (row.kind === "collection") this.openItem(row, item);
    else if (!event.repeat && !this.pendingHold) this.armHold(row, item);
  },

  /**
   * OK on a title: the short press acts on key-up, a 650 ms hold opens its menu (current Home
   * hold targets). A key-up with no armed press is ignored: the OK that closed the changelog or
   * the hand-off prompt.
   */
  onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) return;
    const target = this.pendingHold;
    if (!target) return;
    event.preventDefault?.();
    this.cancelPendingContinueWatchingHold();
    if (!this.isFocused(target)) return;
    if (Number(event.keyDownDurationMs || 0) >= CW_HOLD_DELAY_MS) this.openHoldMenu();
    else this.openItem(this.rows[this.focus.row], this.currentItem());
  },

  armHold(row, item) {
    const target = { rowKey: row.key, identity: itemIdentity(item) };
    this.pendingHold = target;
    // Firmware can swallow the key-up: the timer opens the menu on its own.
    this.holdTimer = setTimeout(() => {
      if (this.pendingHold !== target) return;
      this.cancelPendingContinueWatchingHold();
      if (Router.getCurrent() === "home" && this.isFocused(target)) this.openHoldMenu();
    }, CW_HOLD_DELAY_MS);
  },

  /** Named like the current Home's, so FocusEngine.resetVidaaKeyState cancels it on blur. */
  cancelPendingContinueWatchingHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.pendingHold = null;
  },

  isFocused(target) {
    return (
      this.sidebarIndex < 0 &&
      this.rows[this.focus.row]?.key === target.rowKey &&
      itemIdentity(this.currentItem()) === target.identity
    );
  },

  /** Short OK per row kind: Continue Watching resumes, folders open, other titles open Detail. */
  openItem(row, item) {
    if (!row || !item) return;
    this.lastSnapshot = focusSnapshot(this.focus, this.rows);
    if (row.kind === "continue") {
      this.resumeContinueWatching(item);
      return;
    }
    if (row.kind === "collection") {
      Router.navigate("folderDetail", {
        collectionId: item.collectionId,
        folderId: item.folderId,
        collectionTitle: item.collectionTitle || ""
      });
      return;
    }
    if (item.id) Router.navigate("detail", detailParams(item));
  },

  /** Current Home openContinueWatchingFromItem: cloud items play, others resume through Detail. */
  resumeContinueWatching(item, options = {}) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) return;
    if (isCloudContinueWatchingItem(normalized)) {
      void openCloudContinueWatchingFromItem(normalized, options).catch((error) =>
        console.warn("Cloud Continue Watching playback failed", error)
      );
      return;
    }
    const params = continueWatchingDetailParams(normalized, options);
    if (params) Router.navigate("detail", params);
  },

  openHoldMenu() {
    const row = this.rows[this.focus.row];
    const item = this.currentItem();
    if (!row || !item) return;
    if (row.kind === "continue") this.openContinueWatchingMenu(item);
    else void this.openPosterMenu(item);
  },

  /** Shared title menu (details, library or lists, watched, Pas pour moi), as See All uses it. */
  async openPosterMenu(item) {
    const token = this.token;
    const menu = (this.posterMenu ||= new PosterOptionsDialogController({
      onDetails: (target) => Router.navigate("detail", detailParams(target)),
      onDismiss: () => this.render(),
      onChanged: (state) => this.markWatched(state)
    }));
    await menu.open(item);
    // A Home left while the menu state loaded gets no dialog.
    if (token !== this.token) menu.destroy({ restoreFocus: false });
  },

  /** Watched badge after the menu toggled it, before the next load publishes the stored state. */
  markWatched({ item, isWatched }) {
    const ids = new Set(this.watchedTitleIds || []);
    watchedItemIdentityValues(item).forEach((id) => (isWatched ? ids.add(id) : ids.delete(id)));
    this.applyWatched(ids);
  },

  /** Current Home Continue Watching menu (methods-07/09): Details, Start from beginning, Remove. */
  openContinueWatchingMenu(item) {
    this.cwDialog?.destroy();
    this.cwDialog = new NuvioDialog({
      title: item.title || "Untitled",
      subtitle: t("cw_dialog_subtitle", {}, "Choose what you want to do with this item."),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: continueWatchingMenuOptions(item).map((option) => ({
        label: option.label,
        key: option.action,
        onAction: () =>
          void this.activateContinueWatchingOption(option.action, item).catch((error) =>
            console.warn("Continue Watching menu action failed", error)
          )
      })),
      onDismiss: () => {
        this.cwDialog = null;
        this.render();
      }
    }).mount(document.body);
  },

  async activateContinueWatchingOption(action, item) {
    const dialog = this.cwDialog;
    const normalized = normalizeContinueWatchingItem(item);
    if (!dialog || !normalized?.contentId) return;
    this.lastSnapshot = focusSnapshot(this.focus, this.rows);
    if (action === "details") {
      this.cwDialog = null;
      const params = continueWatchingDetailsMenuParams(normalized);
      dialog.destroy({ afterExit: () => Router.navigate("detail", params) });
      return;
    }
    if (action === "startOver") {
      this.cwDialog = null;
      dialog.destroy();
      this.resumeContinueWatching(item, { startOver: true });
      return;
    }
    if (action !== "remove") return;
    await removeContinueWatchingProgress(normalized);
    if (this.cwDialog === dialog) this.cwDialog = null;
    dialog.destroy();
    // Current Home pruneContinueWatchingItem: the whole title leaves, its snapshot is dropped.
    this.removedContinue.push({ ...normalized, videoId: null });
    clearContinueWatchingDisplaySnapshot(watchProgressRepository.getContinueWatchingSourceKey());
    this.applyRows(this.rows);
  },

  moveInRails(direction) {
    const next = moveFocus(this.focus, this.rows, direction);
    if (next === null) {
      this.openSidebar(false);
      return;
    }
    this.focus = next;
    this.scheduleHero();
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
    if (direction === "right") return this.closeSidebar();
    if (direction === "up") this.sidebarIndex = Math.max(0, this.sidebarIndex - 1);
    else if (direction === "down") this.sidebarIndex = Math.min(count - 1, this.sidebarIndex + 1);
    this.render();
  },

  /** Current Home openSidebar: focus lands on the selected item (Home), not the profile pill. */
  openSidebar(openedByBack) {
    const selected = this.view
      .sidebarItems()
      .findIndex((node) => node.classList.contains("selected"));
    this.sidebarIndex = Math.max(0, selected);
    this.sidebarOpenedByBack = openedByBack;
    this.cancelHero();
    this.render();
  },

  /** Back in the rails: the focused title becomes the hero again once calm. */
  closeSidebar() {
    this.sidebarIndex = -1;
    this.sidebarOpenedByBack = false;
    this.render();
    this.scheduleHero();
  },

  /** Home picked again in the sidebar: back to the first card, like the current Home. */
  onSidebarReselect() {
    const first = this.rows.findIndex((row) => row.items.length);
    this.focus = { ...createFocus(), row: Math.max(0, first) };
    this.closeSidebar();
  },

  /** Back: content opens the sidebar; the sidebar exits only when Back opened it, else closes. */
  consumeBackRequest() {
    this.cancelPendingContinueWatchingHold();
    // A menu's Back already closed it; its exit animation still holds the modal marker.
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) return true;
    if (this.sidebarIndex < 0) this.openSidebar(true);
    else if (this.sidebarOpenedByBack) {
      this.sidebarOpenedByBack = false;
      Platform.exitApp();
    } else this.closeSidebar();
    return true;
  },

  captureRouteState() {
    return focusSnapshot(this.focus, this.rows);
  },

  cleanup() {
    this.lastSnapshot = focusSnapshot(this.focus, this.rows) || this.lastSnapshot;
    this.token = (this.token || 0) + 1;
    this.cancelHero();
    clearTimeout(this.pageTimer);
    this.cancelPendingContinueWatchingHold();
    // A menu left mounted would keep nuvio-modal-open and block every key.
    this.posterMenu?.destroy({ restoreFocus: false });
    this.posterMenu = null;
    this.cwDialog?.destroy();
    this.cwDialog = null;
    this.imageQueue?.clear();
    this.view?.destroy();
    this.view = null;
    ScreenUtils.hide(this.container);
  }
};
