import { addonRepository } from "../../data/repository/addonRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { Platform } from "../../platform/index.js";
import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";
import { normalizeContinueWatchingItem } from "../screens/home/homeScreenHelpers-09-normalize-continue-watching-item.js";
import { t } from "../screens/home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { buildVisibleHomeCatalogDescriptors } from "../screens/home/homeCatalogDescriptors.js";
import { HOME_ADDON_MANIFEST_TIMEOUT_MS } from "../screens/home/homeConstants.js";
import { formatCatalogRowTitle } from "../screens/home/homeUtils.js";
import { personalHomeRows } from "../screens/perso/personalUi.js";
import { createHomeDataHost } from "./homeDataHost.js";

// Rows of the new TV Home (nuv-091), without DOM: {key, kind, title, items, status, ...}.

export const HOME_MODEL_LIMITS = Object.freeze({
  continueWatching: 20
});

export function continueWatchingRow(progressItems = []) {
  const items = [...progressItems]
    .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    .map(normalizeContinueWatchingItem)
    .filter((item) => item?.id)
    .slice(0, HOME_MODEL_LIMITS.continueWatching);
  return {
    key: "continue_watching",
    kind: "continue",
    title: t("home.continueWatching", {}, "Continue Watching"),
    items,
    status: "success"
  };
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
  const emit = (next) => {
    if (!isCurrent()) return false;
    rows = next;
    onRows?.(rows);
    return true;
  };

  const progress = await watchProgressRepository.getAllForContinueWatching().catch(() => []);
  const continueRow = continueWatchingRow(progress);
  if (!emit([continueRow, ...personalRows()])) return rows;

  const host = createHomeDataHost({ layoutPrefs: LayoutPreferences.get() });
  const addons = await addonRepository
    .getInstalledAddons({
      includeMediaServers: true,
      staleWhileRevalidate: true,
      timeoutMs: HOME_ADDON_MANIFEST_TIMEOUT_MS
    })
    .catch(() => []);
  if (!isCurrent()) return rows;
  const { visibleCatalogDescriptors } = buildVisibleHomeCatalogDescriptors(addons);
  const showTypeSuffix = host.layoutPrefs.catalogTypeSuffixEnabled !== false;
  const fetched = new Map();
  // Same batches as the current Home: visible first in parallel, then deferred batches.
  const options = {
    allowLoading: true,
    shouldContinue: isCurrent,
    onRow: (row) => {
      fetched.set(row.homeCatalogKey, row);
      const ordered = host.sortAndFilterRows([...fetched.values()], host.collections);
      const catalogRows = ordered
        .map((catalog) => catalogRow(catalog, showTypeSuffix))
        .filter((catalog) => catalog.status !== "success" || catalog.items.length);
      emit([continueRow, ...personalRows(), ...catalogRows]);
    }
  };
  const initialCount = host.getInitialCatalogLoadCount();
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(0, initialCount), options);
  await host.fetchCatalogRows(visibleCatalogDescriptors.slice(initialCount), {
    ...options,
    batchSize: host.getDeferredCatalogBatchSize(),
    isBusy: () => Platform.isVidaa() && isVidaaNavigationBusy(),
    batchYieldMs: Platform.isVidaa() ? 120 : 0
  });
  return rows;
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
