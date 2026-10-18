import { MediaServerRepository, isMediaServerBase } from "../mediaserver/mediaServerRepository.js";
import { safeApiCall } from "../../core/network/safeApiCall.js";
import { selectCatalogEntries } from "../../core/util/catalogEntryMapper.js";
import { CatalogApi } from "../remote/api/catalogApi.js";
import { addonRepository } from "./addonRepository.js";

function catalogAbortError() {
  const error = new Error("Catalog request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfCatalogAborted(signal) {
  if (signal?.aborted) throw catalogAbortError();
}

async function waitForCatalogResult(request, signal) {
  if (signal?.aborted) {
    // A transport can synchronously abort while creating its Promise. Observe
    // that Promise even though this consumer has already retired.
    Promise.resolve(request).catch(() => {});
    throw catalogAbortError();
  }
  if (!signal) return request;
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(catalogAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([request, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

class CatalogRepository {
  constructor() {
    this.catalogCache = new Map();
    this.inFlightCatalogs = new Map();
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
    if (signal?.aborted) return safeApiCall(() => Promise.reject(catalogAbortError()));
    if (isMediaServerBase(addonBaseUrl))
      return MediaServerRepository.catalog({
        addonBaseUrl,
        catalogId,
        type,
        skip,
        extraArgs,
        signal
      });
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
    if (cached) {
      return {
        status: "success",
        data: cached
      };
    }

    let inFlightBySignal = this.inFlightCatalogs.get(cacheKey);
    if (inFlightBySignal?.has(signal)) return inFlightBySignal.get(signal);

    const url = this.buildCatalogUrl({
      baseUrl: addonBaseUrl,
      type,
      catalogId,
      skip,
      extraArgs
    });

    const cacheGeneration = this.cacheGeneration;
    const request = safeApiCall(async () => {
      const dto = await waitForCatalogResult(
        CatalogApi.getCatalog(url, signal ? { signal } : {}),
        signal
      );
      throwIfCatalogAborted(signal);
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

      if (cacheGeneration === this.cacheGeneration) this.catalogCache.set(cacheKey, row);
      return row;
    });
    if (!inFlightBySignal) {
      inFlightBySignal = new Map();
      this.inFlightCatalogs.set(cacheKey, inFlightBySignal);
    }
    // Home retries and route transitions may request a still-loading row. Only
    // consumers with the same cancellation lifetime may share the native request.
    inFlightBySignal.set(signal, request);
    try {
      return await request;
    } finally {
      if (inFlightBySignal.get(signal) === request) inFlightBySignal.delete(signal);
      if (!inFlightBySignal.size && this.inFlightCatalogs.get(cacheKey) === inFlightBySignal) {
        this.inFlightCatalogs.delete(cacheKey);
      }
    }
  }

  clearCache() {
    this.cacheGeneration += 1;
    this.catalogCache.clear();
    this.inFlightCatalogs.clear();
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
