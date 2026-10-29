import { addonRepository } from "../../data/repository/addonRepository.js";
import { catalogRepository } from "../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { Recommendations } from "../../core/perso/personalRecommendations.js";
import { personalContext, isCurrentContext } from "../../core/perso/personalContext.js";
import { Platform } from "../../platform/index.js";
import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";
import {
  watchedItemsRepository,
  StartupSyncService,
  WatchProgressSource,
  CW_MAX_VISIBLE_ITEMS,
  CW_MAX_NEXT_UP_LOOKUPS,
  partitionContinueWatchingRows,
  buildVisibleContinueWatchingItems,
  buildCompleteContinueWatchingDisplay,
  getContinueWatchingNextUpSeedOptions,
  readContinueWatchingDisplaySnapshot,
  shouldProtectContinueWatchingDisplay,
  buildCatalogOrderKey,
  buildCatalogDisableKey
} from "../screens/home/homeScreenContext.js";
import { t } from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { buildVisibleHomeCatalogDescriptors } from "../screens/home/homeCatalogDescriptors.js";
import { HOME_ADDON_MANIFEST_TIMEOUT_MS } from "../screens/home/homeConstants.js";
import { formatCatalogRowTitle } from "../screens/home/homeUtils.js";
import { catalogPageSkip, mergeCatalogPage } from "../screens/home/homeCatalogPage.js";
import { mergeRefreshedHomeRows } from "../screens/home/homeRowMerge.js";
import { mergeHomeCatalogRefreshRow } from "../screens/home/homeScreenMethods-04-get-hero-focus-delay.js";
import { personalHomeRows } from "../screens/perso/personalUi.js";
import { watchedTitleStateRepository } from "../../data/repository/watchedTitleStateRepository.js";
import { buildWatchedTitleIdSet } from "../components/watchedTitleBadge.js";
import { createHomeDataHost } from "./homeDataHost.js";

// Rows of the new TV Home (nuv-091), without DOM: {key, kind, title, items, status, ...}.

/**
 * Current Home Continue Watching rows (render L134-263): the main row while loading or filled,
 * and in split_upcoming mode an "Upcoming" row, drawn with the same continue cards.
 */
export function continueWatchingRows(display = [], { loading = false, sortMode } = {}) {
  const { main, upcoming } = partitionContinueWatchingRows(display, sortMode);
  const rows = [];
  if (main.length || loading)
    rows.push({
      key: "continue_watching",
      kind: "continue",
      title: t("home.continueWatching", {}, "Continue Watching"),
      items: main,
      status: main.length ? "success" : "loading"
    });
  if (upcoming.length)
    rows.push({
      key: "upcoming_section",
      kind: "continue",
      title: t("upcoming_section_title", {}, "Upcoming"),
      items: upcoming,
      status: "success"
    });
  return rows;
}

export function personalRows() {
  return personalHomeRows([]).map((row) => ({
    key: row.catalogId,
    kind: "poster",
    title: row.title,
    items: row.items,
    status: "success"
  }));
}

/**
 * Loads rows progressively: emits the list after each source. `isCurrent` lets a newer load
 * (profile change, remount) discard this one. `onWatched` receives the watched title ids.
 * `retained` (route return, background refresh) holds the rows on screen: their catalog rows
 * stay until fresh ones merge in (current Home background loadData), `focusedRowKey()` and
 * `layoutMode` guard the focused row; `continueOnly` refreshes Continue Watching alone.
 */
