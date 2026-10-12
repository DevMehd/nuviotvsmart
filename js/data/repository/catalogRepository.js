import { safeApiCall } from "../../core/network/safeApiCall.js";
import { selectCatalogEntries } from "../../core/util/catalogEntryMapper.js";
import { CatalogApi } from "../remote/api/catalogApi.js";
import { addonRepository } from "./addonRepository.js";
import { BoundedMap } from "../../core/storage/boundedMap.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { CatalogSnapshotStore } from "../local/catalogSnapshotStore.js";
import { Platform } from "../../platform/index.js";

class CatalogRepository {
  constructor() {
    this.catalogCache = new BoundedMap(80);
    this.catalogPending = new Map();
    this.catalogTimes = new BoundedMap(80);
    this.cacheGeneration = 0;
  }

  async getCatalog({
    addonBaseUrl,
    addonId,
    addonName,
    catalogId,
    catalogName,
    type,
    skip = 0,
    skipStep = 100,
    extraArgs = {},
    supportsSkip = false,
    signal = null
  }) {
    const normalizedSkipStep = this.normalizeSkipStep(skipStep);
    const cacheKey = this.buildCacheKey({
      addonBaseUrl,
      addonId,
      type,
      catalogId,
      skip,
      skipStep: normalizedSkipStep,
      extraArgs,
      supportsSkip
    });

    const cached = this.catalogCache.get(cacheKey);
    if (cached && Date.now() - (this.catalogTimes.get(cacheKey) || 0) < 120000) {
      return {
        status: "success",
        data: cached
      };
    }

    // Abortable searches retain their own request; one caller must never
    // cancel another screen's shared request.
    if (!signal && this.catalogPending.has(cacheKey)) return this.catalogPending.get(cacheKey);

    const url = this.buildCatalogUrl({
      baseUrl: addonBaseUrl,
      type,
      catalogId,
      skip,
      extraArgs
    });

    const cacheGeneration = this.cacheGeneration;
    const request = safeApiCall(() =>
      CatalogApi.getCatalog(url, signal ? { signal } : {}).then((dto) => {
        const { metas, rawItemCount } = selectCatalogEntries(dto?.metas);
        const items = metas.map((meta) => ({
          ...this.mapMeta(meta),
          addonBaseUrl,
          addonId,
          addonName,
          catalogType: type
        }));

        const hasMore = Boolean(supportsSkip && rawItemCount > 0);
        const row = {
          addonId,
          addonName,
          addonBaseUrl,
          catalogId,
          catalogName,
          apiType: type,
          items,
          isLoading: false,
          hasMore,
          currentPage: Math.floor(skip / normalizedSkipStep),
          supportsSkip,
          skipStep: normalizedSkipStep,
          nextSkip: hasMore ? skip + rawItemCount : skip
        };

        if (cacheGeneration === this.cacheGeneration) {
          this.catalogCache.set(cacheKey, row);
          this.catalogTimes.set(cacheKey, Date.now());
          if (Platform.isVidaa() && skip === 0 && !Object.keys(extraArgs).length)
            CatalogSnapshotStore.put(cacheKey, row);
        }
        return row;
      })
    );
    if (!signal) this.catalogPending.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.catalogPending.get(cacheKey) === request) this.catalogPending.delete(cacheKey);
    }
  }

  clearCache() {
    this.cacheGeneration += 1;
    this.catalogCache.clear();
    this.catalogTimes.clear();
    this.catalogPending.clear();
  }

  getSavedCatalog(descriptor) {
    if (!Platform.isVidaa()) return null;
    return CatalogSnapshotStore.get(
      this.buildCacheKey({
        ...descriptor,
        skip: 0,
        skipStep: this.normalizeSkipStep(descriptor.skipStep),
        extraArgs: {},
        supportsSkip: descriptor.supportsSkip !== false
      })
    );
  }

  buildCatalogUrl({ baseUrl, type, catalogId, skip = 0, extraArgs = {} }) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    const args = { ...extraArgs };

    if (Object.keys(args).length === 0) {
      return skip > 0
        ? `${basePath}/catalog/${type}/${catalogId}/skip=${skip}.json${baseQuery}`
        : `${basePath}/catalog/${type}/${catalogId}.json${baseQuery}`;
    }

    if (skip > 0 && !Object.prototype.hasOwnProperty.call(args, "skip")) {
      args.skip = String(skip);
    }

    const query = Object.entries(args)
      .map(([key, value]) => `${this.encodeArg(key)}=${this.encodeArg(String(value))}`)
      .join("&");

    return `${basePath}/catalog/${type}/${catalogId}/${query}.json${baseQuery}`;
  }

  buildCacheKey({
    addonBaseUrl = "",
    addonId,
    type,
    catalogId,
    skip = 0,
    skipStep = 100,
    extraArgs = {},
    supportsSkip = false
  }) {
    const normalizedArgs = Object.entries(extraArgs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    return JSON.stringify([
      String(ProfileManager.getActiveProfileId() || "1"),
      addonRepository.canonicalizeUrl(addonBaseUrl),
      addonId,
      type,
      catalogId,
      skip,
      skipStep,
      supportsSkip,
      normalizedArgs
    ]);
  }

  normalizeSkipStep(value = 100) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.trunc(numericValue) : 100;
  }

  encodeArg(value) {
    return encodeURIComponent(value).replace(/\+/g, "%20");
  }

  mapMeta(meta = {}) {
    return {
      id: meta.id || "",
      name: meta.name || "Untitled",
      type: meta.type || "",
      poster: meta.poster || null,
      background: meta.background || null,
      logo: meta.logo || null,
      description: meta.description || "",
      releaseInfo: meta.releaseInfo || "",
      runtime: meta.runtime ?? null,
      genres: Array.isArray(meta.genres) ? meta.genres : []
    };
  }
}

export const catalogRepository = new CatalogRepository();
