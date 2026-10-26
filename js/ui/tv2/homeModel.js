import { addonRepository } from "../../data/repository/addonRepository.js";
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
  shouldProtectContinueWatchingDisplay
} from "../screens/home/homeScreenContext.js";
import { t } from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { buildVisibleHomeCatalogDescriptors } from "../screens/home/homeCatalogDescriptors.js";
import { HOME_ADDON_MANIFEST_TIMEOUT_MS } from "../screens/home/homeConstants.js";
import { formatCatalogRowTitle } from "../screens/home/homeUtils.js";
import { personalHomeRows } from "../screens/perso/personalUi.js";
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
 * (profile change, remount) discard this one.
 */
export async function loadHomeRows({ onRows, isCurrent = () => true } = {}) {
  let rows = [];
  let continueRows = [];
  let catalogRows = [];
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

  const addons = await addonRepository
    .getInstalledAddons({
      includeMediaServers: true,
      staleWhileRevalidate: true,
      timeoutMs: HOME_ADDON_MANIFEST_TIMEOUT_MS
    })
    .catch(() => []);
  if (!isCurrent()) return rows;
  host.collections = CollectionsStore.get();
  const { visibleCatalogDescriptors } = buildVisibleHomeCatalogDescriptors(addons);
  const showTypeSuffix = host.layoutPrefs.catalogTypeSuffixEnabled !== false;
  const fetched = new Map();
  // Current Home order: pinned collections, then catalogs and collections in store order.
  const emitOrdered = () => {
    catalogRows = host
      .sortAndFilterRows([...fetched.values()], host.collections)
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
      emitOrdered();
    }
  };
  const initialCount = host.getInitialCatalogLoadCount();
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(0, initialCount), options);
  releaseEnrichment();
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(initialCount), {
    ...options,
    batchSize: host.getDeferredCatalogBatchSize(),
    isBusy: () => Platform.isVidaa() && isVidaaNavigationBusy(),
    batchYieldMs: Platform.isVidaa() ? 120 : 0
  });
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

/** Current Home catalog row ({...descriptor, result}) as a new Home row; items mapped once per page. */
function catalogRow(row, showTypeSuffix) {
  const data = row.result?.data || {};
  if (!catalogItems.has(row.result)) {
    catalogItems.set(
      row.result,
      (data.items || []).map((item) => ({
        ...item,
        addonBaseUrl: row.addonBaseUrl,
        addonId: row.addonId,
        addonName: row.addonName,
        catalogType: row.type
      }))
    );
  }
  return {
    key: row.homeCatalogKey,
    kind: "poster",
    title: formatCatalogRowTitle(row.catalogName, row.type, showTypeSuffix),
    items: catalogItems.get(row.result),
    // A failed or timed-out page stays "loading" (D1), never an error.
    status: row.result?.status === "success" ? "success" : "loading",
    entry: row,
    hasMore: Boolean(data.hasMore),
    nextSkip: Number(data.nextSkip || 0),
    supportsSkip: row.supportsSkip !== false && data.supportsSkip !== false,
    skipStep: Number(row.skipStep || data.skipStep || 100)
  };
}
