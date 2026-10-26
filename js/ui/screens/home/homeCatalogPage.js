// Catalog pagination data shared by the current Home and the new Home (nuv-091): no DOM.

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