export async function loadHomeRows({
  onRows,
  onWatched,
  isCurrent = () => true,
  retained = [],
  focusedRowKey = () => "",
  layoutMode = "",
  continueOnly = false
} = {}) {
  let rows = [];
  let continueRows = [];
  let catalogRows = retained.filter((row) => row.entry);
  const emit = () => {
    if (!isCurrent()) return false;
    rows = [...continueRows, ...catalogRows, ...personalRows()];
    onRows?.(rows);
    return true;
  };

  const host = createHomeDataHost({ layoutPrefs: LayoutPreferences.get() });
  // Continue Watching meta requests wait for the first catalog batch, so first navigation stays smooth.
  let releaseEnrichment;
  const firstBatch = new Promise((resolve) => (releaseEnrichment = resolve));
  if (host.layoutPrefs.continueWatchingEnabled !== false) {
    // Current Home mount: the saved display paints first; without one, the CW placeholder anchors focus.
    host.continueWatchingDisplay = readContinueWatchingDisplaySnapshot(
      watchProgressRepository.getContinueWatchingSourceKey()
    );
    host.continueWatchingHydratedFromSnapshot = host.continueWatchingDisplay.length > 0;
    host.continueWatchingInitialResolved = host.continueWatchingHydratedFromSnapshot;
    const publish = (loading) => {
      continueRows = continueWatchingRows(host.continueWatchingDisplay, {
        loading,
        sortMode: host.layoutPrefs.continueWatchingSortMode
      });
      emit();
    };
    continueRows = continueWatchingRows(host.continueWatchingDisplay, {
      loading: !host.continueWatchingHydratedFromSnapshot,
      sortMode: host.layoutPrefs.continueWatchingSortMode
    });
    if (!emit()) return rows;
    void loadContinueWatching(host, { isCurrent, firstBatch, publish }).catch(
      continueWatchingFailed(publish)
    );
  } else if (!emit()) return rows;
  if (continueOnly) {
    releaseEnrichment();
    return rows;
  }

  const addons = await addonRepository
    .getInstalledAddons({
      includeMediaServers: true,
      staleWhileRevalidate: true,
      timeoutMs: HOME_ADDON_MANIFEST_TIMEOUT_MS
    })
    .catch(() => []);
  if (!isCurrent()) return rows;
  host.collections = CollectionsStore.get();
  const { uniqueCatalogDescriptors, visibleCatalogDescriptors } =
    buildVisibleHomeCatalogDescriptors(addons);
  // Collections are rebuilt from their store by sortAndFilterRows, never retained.
  const kept = retained
    .map((row) => row.entry)
    .filter((row) => row && row.rowKind !== "collection");
  const background = kept.length > 0;
  const keptByKey = new Map(kept.map((row) => [row.homeCatalogKey, row]));
  // Current Home: a refresh drops retained catalogs no longer configured (disabled, removed).
  const configuredKeys = new Set(
    visibleCatalogDescriptors.map((catalog) =>
      buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId)
    )
  );
  const showTypeSuffix = host.layoutPrefs.catalogTypeSuffixEnabled !== false;
  // Fetched rows by key; `saved` holds the VIDAA page-one snapshots shown until a page succeeds.
  const fetched = new Map();
  // Saved pages paint a cold load only; a refresh keeps the rows on screen.
  const saved = background ? new Map() : savedCatalogRows(host, uniqueCatalogDescriptors);
  const refreshWatched = watchedTitleRefresher({ fetched, isCurrent, onWatched });
  void refreshWatched();
  // Current Home order: pinned collections, then catalogs and collections in store order.
  const emitOrdered = () => {
    const shown = new Map([...saved, ...fetched]);
    shown.forEach((row, key) => {
      if (row.result?.status !== "success" && saved.has(key)) shown.set(key, saved.get(key));
      // Current Home stale refresh merge: same page-one head keeps pagination and cards, an
      // empty or failed page keeps the shown row, a focused classic/grid row is not replaced.
      const current = keptByKey.get(key);
      if (current)
        shown.set(
          key,
          mergeHomeCatalogRefreshRow(current, shown.get(key), {
            rowHasFocus: focusedRowKey() === key,
            layoutMode
          })
        );
    });
    const merged = mergeRefreshedHomeRows(kept, [...shown.values()], configuredKeys, {
      background
    });
    catalogRows = host
      .sortAndFilterRows(merged, host.collections)
      .map((row) =>
        row.rowKind === "collection" ? collectionRow(row) : catalogRow(row, showTypeSuffix)
      )
      .filter((row) => row.status !== "success" || row.items.length);
    return emit();
  };
  if (!emitOrdered()) return rows;
  // Same batches as the current Home: visible first in parallel, then deferred batches.
  const options = {
    allowLoading: true,
    shouldContinue: isCurrent,
    onRow: (row) => {
      fetched.set(row.homeCatalogKey, row);
      if (emitOrdered()) void refreshWatched();
    }
  };
  const initialCount = host.getInitialCatalogLoadCount();
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(0, initialCount), options);
  releaseEnrichment();
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(initialCount), {
    ...options,
    batchSize: host.getDeferredCatalogBatchSize(),
    isBusy: () => Platform.isVidaa() && isVidaaNavigationBusy(),
    batchYieldMs: host.isPerformanceConstrained() ? 120 : 0
  });
  if (!isCurrent()) return rows;
  retryPendingCatalogRows(host, { fetched, isCurrent, onRetried: options.onRow });
  // Like refreshPersonalHome: refresh recommendations once, re-emit only when they changed.
  // A Home left during the load (Detail, player) starts no refresh, as in the current Home.
  if (!isCurrent()) return rows;
  const ctx = personalContext();
  const personalItems = (list) =>
    JSON.stringify(list.filter((row) => row.key.startsWith("perso:")).map((row) => row.items));
  void Recommendations.refresh({ ctx })
    .then(() => {
      if (isCurrentContext(ctx) && personalItems(personalRows()) !== personalItems(rows))
        emitOrdered();
    })
    .catch(() => {});
  return rows;
}

