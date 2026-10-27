import { Router } from "../navigation/routerState.js";
import { ScreenUtils } from "../navigation/screen.js";
import { allowDpadRepeat } from "../navigation/dpadRepeatThrottle.js";
import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";
import { Platform } from "../../platform/index.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { StartupSyncService } from "../../core/profile/startupSyncService.js";
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
import {
  CW_HOLD_DELAY_MS,
  HERO_ROTATE_FIRST_DELAY_MS,
  HERO_ROTATE_INTERVAL_MS,
  HOME_CATALOG_REFRESH_TTL_MS,
  HOME_GRID_SAFE_MAX_COLUMNS,
  HOME_LAYOUT_SEQUENCE,
  HOME_MAX_ITEMS_PER_ROW_CLASSIC
} from "../screens/home/homeConstants.js";
import {
  MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS,
  t
} from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { shouldApplyLateContinueWatchingFocus } from "../screens/home/homeFocusPolicy.js";
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
  getHomeGridRowCount,
  removeContinueWatchingProgress
} from "../screens/home/homeScreenHelpers-13-continue-watching-stream-params.js";
import { buildCatalogSeeAllPayload } from "../screens/home/homeCatalogPage.js";
import { createHomeScreenMethods03 } from "../screens/home/homeScreenMethods-03-is-scroll-animation-active.js";
import { createHomeScreenMethods08 } from "../screens/home/homeScreenMethods-08-open-hold-menu-for-node.js";
import { createHomeScreenMethods11 } from "../screens/home/homeScreenMethods-11-enrich-current-hero-async.js";
import { createHomeScreenMethods12 } from "../screens/home/homeScreenMethods-12-sync-collection-hero-media.js";
import { createHomeScreenMethods13 } from "../screens/home/homeScreenMethods-13-mount-trailer-layer.js";
import { createHomeScreenMethods22 } from "../screens/home/homeScreenMethods-22-pick-initial-hero.js";
import { createHomeScreenMethods27 } from "../screens/home/homeScreenMethods-27-enrich-continue-watching.js";
import { normalizeHomeRowItem } from "../screens/home/homeScreenHelpers-05-normalize-collection-folder-item.js";
import {
  preloadHeroAssets,
  shouldEnrichModernHero
} from "../screens/home/homeScreenHelpers-02-extract-release-date-text.js";
import { applyTrailerAudioPreferences } from "../screens/home/homeScreenHelpers-06-resolve-trailer-source.js";
import { homeMetadataSettingsSignature } from "../screens/home/homeMetadataSettings.js";
import { ensureHeroMdbListRatings } from "../screens/home/homeHeroMdbListLoad.js";
import { MODERN_HOME_CONSTANTS } from "../screens/home/modernHomeLayout.js";
import {
  getVidaaHeroFocusDelay,
  getVidaaHeroPreloadDelay
} from "../screens/home/vidaaHomePreviewPolicy.js";
import { loadHomeRows, loadNextCatalogPage } from "./homeModel.js";
import {
  buildLayoutRows,
  cardGeometry,
  homeLayoutMode,
  isLegacyLayout,
  rowCardSize,
  trackCamera
} from "./railEngine.js";
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
// Hero enrichment of the current Home (addon meta, TMDB, IMDb), run on heroHost().
const { enrichCurrentHeroAsync } = createHomeScreenMethods11();
// Current Home trailer policy (prefs, legacy-runtime suppression, constrained-TV delay, deferred
// teardown), runtime row limits and trailer lookup (inline, TMDB, addon meta); none of them reads
// screen state (getRowItemLimit reads the `collections` it is called with).
const trailerPolicy = {
  ...createHomeScreenMethods03(),
  getFocusedPosterFlowConfig: createHomeScreenMethods12().getFocusedPosterFlowConfig
};
const { getTrailerSourceForItem } = createHomeScreenMethods13();
// Trailer lookups per title, bounded like the current Home's prefetch cache.
const trailerSources = new Map();
const TRAILER_SOURCE_CACHE = 32;

// A menu or dialog is open over Home (NuvioDialog marker).
const modalOpen = () => Boolean(globalThis.document?.body?.classList?.contains("nuvio-modal-open"));

