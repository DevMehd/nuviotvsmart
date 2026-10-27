// Catalog pagination data shared by the current Home and the new Home (nuv-091): no DOM.

import { HOME_MAX_ITEMS_PER_ROW_DEFAULT } from "./homeConstants.js";

/** Skip of the next page: the stored nextSkip when past the loaded items, else their count. */
export function catalogPageSkip(rowPayload) {
  const count = Array.isArray(rowPayload?.items) ? rowPayload.items.length : 0;
  const storedNextSkip = Number(rowPayload?.nextSkip);
  return Number.isFinite(storedNextSkip) && storedNextSkip > count
    ? Math.trunc(storedNextSkip)
    : count;
}

/**
 * Next catalog page merged into a row payload (current Home track pagination): `patch` holds the
 * payload fields to assign (only `hasMore: false` for an empty page), `newItems` the cards to add
 * after dropping ids already shown. `latestItems` defaults to the payload's items.
 */
export function mergeCatalogPage(rowPayload, result, skip, latestItems = rowPayload?.items) {
  const items = Array.isArray(latestItems) ? latestItems : [];
  const incomingItems = Array.isArray(result?.data?.items) ? result.data.items : [];
  if (!incomingItems.length) return { patch: { hasMore: false }, newItems: [] };
  const seenIds = new Set(items.map((item) => String(item?.id || "").trim()).filter(Boolean));
  const newItems = incomingItems.filter((item) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) {
      return true;
    }
    if (seenIds.has(itemId)) {
      return false;
    }
    seenIds.add(itemId);
    return true;
  });
  const reportedNextSkip = Number(result.data?.nextSkip);
  const nextSkip =
    Number.isFinite(reportedNextSkip) && reportedNextSkip > skip
      ? Math.trunc(reportedNextSkip)
      : skip + incomingItems.length;
  const supportsSkip = result.data?.supportsSkip !== false;
  return {
    patch: {
      items: [...items, ...newItems],
      supportsSkip,
      hasMore: supportsSkip && (result.data?.hasMore ?? newItems.length > 0),
      currentPage: result.data?.currentPage ?? rowPayload?.currentPage,
      nextSkip
    },
    newItems
  };
}

/** Route params of the catalogSeeAll screen for a catalog row ({...descriptor, result}). */
export function buildCatalogSeeAllPayload(rowData) {
  const catalogResultData = rowData?.result?.data || {};
  return {
    addonBaseUrl: rowData?.addonBaseUrl || "",
    addonId: rowData?.addonId || "",
    addonName: rowData?.addonName || "",
    catalogId: rowData?.catalogId || "",
    catalogName: rowData?.catalogName || "",
    type: rowData?.type || "movie",
    initialItems: Array.isArray(catalogResultData.items) ? catalogResultData.items : [],
    initialNextSkip: Number(catalogResultData.nextSkip || 0),
    initialHasMore: Boolean(catalogResultData.hasMore),
    supportsSkip: rowData?.supportsSkip !== false && catalogResultData.supportsSkip !== false,
    skipStep: Number(rowData?.skipStep || catalogResultData.skipStep || 100)
  };
}

/**
 * Classic/grid row rules of the current Home (renderLegacyCatalogRowsMarkup): the "from {addon}"
 * subtitle, the item cap, the See All card and the count of cards shown before it.
 */
export function legacyRowPlan(
  rowData,
  { layoutMode, rowItemLimit, gridMaxDisplayItems, showCatalogAddonName }
) {
  const isCollectionRow = rowData?.rowKind === "collection";
  const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
  const isLoading = rowData?.result?.status === "loading";
  const subtitle =
    layoutMode === "classic" && showCatalogAddonName && rowData.addonName
      ? `from ${rowData.addonName}`
      : "";
  const maxItems = Math.max(
    1,
    Number(
      layoutMode === "grid" ? gridMaxDisplayItems : rowItemLimit || HOME_MAX_ITEMS_PER_ROW_DEFAULT
    )
  );
  const hasSeeAll =
    !isCollectionRow &&
    !isLoading &&
    (layoutMode === "grid"
      ? Boolean(rowData?.result?.data?.hasMore) || items.length > maxItems
      : Boolean(rowData?.result?.data?.hasMore) || items.length >= 15);
  const gridLimit = Math.max(1, hasSeeAll ? maxItems - 1 : maxItems);
  const visibleCount = isCollectionRow ? Infinity : layoutMode === "grid" ? gridLimit : maxItems;
  return { subtitle, maxItems, hasSeeAll, gridLimit, visibleCount };
}

/**
 * Content cards a grid section keeps (Android GridHomeContent): at most rowCount lines and
 * maxDisplayItems cards, See All included.
 */
export function gridVisibleCount({
  contentCount,
  hasSeeAll,
  columnCount,
  rowCount,
  maxDisplayItems
}) {
  const maxDisplaySlots = Math.min(maxDisplayItems, columnCount * rowCount);
  const maxContentCards = hasSeeAll ? Math.max(0, maxDisplaySlots - 1) : maxDisplaySlots;
  const visible = Math.min(contentCount, maxContentCards);
  // Android removes one content card when See All would otherwise be the
  // only item on the last row. This keeps D-pad row geometry identical to
  // GridHomeContent while retaining the full row in the route state.
  return hasSeeAll && columnCount > 1 && visible >= columnCount && (visible + 1) % columnCount === 1
    ? visible - 1
    : visible;
}