/**
 * Current Home watched marks (load-data + refreshWatchedTitleState): stored watched items, then
 * their Trakt series projection over the fetched rows' items; the latest call wins and an
 * unchanged id set is not published again.
 */
function watchedTitleRefresher({ fetched, isCurrent, onWatched }) {
  const base = watchedItemsRepository.getAll(2000).catch(() => []);
  let request = 0;
  let published = null;
  return async () => {
    const current = ++request;
    const baseItems = await base;
    const items = [...fetched.values()].flatMap((row) => row.result?.data?.items || []);
    const projected = items.length
      ? await watchedTitleStateRepository
          .getTitleWatchedItems(items, { baseWatchedItems: baseItems, limit: 2000 })
          .catch((error) => {
            console.warn("Home watched title projection failed", error);
            return baseItems;
          })
      : baseItems;
    if (current !== request || !isCurrent()) return;
    const ids = buildWatchedTitleIdSet(Array.isArray(projected) ? projected : baseItems);
    const key = [...ids].sort().join("\n");
    if (key === published) return;
    published = key;
    onWatched?.(ids);
  };
}

/**
 * Current Home cold VIDAA load (load-data): the last saved page one of each catalog, release
 * filtered, keyed like fetched rows. getSavedCatalog answers null off VIDAA.
 */
function savedCatalogRows(host, descriptors) {
  const saved = new Map();
  descriptors.forEach((catalog) => {
    const data = catalogRepository.getSavedCatalog(catalog);
    if (!data) return;
    const homeCatalogKey = buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId);
    saved.set(homeCatalogKey, {
      ...catalog,
      result: host.filterUnreleasedResult({ status: "success", data }),
      homeCatalogKey,
      homeCatalogDisableKey: buildCatalogDisableKey(
        catalog.addonBaseUrl,
        catalog.type,
        catalog.catalogId,
        catalog.catalogName
      )
    });
  });
  return saved;
}

/**
 * Current Home silent retry (retryPendingCatalogRows, 12 s per page, deferred batches) of every
 * row still loading, including a saved row whose page failed. Only pages that succeed come back.
 */
function retryPendingCatalogRows(host, { fetched, isCurrent, onRetried }) {
  host.rows = [...fetched.values()];
  // The tv2 screen picks its own hero; the retry's token check ends with this load.
  host.pickInitialHero = () => null;
  Object.defineProperty(host, "homeLoadToken", { get: () => isCurrent(), configurable: true });
  host.requestBackgroundRender = () =>
    host.rows.forEach((row) => {
      const previous = fetched.get(row.homeCatalogKey);
      if (row.result?.status === "success" && previous && previous.result?.status !== "success")
        // The retry's rows carry custom titles (sortAndFilterRows): keep the raw catalog name.
        onRetried({ ...row, catalogName: previous.catalogName });
    });
  host.retryPendingCatalogRows();
}

const continueWatchingFailed = (publish) => (error) => {
  console.warn("Continue watching load failed", error);
  publish(false);
};

