import * as internals from "./homeScreenContext.js";

/**
 * Catalog requests of the Home, shared by the current Home (loadData) and the new one (nuv-091):
 * `unique` keeps manifest order (saved snapshots), `visible` drops disabled catalogs and follows
 * the user's order. Seeds missing order keys in HomeCatalogStore, as loadData always did.
 */
export function buildVisibleHomeCatalogDescriptors(addons = []) {
  const {
    HomeCatalogStore,
    buildCatalogDisableKey,
    buildCatalogOrderKey,
    catalogShouldShowOnHome,
    catalogSkipStep,
    catalogSupportsExtra,
    HOME_PERF_DEBUG,
    logHomePerf
  } = internals;
  const catalogDescriptors = [];

  addons.forEach((addon) => {
    addon.catalogs
      .filter((catalog) => catalogShouldShowOnHome(catalog))
      .forEach((catalog) => {
        catalogDescriptors.push({
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName,
          catalogId: catalog.id,
          catalogName: catalog.name,
          type: catalog.apiType,
          supportsSkip: catalogSupportsExtra(catalog, "skip"),
          skipStep: catalogSkipStep(catalog)
        });
      });
  });

  // Installed-addon state can contain the same manifest catalog more than
  // once. Collapse only descriptors that would issue the exact same request;
  // addons that reuse ids on different base URLs must retain the existing
  // last-row-wins behavior.
  const seenCatalogDescriptors = new Set();
  const uniqueCatalogDescriptors = catalogDescriptors.filter((descriptor) => {
    const descriptorKey = JSON.stringify([
      descriptor?.addonBaseUrl || "",
      descriptor?.addonId || "",
      descriptor?.addonName || "",
      descriptor?.catalogId || "",
      descriptor?.catalogName || "",
      descriptor?.type || ""
    ]);
    if (seenCatalogDescriptors.has(descriptorKey)) {
      return false;
    }
    seenCatalogDescriptors.add(descriptorKey);
    return true;
  });
  if (HOME_PERF_DEBUG) {
    logHomePerf("catalogDescriptors", {
      requested: catalogDescriptors.length,
      unique: uniqueCatalogDescriptors.length,
      duplicates: catalogDescriptors.length - uniqueCatalogDescriptors.length
    });
  }

  // Seed missing order keys from manifest order before progressive requests
  // can add rows in network-completion order.
  const orderedCatalogKeys = HomeCatalogStore.ensureOrderKeys(
    uniqueCatalogDescriptors.map((catalog) =>
      buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId)
    )
  );
  const catalogOrder = new Map(orderedCatalogKeys.map((key, index) => [key, index]));
  const disabledCatalogKeys = new Set(HomeCatalogStore.get().disabled || []);
  // Choose the first batch from the surface the user will actually see.
  // A hidden catalog or a late manifest entry moved to the top of Home
  // must not wait behind unrelated requests (and their timeout barrier).
  const visibleCatalogDescriptors = uniqueCatalogDescriptors
    .map((catalog, manifestIndex) => ({
      catalog,
      manifestIndex,
      orderKey: buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId),
      disableKey: buildCatalogDisableKey(
        catalog.addonBaseUrl,
        catalog.type,
        catalog.catalogId,
        catalog.catalogName
      )
    }))
    .filter(
      ({ orderKey, disableKey }) =>
        !disabledCatalogKeys.has(orderKey) && !disabledCatalogKeys.has(disableKey)
    )
    .sort(
      (left, right) =>
        catalogOrder.get(left.orderKey) - catalogOrder.get(right.orderKey) ||
        left.manifestIndex - right.manifestIndex
    )
    .map(({ catalog }) => catalog);

  return { uniqueCatalogDescriptors, visibleCatalogDescriptors };
}
