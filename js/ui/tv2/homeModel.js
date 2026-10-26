import { addonRepository } from "../../data/repository/addonRepository.js";
import { catalogRepository } from "../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { HomeCatalogStore } from "../../data/local/homeCatalogStore.js";
import { buildOrderedHomeCatalogItems } from "../../core/addons/homeCatalogs.js";
import { normalizeContinueWatchingItem } from "../screens/home/homeScreenHelpers-09-normalize-continue-watching-item.js";
import { personalHomeRows } from "../screens/perso/personalUi.js";

// Rows of the new TV Home (nuv-091), without DOM: {key, kind, title, items, status}.

export const HOME_MODEL_LIMITS = Object.freeze({
  catalogs: 10,
  continueWatching: 20,
  catalogItems: 30
});

/** Visible home catalogs in the user's order, bounded like the current Home's first batch. */
export function homeCatalogEntries(
  addons,
  store = HomeCatalogStore.get(),
  limit = HOME_MODEL_LIMITS.catalogs
) {
  return buildOrderedHomeCatalogItems(addons, [], store.order, store.disabled, store.customTitles)
    .filter((entry) => !entry.isDisabled)
    .slice(0, limit);
}

export function continueWatchingRow(progressItems = []) {
  const items = [...progressItems]
    .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    .map(normalizeContinueWatchingItem)
    .filter((item) => item?.id)
    .slice(0, HOME_MODEL_LIMITS.continueWatching);
  return {
    key: "continue_watching",
    kind: "continue",
    title: "Continuer à regarder",
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

  const addons = await addonRepository
    .getInstalledAddons({ staleWhileRevalidate: true })
    .catch(() => []);
  const entries = homeCatalogEntries(addons);
  const catalogRows = entries.map((entry) => ({
    key: entry.key,
    kind: "poster",
    title: entry.catalogName,
    items: [],
    status: "loading",
    entry
  }));
  if (!emit([continueRow, ...personalRows(), ...catalogRows])) return rows;

  for (const row of catalogRows) {
    const { entry } = row;
    const result = await catalogRepository
      .getCatalog({
        addonBaseUrl: entry.addonBaseUrl,
        addonId: entry.addonId,
        addonName: entry.addonName,
        catalogId: entry.catalogId,
        catalogName: entry.originalCatalogName,
        type: entry.type,
        skip: 0
      })
      .catch(() => null);
    row.items = (result?.data?.items || [])
      .slice(0, HOME_MODEL_LIMITS.catalogItems)
      .map((item) => ({
        ...item,
        addonBaseUrl: entry.addonBaseUrl,
        addonId: entry.addonId,
        addonName: entry.addonName,
        catalogType: entry.type
      }));
    row.status = result?.status === "success" ? "success" : "error";
    if (!emit([continueRow, ...personalRows(), ...catalogRows])) return rows;
  }
  return rows;
}