/**
 * Current Home Continue Watching load (startHomeContinueWatchingLoad) without its render state:
 * getRecent is the list, all progress only seeds Next Up; raw items publish at once, enrichment
 * (meta, TMDB, Next Up) runs after `firstBatch`; an empty local list waits for the startup pull.
 */
async function loadContinueWatching(host, { isCurrent, firstBatch, publish, retry = false }) {
  const generation = (host.continueWatchingGeneration || 0) + 1;
  host.continueWatchingGeneration = generation;
  const sourceKey = watchProgressRepository.getContinueWatchingSourceKey();
  const current = () =>
    isCurrent() &&
    generation === host.continueWatchingGeneration &&
    watchProgressRepository.getContinueWatchingSourceKey() === sourceKey;
  const syncSource =
    watchProgressRepository.getContinueWatchingSource() === WatchProgressSource.NUVIO_SYNC;
  const pendingAtLoad = syncSource && StartupSyncService.isCurrentProfilePullPending();
  const errors = {};
  const [allProgress, recent, watchedItems] = await Promise.all([
    watchProgressRepository
      .getAllForContinueWatching()
      .catch((error) => ((errors.all = error), [])),
    watchProgressRepository
      .getRecent(CW_MAX_VISIBLE_ITEMS, { enrichMetadata: false })
      .catch((error) => ((errors.recent = error), [])),
    watchedItemsRepository.getAll(2000).catch(() => [])
  ]);
  if (!current()) return;
  const stillPending = syncSource && StartupSyncService.isCurrentProfilePullPending();
  const pull = syncSource ? StartupSyncService.getCurrentProfilePullPromise() : null;
  const pulledDuringLoad = pendingAtLoad && !stillPending;
  const remote = watchProgressRepository.getContinueWatchingRemoteProgressState();
  const hasLoadedRemoteProgress = Boolean(
    !errors.all &&
    !errors.recent &&
    !pendingAtLoad &&
    !stillPending &&
    remote?.sourceKey === sourceKey &&
    remote.loaded === true
  );
  const candidates = host
    .selectNextUpProgressCandidates(allProgress, recent, watchedItems, {
      ...getContinueWatchingNextUpSeedOptions(),
      nextUpFromFurthestEpisode: host.layoutPrefs.nextUpFromFurthestEpisode
    })
    .slice(0, CW_MAX_NEXT_UP_LOOKUPS);
  const hasWork = recent.length + candidates.length > 0;
  const hydrated = host.continueWatchingHydratedFromSnapshot;
  // Progress read during the startup pull is read again once it ends (current Home refreshAfterStartupPull).
  if (!retry && (pull || pulledDuringLoad)) {
    void Promise.resolve(pull)
      .catch(() => {})
      .then(
        () =>
          current() && loadContinueWatching(host, { isCurrent, firstBatch, publish, retry: true })
      )
      .catch(continueWatchingFailed(publish));
  }
  // Only an empty local list waits for the authoritative pull, like Android.
  if (
    !host.continueWatchingInitialResolved &&
    !hasWork &&
    (pull || pulledDuringLoad) &&
    !errors.all &&
    !errors.recent
  )
    return publish(true);
  if (!hydrated) {
    host.continueWatchingDisplay = buildVisibleContinueWatchingItems(recent, {
      requireArtwork: false
    });
    if (host.continueWatchingDisplay.length) host.persistContinueWatchingSnapshot();
    publish(hasWork && !host.continueWatchingDisplay.length);
  }
  host.continueWatchingInitialResolved = true;
  const protect = (nextCount) =>
    shouldProtectContinueWatchingDisplay({
      existingCount: hydrated ? host.continueWatchingDisplay.length : 0,
      nextCount,
      hasLoadedRemoteProgress
    });
  if (!hasWork) {
    if ((hydrated && (errors.all || errors.recent)) || protect(0)) return publish(false);
    host.continueWatchingDisplay = [];
    host.clearContinueWatchingSnapshot();
    return publish(false);
  }
  await firstBatch;
  if (!current()) return;
  try {
    const enriched = await host.enrichContinueWatching(recent, {
      allProgress,
      watchedItems,
      nextUpProgressCandidates: candidates
    });
    if (!current()) return;
    const strict = buildVisibleContinueWatchingItems(enriched, { requireArtwork: true });
    const complete = buildCompleteContinueWatchingDisplay(enriched);
    const loose = buildVisibleContinueWatchingItems(enriched, { requireArtwork: false });
    const next =
      strict.length === complete.length
        ? strict
        : loose.length >= complete.length
          ? loose
          : complete;
    if (protect(next.length)) return publish(false);
    host.continueWatchingDisplay = next;
    if (next.length) host.persistContinueWatchingSnapshot();
    else host.clearContinueWatchingSnapshot();
  } catch (error) {
    console.warn("Continue watching async enrichment failed", error);
  }
  publish(false);
}