/** Hero source of a card, as the current Home's getNodeHeroSource (personal rows have no entry). */
function heroSource(row, item) {
  if (!row || !item || item.seeAll) return null;
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
    this.imageQueue = createImageQueue({ isBusy: () => isVidaaNavigationBusy() });
    this.setLayout(LayoutPreferences.get());
    this.layoutFocus = {};
    // Current Home getRowItemLimit counts the collections loaded with the rows.
    this.collections = CollectionsStore.get();
    this.profile = null;
    this.watchedTitleIds = null;
    // Current Home mount: a profile or Continue Watching source change (or forceReload) reloads
    // everything; otherwise the last visit's rows paint at once and refresh in the background.
    const profileId = String(ProfileManager.getActiveProfileId() || "");
    const sourceKey = watchProgressRepository.getContinueWatchingSourceKey();
    const reload =
      !this.modelRows?.length ||
      profileId !== this.loadedProfileId ||
      sourceKey !== this.loadedSourceKey ||
      Boolean(params?.forceReload && !navigation.isBackNavigation);
    if (reload) {
      this.lastSnapshot = null;
      this.continueFocusApplied = false;
      this.loadedProfileId = profileId;
      this.loadedSourceKey = sourceKey;
    }
    const cached = reload ? [] : this.modelRows;
    this.backgroundLoad = !reload;
    // The phone remote's Home while on Home (same-route navigate): as Home picked in the sidebar.
    const reselect = navigation.previousRoute === "home" && !navigation.isBackNavigation;
    const snapshot = reselect
      ? null
      : (navigation.isBackNavigation && navigation.restoredState) || this.lastSnapshot || null;
    this.loading = false;
    this.pendingRefresh = null;
    this.view = this.createView(token);
    // Current Home: a Back return starts with the modern sidebar pill icon-only, unless it
    // gives the sidebar its focus back.
    this.pillIconOnly = Boolean(navigation.isBackNavigation && !snapshot?.sidebar);
    this.view.setSidebarPill?.(this.pillIconOnly);
    this.modelRows = [];
    this.rows = [];
    this.focus = createFocus();
    this.sidebarIndex = -1;
    this.sidebarOpenedByBack = false;
    this.holdFocusLocked = false;
    this.pagesInFlight = new Set();
    this.removedContinue = [];
    this.interacted = false;
    this.heroItem = null;
    this.heroCandidates = [];
    this.heroLoading = false;
    this.lastHeroNavAt = 0;
    this.heroHost = this.createHeroHost();
    this.focusMediaIdentity = "";
    this.pendingSnapshot = snapshot;
    this.restoring = Boolean(this.pendingSnapshot);
    this.subscribe();
    if (cached.length) this.applyRows(cached);
    if (reselect) this.onSidebarReselect();
    // Home left from the sidebar: it opens again on Home (current Home restoreSidebarFocusState).
    else if (snapshot?.sidebar) this.openSidebar(false);
    this.schedulePillCollapse();
    // Local profile state first, then the remote one (membership, avatar) when it differs.
    void getSidebarProfileState({ cacheOnly: true })
      .catch(() => null)
      .then((profile) => {
        if (token !== this.token) return null;
        if (profile) this.setSidebarProfile(profile);
        return getSidebarProfileState();
      })
      .then((profile) => {
        if (
          token === this.token &&
          profile &&
          JSON.stringify(profile) !== JSON.stringify(this.profile)
        )
          this.setSidebarProfile(profile);
      })
      .catch(() => {});
    this.loadRows({ retained: cached });
  },

  /** Profile pill and avatar; the sidebar focus stays on an existing item. */
  setSidebarProfile(profile) {
    this.profile = profile;
    this.view?.setProfile(profile);
    if (this.sidebarIndex < 0 || !this.view) return;
    this.sidebarIndex = Math.max(
      0,
      Math.min(this.sidebarIndex, this.view.sidebarItems().length - 1)
    );
    this.render();
  },

  /**
   * One rows load at a time (its own token, so a refresh never stops hero or menus); a refresh
   * asked meanwhile runs after it, as the current Home coalesces them. Catalogs then refresh in
   * place once older than the current Home's 15 min freshness window.
   */
  loadRows({ retained = [], continueOnly = false } = {}) {
    const token = this.token;
    const load = (this.loadToken || 0) + 1;
    this.loadToken = load;
    this.loading = true;
    // A Continue Watching refresh leaves the catalogs' age as it is.
    if (!continueOnly) clearTimeout(this.staleTimer);
    const isCurrent = () => token === this.token && load === this.loadToken;
    void loadHomeRows({
      isCurrent,
      retained,
      continueOnly,
      focusedRowKey: () => this.rows[this.focus.row]?.key || "",
      layoutMode: this.layoutMode,
      onRows: (rows) => this.applyRows(rows),
      onWatched: (ids) => this.applyWatched(ids)
    })
      .catch((error) => console.warn("New Home load failed", error))
      .finally(() => {
        if (!isCurrent()) return;
        this.loading = false;
        const pending = this.pendingRefresh;
        this.pendingRefresh = null;
        // A queued Continue Watching refresh keeps this load's catalog age.
        if (!continueOnly)
          this.staleTimer = setTimeout(() => this.refreshRows(), HOME_CATALOG_REFRESH_TTL_MS);
        if (pending) this.refreshRows(pending);
      });
  },

  /** Background refresh merged into the shown rows (route return, sync, addons, stale catalogs). */
  refreshRows({ continueOnly = false } = {}) {
    if (!this.view) return;
    if (this.loading) {
      this.pendingRefresh = {
        continueOnly: (this.pendingRefresh?.continueOnly ?? true) && continueOnly
      };
      return;
    }
    this.backgroundLoad = true;
    // A new load ends the last one's silent retry (D1): pending catalog rows reload with it.
    const pendingCatalogs = this.modelRows.some((row) => row.entry && row.status === "loading");
    this.loadRows({ retained: this.modelRows, continueOnly: continueOnly && !pendingCatalogs });
  },

  /**
   * While mounted, as the current Home: a startup pull refreshes Continue Watching (watch state,
   * unchanged inputs) or everything; an addon or manifest change refreshes everything.
   */
  subscribe() {
    this.unsubscribe();
    const refresh = () => this.refreshRows();
    this.unsubscribers = [
      StartupSyncService.subscribeToPullCompleted(
        ({ profileId, changedHomeInputs, source } = {}) => {
          if (profileId && String(profileId) !== String(ProfileManager.getActiveProfileId() || ""))
            return;
          this.refreshRows({
            continueOnly: source === "watch-state" || changedHomeInputs === false
          });
        }
      ),
      addonRepository.onInstalledAddonsChanged(refresh),
      addonRepository.onManifestCacheChanged(refresh)
    ];
  },

  unsubscribe() {
    (this.unsubscribers || []).forEach((off) => off?.());
    this.unsubscribers = [];
  },

  /** Current Home modern sidebar pill: label shown, icon-only 4 s later (Up shows it again). */
  schedulePillCollapse({ restart = false } = {}) {
    if (!this.viewOptions.layout?.modernSidebar || this.sidebarIndex >= 0 || this.pillIconOnly) {
      clearTimeout(this.pillTimer);
      this.pillTimer = null;
      return;
    }
    if (this.pillTimer && !restart) return;
    clearTimeout(this.pillTimer);
    this.pillTimer = setTimeout(() => {
      this.pillTimer = null;
      if (this.sidebarIndex >= 0 || !this.view) return;
      this.pillIconOnly = true;
      this.view.setSidebarPill?.(true);
    }, MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS);
  },

  /** Down hides the pill label, Up shows it again until the auto-collapse. */
  movePill(direction) {
    if (!this.viewOptions.layout?.modernSidebar || this.sidebarIndex >= 0) return;
    if (direction !== "up" && direction !== "down") return;
    const wasIconOnly = this.pillIconOnly;
    this.pillIconOnly = direction === "down";
    this.view.setSidebarPill?.(this.pillIconOnly);
    this.schedulePillCollapse({ restart: wasIconOnly });
  },

  /** Layout of the preferences (modern, grid, classic) and its card geometry. */
  setLayout(layout) {
    this.layoutMode = homeLayoutMode(layout);
    this.viewOptions = {
      geometry: cardGeometry(layout, this.layoutMode),
      imageQueue: this.imageQueue,
      layout
    };
  },

  /**
   * Renderer of the chosen mode when WebGL works, else the DOM one; the engine goes to Diagnostic.
   * Classic and grid always draw in DOM (D9): the WebGL renderer stays modern-only.
   */
  createView(token) {
    const mode = sessionNewHomeMode();
    const fallBack = (why) => token === this.token && this.fallBackToDom(why);
    if (mode === "webgl" && homeEngine() === "webgl" && !isLegacyLayout(this.layoutMode)) {
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
    this.view.setSidebarPill?.(this.pillIconOnly);
    this.view.setRows(this.rows);
    this.render();
    this.view.setHero(this.heroItem, {
      loading: this.heroLoading,
      candidates: this.heroCandidates
    });
  },

  /** Model rows as the layout draws them (railEngine buildLayoutRows) with the current Home caps. */
  layoutRows(modelRows) {
    const { geometry, layout } = this.viewOptions;
    // Current Home render (methods-23): 24 per classic row and 8 columns per grid line only on
    // unconstrained runtimes, else getRowItemLimit (10 on VIDAA, D4).
    const roomy = !trailerPolicy.isPerformanceConstrained() && !trailerPolicy.isLegacyTvRuntime();
    const itemLimit = trailerPolicy.getRowItemLimit.call({
      ...trailerPolicy,
      collections: this.collections
    });
    const gridRowCount = getHomeGridRowCount(layout);
    return buildLayoutRows(modelRows, {
      geometry,
      heroEnabled:
        Boolean(layout.heroSectionEnabled) && Boolean(this.heroItem || this.heroCandidates.length),
      itemLimit: roomy ? HOME_MAX_ITEMS_PER_ROW_CLASSIC : itemLimit,
      gridMaxItems: roomy ? HOME_GRID_SAFE_MAX_COLUMNS * gridRowCount : itemLimit,
      gridRowCount,
      showAddonName: layout.catalogAddonNameEnabled !== false
    });
  },

  applyRows(nextRows) {
    this.modelRows = this.withoutRemoved(nextRows);
    const entries = this.modelRows.map((row) => row.entry).filter(Boolean);
    this.heroCandidates = collectHeroCandidates.call(
      { layoutPrefs: this.viewOptions.layout },
      entries
    );
    const rows = this.layoutRows(this.modelRows);
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
    // Classic/grid start on their hero card, until a key or a return.
    if (rows[0]?.kind === "hero") {
      if (!this.interacted && !this.restoring) this.focus = { ...this.focus, row: 0 };
    } else if (this.layoutMode === "modern" && this.sidebarIndex < 0) {
      // Current Home late focus: modern Continue Watching takes focus once, before any key,
      // never on a return or a background refresh.
      const continueRow = rows.findIndex(
        (row) => row.key === "continue_watching" && row.items.length
      );
      if (
        continueRow >= 0 &&
        shouldApplyLateContinueWatchingFocus({
          background: this.backgroundLoad,
          hasUserInteracted: this.interacted,
          suppressInitialFocus: this.restoring,
          hasAppliedInitialFocus: this.continueFocusApplied
        })
      ) {
        this.focus = { ...this.focus, row: continueRow };
        this.continueFocusApplied = true;
      }
    }
    this.view.setRows(rows);
    this.render();
    this.applyInitialHero(this.modelRows, entries);
    this.scheduleHero();
    this.startHeroRotation();
  },

  /**
   * Current Home initial hero (pickInitialHero): until the first key, a filled Continue Watching
   * row's first title, else the first hero candidate; a skeleton while Continue Watching loads.
   * A return shows the restored card's title.
   */
  applyInitialHero(rows, entries) {
    if (this.interacted || this.heroHidden()) return;
    const continueRow = rows.find((row) => row.key === "continue_watching");
    if (this.heroItem && !continueRow?.items.length) return;
    let hero = null;
    if (this.restoring && !isLegacyLayout(this.layoutMode))
      hero = this.pendingSnapshot ? null : this.focusedHeroSource();
    else hero = this.initialHero(rows, entries);
    if (hero) {
      this.showHero(hero);
      this.enrichHero();
      return;
    }
    const loading = continueRow?.status === "loading";
    if (loading === this.heroLoading) return;
    this.heroLoading = loading;
    this.view.setHero(null, { loading });
  },

  /** Current Home pickInitialHero: modern prefers Continue Watching, classic/grid the candidates. */
  initialHero(rows, entries) {
    const continueRow = rows.find((row) => row.key === "continue_watching");
    return pickInitialHero.call({
      layoutMode: this.layoutMode,
      layoutPrefs: this.viewOptions.layout,
      continueWatchingLoading: continueRow?.status === "loading",
      continueWatchingDisplay: continueRow?.items || [],
      heroCandidates: this.heroCandidates,
      rows: entries,
      pickHeroItem
    });
  },

  /** One hero write per title: the same identity is never written again. */
  showHero(hero) {
    this.heroLoading = false;
    if (!hero || buildHeroIdentity(hero) === buildHeroIdentity(this.heroItem)) return;
    this.heroItem = hero;
    this.view?.setHero(hero, { candidates: this.heroCandidates });
  },

  /**
   * The `this` of the current Home's enrichCurrentHeroAsync and ensureHeroMdbListRatings: the
   * screen's hero, its hero token as focus token (a move, the sidebar or leaving Home stops the
   * commit) and the focused title as focused node. No collection GIFs (collection heroes are
   * not enriched); a Continue Watching hero's MDBList ratings reach the hero, not the snapshot.
   */
  createHeroHost() {
    const screen = this;
    const token = this.token;
    return {
      get layoutMode() {
        return screen.layoutMode;
      },
      heroCandidates: [],
      get heroItem() {
        return screen.heroItem;
      },
      set heroItem(item) {
        screen.heroItem = item;
      },
      get heroFocusToken() {
        return screen.heroToken || 0;
      },
      get homeLoadToken() {
        return screen.token;
      },
      getCurrentFocusedNode: () => screen.focusedHeroSource(),
      getNodeHeroSource: (hero) => hero,
      async waitForVidaaHomeLoadingIdle(isCurrent) {
        while (isCurrent()) {
          if (!isVidaaNavigationBusy()) return true;
          await new Promise((resolve) => setTimeout(resolve, HERO_BUSY_POLL_MS));
        }
        return false;
      },
      // As the current Home: the enriched data goes into the cards' items (same id and identity).
      mergeHeroIntoCatalogState(itemId, merged) {
        const identity = buildHeroIdentity(merged);
        const matches = (item) =>
          String(item?.id || "") === itemId && buildHeroIdentity(item) === identity;
        new Set([...screen.rows, ...screen.modelRows]).forEach((row) => {
          if (row.kind !== "continue" && row.items.some(matches))
            row.items = row.items.map((item) => (matches(item) ? { ...item, ...merged } : item));
        });
      },
      applyHeroToDom() {
        if (token === screen.token) screen.view?.setHero(screen.heroItem);
      }
    };
  },

  /**
   * Current Home: the shown hero is enriched once it is committed, and gets its MDBList ratings.
   * Classic/grid commit it as shown (no focus check), like their applyHeroToDom path.
   */
  enrichHero() {
    const host = this.heroHost;
    if (shouldEnrichModernHero(this.heroItem, this.layoutMode))
      void enrichCurrentHeroAsync.call(
        host,
        this.heroItem,
        host.heroFocusToken,
        isLegacyLayout(this.layoutMode) ? {} : { deferCommit: true }
      );
    void ensureHeroMdbListRatings.call(host);
  },

  focusedHeroSource() {
    const row = this.rows[this.focus.row];
    return row?.kind === "hero" ? this.heroItem : heroSource(row, this.currentItem());
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
    this.focus = trackCamera(this.focus, this.rows, this.viewOptions.geometry);
    this.view?.update(this.rows, this.focus, {
      sidebarIndex: this.sidebarIndex,
      hideFocus: Boolean(this.holdFocusLocked)
    });
  },

  /** Current Home lock/unlockHomeHoldFocus: no focused card while a hold menu is open. */
  lockHoldFocus(locked) {
    this.holdFocusLocked = locked;
    this.render();
  },

  /** Classic/grid with heroSectionEnabled off draw no hero: nothing to pick, enrich or rotate. */
  heroHidden() {
    return isLegacyLayout(this.layoutMode) && !this.viewOptions.layout.heroSectionEnabled;
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
  scheduleHero({ moved = false } = {}) {
    // Classic/grid heroes do not follow focus: they rotate (startHeroRotation, Left/Right on them).
    if (isLegacyLayout(this.layoutMode)) return;
    const hero = this.focusedHeroSource();
    const identity = buildHeroIdentity(hero);
    // A rows refresh keeps the pending hero of the same title: only moves reschedule it.
    if (identity && identity === this.heroPending) return;
    const isHero = Boolean(identity) && identity === buildHeroIdentity(this.heroItem);
    // A rows refresh also keeps the shown hero's running enrichment; another title's pending
    // hero is dropped (its timer no longer matches the focus), so a later move reschedules it.
    if (isHero && !moved) {
      this.heroPending = "";
      this.scheduleFocusMedia(hero);
      return;
    }
    this.cancelHero();
    // Current Home holds the skeleton for Continue Watching until it resolves or the first key.
    if (this.heroLoading && !this.interacted) return;
    // Back on the hero (after a move or the sidebar): only an unfinished enrichment is redone.
    if (!hero?.id) return;
    if (isHero && !shouldEnrichModernHero(this.heroItem)) {
      this.scheduleFocusMedia(hero);
      return;
    }
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
    this.heroPending = identity;
    this.heroTimer = setTimeout(
      () =>
        whenCalm("heroTimer", (focused) => {
          this.heroPending = "";
          this.showHero(focused);
          this.enrichHero();
          this.scheduleFocusMedia(focused);
        }),
      delay
    );
  },

  /**
   * Focus media of the calm hero (current Home focused poster flow, hero_media target, and
   * syncCollectionHeroMedia): a folder shows its focus GIF and hero video now; a poster's trailer
   * plays after max(250, expand delay) plus the constrained-TV delay. Never while VIDAA navigation
   * is busy; a move, OK, the sidebar or cleanup stops it (stopFocusMedia).
   */
  scheduleFocusMedia(hero) {
    const identity = buildHeroIdentity(hero);
    // A rows refresh under the sidebar or a menu starts nothing.
    if (!identity || identity === this.focusMediaIdentity || this.sidebarIndex >= 0 || modalOpen())
      return;
    const row = this.rows[this.focus.row];
    if (row?.kind === "collection") {
      this.focusMediaIdentity = identity;
      if (hero.focusGifEnabled && hero.focusGifUrl) this.view?.setFocusGif?.(hero.focusGifUrl);
      if (hero.heroVideoUrl)
        this.view?.playHeroTrailer?.({ kind: "video", url: hero.heroVideoUrl, muted: true });
      return;
    }
    const prefs = this.viewOptions.layout;
    const { shouldPreviewTrailer, trailerTarget } = trailerPolicy.getFocusedPosterFlowConfig(prefs);
    // D5: the expanded_card target needs poster expansion (later lot).
    if (row?.kind !== "poster" || !shouldPreviewTrailer || trailerTarget !== "hero_media") return;
    if (!this.view?.playHeroTrailer) return;
    this.focusMediaIdentity = identity;
    // Keyed like the current Home's prefetch: the metadata settings choose the trailer source.
    const key = `${identity}|${homeMetadataSettingsSignature()}`;
    if (!trailerSources.has(key)) {
      trailerSources.set(
        key,
        getTrailerSourceForItem(hero).catch(() => null)
      );
      if (trailerSources.size > TRAILER_SOURCE_CACHE)
        trailerSources.delete(trailerSources.keys().next().value);
    }
    const source = trailerSources.get(key);
    const token = this.heroToken;
    const current = () => token === this.heroToken && this.focusMediaIdentity === identity;
    const dwell = Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
    const delay =
      (Platform.isVidaa() ? Math.max(250, dwell) : dwell) +
      trailerPolicy.getFocusedPosterTrailerDelayMs("hero_media");
    const play = async () => {
      if (!current()) return;
      if (isVidaaNavigationBusy({ quietMs: HERO_BUSY_POLL_MS })) {
        this.trailerTimer = setTimeout(play, HERO_BUSY_POLL_MS);
        return;
      }
      const base = await source;
      if (!current()) return;
      // A lookup that ends during navigation waits for calm again.
      if (isVidaaNavigationBusy({ quietMs: HERO_BUSY_POLL_MS })) {
        this.trailerTimer = setTimeout(play, HERO_BUSY_POLL_MS);
        return;
      }
      const trailer = applyTrailerAudioPreferences(base, prefs);
      if (trailer && !modalOpen()) this.view?.playHeroTrailer(trailer);
    };
    this.trailerTimer = setTimeout(play, delay);
  },

  /** Stops the trailer, folder video and focus GIF; deferred teardown on constrained TVs. */
  stopFocusMedia({ deferred = Boolean(trailerPolicy.shouldUseImmediateFocusScroll()) } = {}) {
    clearTimeout(this.trailerTimer);
    if (!this.focusMediaIdentity) return;
    this.focusMediaIdentity = "";
    this.view?.stopHeroTrailer?.({ deferred });
    this.view?.setFocusGif?.("");
  },

  /** Ambient mode stops Home previews through this current Home name. */
  cancelFocusedPosterFlow() {
    this.stopFocusMedia();
  },

  /**
   * Current Home startHeroRotation: classic/grid only, never on constrained runtimes (VIDAA in
   * auto mode); 20 s, then every 10 s, skipped while the hero card is focused.
   */
  startHeroRotation() {
    if (
      this.rotateTimer ||
      !isLegacyLayout(this.layoutMode) ||
      this.heroHidden() ||
      this.heroCandidates.length <= 1 ||
      trailerPolicy.isPerformanceConstrained()
    )
      return;
    const tick = (delay) => {
      this.rotateTimer = setTimeout(() => {
        if (this.rows[this.focus.row]?.kind !== "hero") this.rotateHero(1);
        tick(HERO_ROTATE_INTERVAL_MS);
      }, delay);
    };
    tick(HERO_ROTATE_FIRST_DELAY_MS);
  },

  stopHeroRotation() {
    clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
  },

  /**
   * Current Home rotateHero: next candidate, committed once its artwork is warm and VIDAA
   * navigation is calm; held keys coalesce (only the latest slide commits).
   */
  rotateHero(step) {
    const total = this.heroCandidates.length;
    if (total <= 1) return;
    this.heroIndex = (Number(this.heroIndex || 0) + step + total) % total;
    const hero = this.heroCandidates[this.heroIndex];
    this.cancelHero();
    const token = this.heroToken;
    const current = () => token === this.heroToken;
    const host = this.heroHost;
    void (async () => {
      if (!(await host.waitForVidaaHomeLoadingIdle(current))) return;
      await preloadHeroAssets(hero, this.layoutMode).catch(() => {});
      if (!(await host.waitForVidaaHomeLoadingIdle(current))) return;
      this.showHero(hero);
      this.enrichHero();
    })();
  },

  /**
   * Key 76 (current Home): next layout of modern, grid, classic, saved in the preferences. Each
   * layout gets its own focus back; the view is rebuilt (DOM outside modern) with the same rows.
   */
  switchLayout() {
    this.layoutFocus[this.layoutMode] = focusSnapshot(this.focus, this.rows);
    const next = (HOME_LAYOUT_SEQUENCE.indexOf(this.layoutMode) + 1) % HOME_LAYOUT_SEQUENCE.length;
    LayoutPreferences.set({ homeLayout: HOME_LAYOUT_SEQUENCE[next] });
    this.cancelHero();
    this.stopHeroRotation();
    this.cancelPendingContinueWatchingHold();
    this.imageQueue?.clear();
    this.view?.destroy();
    this.setLayout(LayoutPreferences.get());
    this.view = this.createView(this.token);
    if (this.profile) this.view.setProfile(this.profile);
    if (this.watchedTitleIds) this.view.setWatched?.(this.watchedTitleIds);
    this.view.setSidebarPill?.(this.pillIconOnly);
    this.interacted = true;
    this.heroItem = null;
    this.heroIndex = 0;
    this.rows = [];
    this.focus = createFocus();
    this.pendingSnapshot = this.layoutFocus[this.layoutMode] || null;
    this.applyRows(this.modelRows);
    this.pendingSnapshot = null;
    // Modern shows the focused title at once; classic/grid re-pick their first candidate.
    const hero = isLegacyLayout(this.layoutMode)
      ? this.initialHero(this.modelRows, this.modelRows.map((row) => row.entry).filter(Boolean))
      : this.focusedHeroSource();
    this.cancelHero();
    this.showHero(hero);
    this.enrichHero();
    this.scheduleHero();
  },

  /** Drops the pending hero and aborts its enrichment (move, sidebar, leaving Home). */
  cancelHero() {
    this.stopFocusMedia();
    this.heroToken = (this.heroToken || 0) + 1;
    this.heroHost?.heroEnrichmentAbortController?.abort?.();
    this.heroPending = "";
    clearTimeout(this.heroTimer);
    clearTimeout(this.heroPreloadTimer);
  },

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (code === 76) {
      event.preventDefault?.();
      this.switchLayout();
      return;
    }
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
      this.movePill(direction);
      if (this.sidebarIndex >= 0) this.moveInSidebar(direction);
      else this.moveInRails(direction);
      return;
    }
    if (code !== 13) return;
    event.preventDefault?.();
    this.stopFocusMedia();
    if (this.sidebarIndex >= 0) {
      const action = this.view.sidebarItems()[this.sidebarIndex]?.dataset.action;
      activateLegacySidebarAction(action, "home");
      return;
    }
    const row = this.rows[this.focus.row];
    const item = this.currentItem();
    if (!item) return;
    // Folders, the classic/grid hero and See All are no hold target: they open on key-down,
    // like the current Home.
    if (row.kind === "collection" || row.kind === "hero" || item.seeAll) this.openItem(row, item);
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
    if (row.kind === "hero") {
      if (this.heroItem?.id) Router.navigate("detail", detailParams(this.heroItem));
      return;
    }
    // Current Home openCatalogSeeAllFromNode: the catalog screen goes on from the loaded page.
    if (item.seeAll) {
      Router.navigate("catalogSeeAll", buildCatalogSeeAllPayload(row.entry));
      return;
    }
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
      onDismiss: () => this.lockHoldFocus(false),
      onChanged: (state) => this.markWatched(state)
    }));
    const opened = await menu.open(item);
    // A Home left while the menu state loaded gets no dialog.
    if (token !== this.token) menu.destroy({ restoreFocus: false });
    else if (opened) this.lockHoldFocus(true);
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
        this.lockHoldFocus(false);
      }
    }).mount(document.body);
    this.lockHoldFocus(true);
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
      this.holdFocusLocked = false;
      this.resumeContinueWatching(item, { startOver: true });
      return;
    }
    if (action !== "remove") return;
    await removeContinueWatchingProgress(normalized);
    if (this.cwDialog === dialog) this.cwDialog = null;
    dialog.destroy();
    this.holdFocusLocked = false;
    // Current Home pruneContinueWatchingItem: the whole title leaves, its snapshot is dropped.
    this.removedContinue.push({ ...normalized, videoId: null });
    clearContinueWatchingDisplaySnapshot(watchProgressRepository.getContinueWatchingSourceKey());
    this.applyRows(this.modelRows);
  },

  moveInRails(direction) {
    // Current Home: Left/Right on the classic/grid hero card rotate it, never leave it.
    if (
      this.rows[this.focus.row]?.kind === "hero" &&
      (direction === "left" || direction === "right")
    ) {
      this.rotateHero(direction === "right" ? 1 : -1);
      return;
    }
    const next = moveFocus(this.focus, this.rows, direction);
    if (next === null) {
      this.openSidebar(false);
      return;
    }
    this.focus = next;
    this.scheduleHero({ moved: true });
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
    // D3: classic and grid end their catalogs with See All instead.
    if (isLegacyLayout(this.layoutMode)) return;
    const row = this.rows[this.focus.row];
    if (row?.kind !== "poster" || !row.entry || !row.hasMore || !row.supportsSkip) return;
    // Visible cards from the rail tables, as the current Home's ceil(track width / stride).
    const { geometry } = this.viewOptions;
    const visible = Math.ceil(
      geometry.viewport / (rowCardSize(row, geometry).width + geometry.gap)
    );
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
        // The data row: in modern it is the drawn row; after key 76 the layout copy stays capped.
        const live = this.modelRows.find((candidate) => candidate.key === row.key);
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
    this.schedulePillCollapse();
    // Modern drops its pending hero; a classic/grid hero stays committed and keeps its enrichment.
    if (!isLegacyLayout(this.layoutMode)) this.cancelHero();
    this.render();
  },

  /** Back in the rails: the focused title becomes the hero again once calm. */
  closeSidebar() {
    this.sidebarIndex = -1;
    this.sidebarOpenedByBack = false;
    this.schedulePillCollapse({ restart: true });
    this.render();
    this.scheduleHero({ moved: true });
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
    if (modalOpen()) return true;
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
    const snapshot = focusSnapshot(this.focus, this.rows) || this.lastSnapshot;
    // Not in captureRouteState: a Back return goes to the card, as the current Home's.
    this.lastSnapshot = snapshot && { ...snapshot, sidebar: this.sidebarIndex >= 0 };
    this.token = (this.token || 0) + 1;
    this.cancelHero();
    this.stopHeroRotation();
    // The rows stay for the next visit; their loads, refreshes and subscriptions stop.
    this.unsubscribe();
    clearTimeout(this.staleTimer);
    clearTimeout(this.pillTimer);
    this.pillTimer = null;
    // Current Home cleanup drops its trailer lookups (profile switch, failed lookup).
    trailerSources.clear();
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
