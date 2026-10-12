// Local-only catalogue pages. Keys include the exact addon configuration and
// profile; a changed installation cannot restore another configuration's rows.
export function createCatalogSnapshotStore(
  storage = () => globalThis.localStorage,
  now = Date.now
) {
  const key = "vidaa_catalog_snapshots_v1";
  const maxCharacters = 260000;
  let entries = null;
  let timer = null;
  const read = () => {
    if (entries) return entries;
    try {
      const text = storage()?.getItem(key) || "[]";
      entries = text.length <= maxCharacters ? JSON.parse(text) : [];
    } catch {
      entries = [];
    }
    if (!Array.isArray(entries)) entries = [];
    entries = entries.filter(
      (entry) => entry && now() - entry.at < 86400000 && entry.row?.items?.length
    );
    return entries;
  };
  const flush = () => {
    timer = null;
    try {
      storage()?.setItem(key, JSON.stringify(read()));
    } catch {
      /* Quota failure must not block browsing. */
    }
  };
  return {
    get(cacheKey) {
      const row = read().find(
        (entry) => entry.key === cacheKey && now() - entry.at < 86400000
      )?.row;
      return row
        ? {
            ...row,
            items: row.items.map((item) => ({
              ...item,
              addonBaseUrl: row.addonBaseUrl,
              addonId: row.addonId,
              addonName: row.addonName,
              catalogType: row.apiType
            }))
          }
        : null;
    },
    put(cacheKey, row) {
      if (!row?.items?.length) return;
      // Keep complete pages, otherwise a persisted nextSkip could skip items.
      const entry = {
        key: cacheKey,
        at: now(),
        row: {
          ...row,
          items: row.items.map(
            ({ addonBaseUrl: _url, addonId: _id, addonName: _name, catalogType: _type, ...item }) =>
              item
          )
        }
      };
      if (JSON.stringify(entry).length > 90000) return;
      entries = [...read().filter((item) => item.key !== cacheKey), entry].slice(-24);
      while (entries.length && JSON.stringify(entries).length > maxCharacters) entries.shift();
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 1200);
      timer?.unref?.();
    },
    flush,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      entries = [];
      try {
        storage()?.removeItem(key);
      } catch {}
    }
  };
}

export const CatalogSnapshotStore = createCatalogSnapshotStore();