const collectionItems = new WeakMap();

/** Current Home collection row (buildCollectionHomeRow) as a new Home row; items kept per collection. */
function collectionRow(row) {
  if (!collectionItems.has(row.collection))
    collectionItems.set(row.collection, row.result.data.items);
  const items = collectionItems.get(row.collection);
  return {
    key: row.homeCatalogKey,
    kind: "collection",
    title: String(row.collectionTitle || row.collection?.title || "Collection"),
    items,
    status: "success",
    entry: row,
    // shortcut: one tile shape per row (the first folder's), upgrade railWindow to per-item pitch if rows mix shapes.
    tileShape: items[0]?.tileShape
  };
}

const catalogItems = new WeakMap();

/** Catalog items as cards: they carry their addon and catalog type for Detail. */
const catalogCards = (row, items) =>
  items.map((item) => ({
    ...item,
    addonBaseUrl: row.addonBaseUrl,
    addonId: row.addonId,
    addonName: row.addonName,
    catalogType: row.type
  }));

/** Cards and pagination state of a catalog row's current page data; cards mapped once per page. */
function catalogPage(row) {
  const data = row.result?.data || {};
  if (!catalogItems.has(row.result))
    catalogItems.set(row.result, catalogCards(row, data.items || []));
  return {
    items: catalogItems.get(row.result),
    hasMore: Boolean(data.hasMore),
    nextSkip: Number(data.nextSkip || 0),
    supportsSkip: row.supportsSkip !== false && data.supportsSkip !== false
  };
}

/** Current Home catalog row ({...descriptor, result}) as a new Home row. */
function catalogRow(row, showTypeSuffix) {
  return {
    key: row.homeCatalogKey,
    kind: "poster",
    title: formatCatalogRowTitle(row.catalogName, row.type, showTypeSuffix),
    // A failed or timed-out page stays "loading" (D1), never an error.
    status: row.result?.status === "success" ? "success" : "loading",
    // Skeleton cards drawn while loading (current Home buildCatalogLoadingItems count).
    loadingCount: row.loadingItems?.length || 0,
    entry: row,
    ...catalogPage(row),
    skipStep: Number(row.skipStep || row.result?.data?.skipStep || 100)
  };
}

/**
 * Next page of a catalog row (current Home modern pagination, methods-29), merged into its shared
 * page data like the current Home, so later emits keep it. Returns the row's new cards and
 * pagination state plus `added`, or null for a stale load or a failed page.
 */
export async function loadNextCatalogPage(entry, { isCurrent = () => true } = {}) {
  const result = entry.result;
  const payload = result.data;
  const skip = catalogPageSkip(payload);
  const page = await catalogRepository.getCatalog({
    addonBaseUrl: entry.addonBaseUrl || "",
    addonId: entry.addonId || "",
    addonName: entry.addonName || "",
    catalogId: entry.catalogId || "",
    catalogName: entry.catalogName || "",
    type: entry.type || "movie",
    skip,
    skipStep: entry.skipStep,
    supportsSkip: entry.supportsSkip !== false
  });
  if (!isCurrent() || page?.status !== "success") return null;
  const cards = catalogItems.get(result);
  const { patch, newItems } = mergeCatalogPage(payload, page, skip);
  Object.assign(payload, patch);
  if (cards) catalogItems.set(result, [...cards, ...catalogCards(entry, newItems)]);
  return { ...catalogPage(entry), added: newItems.length };
}
