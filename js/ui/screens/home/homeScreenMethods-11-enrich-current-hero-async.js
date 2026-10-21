import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";
import * as internals from "./homeScreenContext.js";
import { homeMetadataSettingsSignature, isHomeTmdbEnabled } from "./homeMetadataSettings.js";
import { resolveHomeTmdbLookupId } from "./homeMetadataIds.js";
import { setHomeCollectionFocusGif } from "./homeCollectionFocusGif.js";

export function createHomeScreenMethods11() {
  const {
    Router,
    Platform,
    LayoutPreferences,
    TmdbSettingsStore,
    metaRepository,
    mdbListRepository,
    shouldPreserveHomeRuntimeText,
    firstNonEmpty,
    resolveImdbRating,
    preloadImageSource,
    parseRuntimeMinutes,
    normalizeCollectionFolderItem,
    fetchModernHeroTmdbEnrichment,
    buildHeroIdentity,
    buildModernHeroPresentation
  } = internals;

  return {
    async enrichCurrentHeroAsync(hero, focusToken = Number(this.heroFocusToken || 0), options = {}) {
      if (!hero || !hero.id || hero.heroSource === "continueWatching" || hero.heroSource === "collection") {
        return;
      }
      const itemId = String(hero.id);
      const itemType = String(hero.type || hero.apiType || "movie");
      const heroIdentity = buildHeroIdentity(hero);
      const settingsSignature = homeMetadataSettingsSignature();
      const pendingKey = JSON.stringify([heroIdentity, settingsSignature, focusToken]);
      if (this.pendingHeroEnrichmentKey === pendingKey) {
        return;
      }
      this.pendingHeroEnrichmentKey = pendingKey;
      this.heroEnrichmentAbortController?.abort?.();
      const abortController = typeof AbortController === "function" ? new AbortController() : null;
      this.heroEnrichmentAbortController = abortController;
      const signal = abortController?.signal || null;
      const deferCommit = Boolean(options?.deferCommit);
      const isVidaa = Platform.isVidaa();
      const token = (this.heroEnrichmentToken = Number(this.heroEnrichmentToken || 0) + 1);
      const canCommitHero = () => {
        if (signal?.aborted) return false;
        if (Router.getCurrent() !== String(options?.routeName || "home")) {
          return false;
        }
        if (Number(this.heroEnrichmentToken) !== token) {
          return false;
        }
        if (Number(this.heroFocusToken || 0) !== Number(focusToken || 0)) {
          return false;
        }
        if (homeMetadataSettingsSignature() !== settingsSignature) {
          return false;
        }
        if (isVidaa && (this.layoutMode === "modern" || deferCommit)) {
          const focusedHero = this.getNodeHeroSource(this.getCurrentFocusedNode());
          if (buildHeroIdentity(focusedHero) !== heroIdentity) {
            return false;
          }
        }
        if (!deferCommit) {
          return buildHeroIdentity(this.heroItem) === heroIdentity;
        }
        if (Router.getCurrent() !== String(options?.routeName || "home")) {
          return false;
        }
        const focusedHero = this.getNodeHeroSource(this.getCurrentFocusedNode());
        return buildHeroIdentity(focusedHero) === heroIdentity;
      };
      let resultRevision = 0;
      const commitHero = async (resolvedHero, revision) => {
        if (isVidaa && !(await this.waitForVidaaHomeLoadingIdle(canCommitHero))) {
          return false;
        }
        if (deferCommit && !isVidaa) {
          const display = buildModernHeroPresentation(resolvedHero);
          await Promise.all([preloadImageSource(display?.backdrop), preloadImageSource(display?.logo)]);
        }
        if (isVidaa && !(await this.waitForVidaaHomeLoadingIdle(canCommitHero))) {
          return false;
        }
        if (!canCommitHero() || revision !== resultRevision) {
          return false;
        }
        this.heroItem = resolvedHero;
        const matchedIndex = (this.heroCandidates || []).findIndex(
          (item) => String(item?.id || "") === itemId && buildHeroIdentity(item) === heroIdentity
        );
        if (matchedIndex >= 0) {
          this.heroIndex = matchedIndex;
        }
        this.mergeHeroIntoCatalogState(itemId, resolvedHero);
        this.applyHeroToDom();
        return true;
      };
      if (isVidaa && (!(await this.waitForVidaaHomeLoadingIdle(canCommitHero)) || !canCommitHero())) {
        if (this.pendingHeroEnrichmentKey === pendingKey) this.pendingHeroEnrichmentKey = "";
        if (this.heroEnrichmentAbortController === abortController) this.heroEnrichmentAbortController = null;
        return;
      }
      let latestMetadataResult = null;
      let latestTmdbEnrichment = null;
      let tmdbSettled = false;
      const tmdbSettings = TmdbSettingsStore.get();
      const waitForLocalizedTmdb = Boolean(
        isHomeTmdbEnabled(this.layoutMode || "modern", tmdbSettings) &&
        (tmdbSettings.useBasicInfo || tmdbSettings.useArtwork) &&
        !String(tmdbSettings.language || "en")
          .toLowerCase()
          .startsWith("en")
      );
      let mdbImdbRating = null;
      let sourcesSettled = false;
      const publishLatestResults = async () => {
        // Do not reveal addon/rating metadata in English while the preferred
        // TMDB preview is still pending. Release the fallback when TMDB settles.
        if (waitForLocalizedTmdb && !tmdbSettled) return false;
        const revision = ++resultRevision;
        const meta = latestMetadataResult?.status === "success" ? latestMetadataResult.data : null;
        const tmdbEnrichment = latestTmdbEnrichment;
        if (!canCommitHero()) {
          return false;
        }
        const enrichedImdb = meta ? resolveImdbRating(meta) : null;
        const settings = TmdbSettingsStore.get();
        const sourceHero = buildHeroIdentity(this.heroItem) === heroIdentity ? this.heroItem : hero;
        const hasCurrentLocalizedPreview = waitForLocalizedTmdb && sourceHero.heroTmdbLocalizationSignature === settingsSignature;
        const preserveLocalizedBasicInfo = hasCurrentLocalizedPreview && settings.useBasicInfo;
        const preserveLocalizedArtwork = hasCurrentLocalizedPreview && settings.useArtwork;
        const enrichedRuntime = parseRuntimeMinutes(meta?.runtimeMinutes ?? meta?.runtime);
        const runtimePatch = {
          ...(enrichedRuntime > 0 ? { runtimeMinutes: enrichedRuntime } : {}),
          ...(shouldPreserveHomeRuntimeText(meta?.runtime) ? { runtime: meta.runtime } : {})
        };
        const tmdbRuntime = parseRuntimeMinutes(tmdbEnrichment?.runtimeMinutes ?? tmdbEnrichment?.runtime);
        const tmdbPatch = tmdbEnrichment
          ? {
              ...(settings.useBasicInfo && tmdbEnrichment.localizedTitle ? { name: tmdbEnrichment.localizedTitle } : {}),
              ...(settings.useBasicInfo && tmdbEnrichment.description ? { description: tmdbEnrichment.description } : {}),
              ...(settings.useBasicInfo && Array.isArray(tmdbEnrichment.genres) && tmdbEnrichment.genres.length
                ? { genres: tmdbEnrichment.genres }
                : {}),
              ...(settings.useArtwork && tmdbEnrichment.backdrop ? { background: tmdbEnrichment.backdrop } : {}),
              ...(settings.useArtwork && tmdbEnrichment.poster ? { poster: tmdbEnrichment.poster } : {}),
              ...(settings.useArtwork ? { logo: tmdbEnrichment.logo || null } : {}),
              ...(settings.useDetails && tmdbRuntime > 0 ? { runtimeMinutes: tmdbRuntime } : {}),
              ...(settings.useDetails && tmdbEnrichment.ageRating ? { ageRating: tmdbEnrichment.ageRating } : {}),
              ...(settings.useDetails && tmdbEnrichment.status ? { status: tmdbEnrichment.status } : {})
            }
          : {};
        const mergedHero = {
          ...sourceHero,
          heroMetaEnriched:
            sourcesSettled &&
            Boolean(meta || tmdbEnrichment || mdbImdbRating != null) &&
            (!isHomeTmdbEnabled(this.layoutMode || "modern") || Boolean(tmdbEnrichment)),
          heroEnrichmentSignature: sourcesSettled ? settingsSignature : "",
          heroTmdbLocalizationSignature: tmdbSettled ? settingsSignature : "",
          heroMetaEnriching: false,
          ...(mdbImdbRating != null ? { imdbRating: Number(mdbImdbRating) } : enrichedImdb != null ? { imdbRating: enrichedImdb } : {}),
          ...(meta ? runtimePatch : {}),
          ...(meta?.released ? { released: meta.released } : {}),
          ...(meta?.releaseInfo ? { releaseInfo: meta.releaseInfo } : {}),
          ...(Array.isArray(meta?.genres) && meta.genres.length && !(preserveLocalizedBasicInfo && sourceHero.genres?.length)
            ? { genres: meta.genres }
            : {}),
          ...(meta?.description && !(preserveLocalizedBasicInfo && sourceHero.description) ? { description: meta.description } : {}),
          ...(meta?.logo && !preserveLocalizedArtwork ? { logo: meta.logo } : {}),
          ...(meta?.background && !(preserveLocalizedArtwork && sourceHero.background) ? { background: meta.background } : {}),
          ...tmdbPatch,
          ...(settings.useArtwork && waitForLocalizedTmdb && tmdbSettled && !tmdbEnrichment
            ? { logo: hasCurrentLocalizedPreview ? sourceHero.logo || null : null }
            : {})
        };
        return commitHero(mergedHero, revision);
      };
      try {
        const metadataPromise =
          LayoutPreferences.get()?.preferExternalMetaAddonDetail !== false
            ? metaRepository.getMetaFromAllAddons(itemType, itemId, null, { signal })
            : Promise.resolve(null);
        // Each provider publishes independently. Keep successful localized data
        // when an addon fails or finishes later, and accept slow TV responses.
        await Promise.allSettled([
          (MdbListSettingsStore.get().showOnHero
            ? mdbListRepository.getRatingsForMeta(hero, itemId, itemType).then((result) => result?.ratings?.imdb ?? null)
            : mdbListRepository.getImdbRatingForItem(hero.imdbId || itemId, itemType)
          ).then(async (rating) => {
            mdbImdbRating = rating;
            if (rating != null) await publishLatestResults();
          }),
          fetchModernHeroTmdbEnrichment(hero, itemType, this.layoutMode || "modern", { signal }).then(async (enrichment) => {
            if (!enrichment && isHomeTmdbEnabled(this.layoutMode || "modern")) {
              const metadataResult = await metadataPromise.catch(() => null);
              const meta = metadataResult?.status === "success" ? metadataResult.data : null;
              const fallbackLookupId = meta ? resolveHomeTmdbLookupId(meta, hero) : "";
              if (canCommitHero() && fallbackLookupId && fallbackLookupId !== resolveHomeTmdbLookupId(hero)) {
                enrichment = await fetchModernHeroTmdbEnrichment({ id: fallbackLookupId }, itemType, this.layoutMode || "modern", {
                  signal
                });
              }
            }
            latestTmdbEnrichment = enrichment;
            tmdbSettled = true;
            if (enrichment || waitForLocalizedTmdb) await publishLatestResults();
          }),
          metadataPromise.then(async (result) => {
            latestMetadataResult = result;
            if (result?.status === "success") await publishLatestResults();
          })
        ]);
        sourcesSettled = true;
        await publishLatestResults();
      } finally {
        if (this.heroEnrichmentAbortController === abortController) this.heroEnrichmentAbortController = null;
        if (this.pendingHeroEnrichmentKey === pendingKey) {
          this.pendingHeroEnrichmentKey = "";
        }
      }
    },
    mergeHeroIntoCatalogState(itemId, mergedHero) {
      const identity = buildHeroIdentity(mergedHero);
      const matches = (item) => String(item?.id || "") === itemId && buildHeroIdentity(item) === identity;
      this.heroCandidates = (this.heroCandidates || []).map((item) => {
        return matches(item) ? { ...item, ...mergedHero } : item;
      });
      this.rows = (this.rows || []).map((row) => {
        const items = row?.result?.data?.items;
        if (!Array.isArray(items) || !items.some(matches)) {
          return row;
        }
        const nextItems = items.map((item) => (matches(item) ? { ...item, ...mergedHero } : item));
        return {
          ...row,
          result: {
            ...row.result,
            data: {
              ...(row.result?.data || {}),
              items: nextItems
            }
          }
        };
      });
    },
    isModernPosterNode(node) {
      return this.layoutMode === "modern" && Boolean(node?.classList?.contains("home-poster-card"));
    },
    resolveCollectionFolderTargetFromNode(node) {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const directCollectionId = String(node.dataset.collectionId || "").trim();
      const directFolderId = String(node.dataset.folderId || "").trim();
      if (directCollectionId && directFolderId) {
        return {
          collectionId: directCollectionId,
          folderId: directFolderId
        };
      }

      const itemId = String(node.dataset.itemId || "").trim();
      const itemType = String(node.dataset.itemType || "")
        .trim()
        .toLowerCase();
      const encodedMatch = itemType === "collection_folder" ? itemId.match(/^collection:([^:]+):(.+)$/i) : null;
      if (encodedMatch?.[1] && encodedMatch?.[2]) {
        return {
          collectionId: encodedMatch[1],
          folderId: encodedMatch[2]
        };
      }

      const rowIndex = Number(node.dataset.rowIndex || -1);
      const itemIndex = Number(node.dataset.itemIndex || -1);
      if (!Number.isFinite(rowIndex) || rowIndex < 0 || !Number.isFinite(itemIndex) || itemIndex < 0) {
        return null;
      }
      const row = this.rows?.[rowIndex] || null;
      if (row?.rowKind !== "collection") {
        return null;
      }
      const item = row?.result?.data?.items?.[itemIndex] || null;
      const normalized = normalizeCollectionFolderItem(item, row.collection || null);
      if (!normalized?.collectionId || !normalized?.folderId) {
        return null;
      }
      return {
        collectionId: normalized.collectionId,
        folderId: normalized.folderId
      };
    },
    isCollectionFolderNode(node) {
      return Boolean(this.resolveCollectionFolderTargetFromNode(node));
    },
    shouldPreserveCollectionHeroMedia(node) {
      if (!this.isCollectionFolderNode(node)) {
        return false;
      }
      return Boolean(firstNonEmpty(this.getNodeHeroSource(node)?.heroVideoUrl));
    },
    hydrateCollectionFocusGif(node, active = false) {
      setHomeCollectionFocusGif(this, node, active, Platform.isVidaa() ? 100 : 0);
    },
    syncFocusedCollectionCardState() {
      const focused = this.getCurrentFocusedNode();
      const focusedCollection = focused?.classList?.contains("home-collection-card") ? focused : null;
      if (
        this.activeCollectionFocusGifNode &&
        this.activeCollectionFocusGifNode !== focusedCollection &&
        this.activeCollectionFocusGifNode.isConnected
      ) {
        this.hydrateCollectionFocusGif(this.activeCollectionFocusGifNode, false);
      }
      if (focusedCollection) {
        // VIDAA's focused-poster timer starts the GIF after remote input settles.
        if (!Platform.isVidaa()) this.hydrateCollectionFocusGif(focusedCollection, true);
        this.activeCollectionFocusGifNode = focusedCollection;
      } else {
        this.activeCollectionFocusGifNode = null;
      }
    }
  };
}
