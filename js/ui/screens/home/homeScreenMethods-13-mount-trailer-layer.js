import * as internals from "./homeScreenContext.js";
import { reconcileHomeFocusMediaTracking } from "./homeFocusMediaTracking.js";
import { mountTrailerMedia } from "./homeTrailerLayer.js";
import { positionVidaaHomePosterPreview, clearVidaaHomePosterPreviewPosition } from "./vidaaHomePosterExpansion.js";

export function createHomeScreenMethods13() {
  const { Platform, metaRepository, isCollectionFolderItem, resolveTrailerSource, withTimeout, resolveTrailerMetaWithTmdbFallback } =
    internals;

  return {
    mountTrailerLayer(container, source, onReady = null) {
      if (!container || !source) {
        return;
      }
      reconcileHomeFocusMediaTracking(this);
      this.clearTrailerLayer(container);
      this.homeActiveTrailerLayers ||= new Set();
      this.homeActiveTrailerLayers.add(container);
      mountTrailerMedia(container, source, onReady, () => {
        this.clearTrailerLayer(container);
        this.setHeroTrailerActive(false);
        container.closest(".home-poster-card")?.classList.remove("is-trailer-active");
      });
    },
    collapseFocusedPoster(node = this.expandedPosterNode, options = {}) {
      // Avoid overlapping flex-size transitions that leave stale poster layers on
      // constrained TV generations and low-end devices.
      const instant = Boolean(options?.instant || this.isPerformanceConstrained());
      const preserveHeroMedia = Boolean(options?.preserveHeroMedia);
      const excludeNode = options?.excludeNode instanceof HTMLElement ? options.excludeNode : null;
      reconcileHomeFocusMediaTracking(this);
      const targets = new Set();
      if (node instanceof HTMLElement && node !== excludeNode) {
        targets.add(node);
      }
      this.homeActivePosterNodes?.forEach((card) => {
        if (card !== excludeNode) targets.add(card);
      });
      targets.forEach((target) => {
        const frame = target?.querySelector?.(".home-poster-frame") || null;
        // VIDAA CSS disables size transitions as soon as is-expanded is removed.
        // Don't flush layout to override them on the key-input path.
        const overrideTransition =
          instant && !Platform.isVidaa() && (target.classList.contains("is-expanded") || target.classList.contains("is-trailer-active"));
        const previousCardTransition = overrideTransition && target instanceof HTMLElement ? target.style.transition : "";
        const previousFrameTransition = overrideTransition && frame instanceof HTMLElement ? frame.style.transition : "";
        if (overrideTransition && target instanceof HTMLElement) {
          target.style.setProperty("transition", "none", "important");
        }
        if (overrideTransition && frame instanceof HTMLElement) {
          frame.style.setProperty("transition", "none", "important");
        }
        if (Platform.isVidaa()) clearVidaaHomePosterPreviewPosition(target);
        target.classList.remove("is-expanded", "is-trailer-active", "is-expanded-backdrop-ready");
        this.homeActivePosterNodes?.delete(target);
        const trailerLayer = target.querySelector(".home-poster-trailer-layer");
        if (this.shouldUseImmediateFocusScroll()) {
          this.scheduleTrailerLayerCleanup(trailerLayer);
        } else {
          this.clearTrailerLayer(trailerLayer);
        }
        if (overrideTransition && target instanceof HTMLElement) {
          void target.offsetWidth;
          requestAnimationFrame(() => {
            if (target.isConnected) {
              target.style.transition = previousCardTransition;
            }
            if (frame instanceof HTMLElement && frame.isConnected) {
              frame.style.transition = previousFrameTransition;
            }
          });
        }
      });
      if (!preserveHeroMedia) {
        const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
        if (this.shouldUseImmediateFocusScroll()) {
          this.scheduleTrailerLayerCleanup(heroLayer);
        } else {
          this.clearTrailerLayer(heroLayer);
        }
        this.setHeroTrailerActive(false);
        this.heroTrailerPlaybackState = null;
      }
      if (!this.expandedPosterNode?.isConnected || !this.expandedPosterNode?.classList?.contains("is-expanded")) {
        this.expandedPosterNode = null;
      }
    },
    expandFocusedPoster(node) {
      if (!this.isModernPosterNode(node)) {
        return;
      }
      reconcileHomeFocusMediaTracking(this);
      const hasOtherExpandedPosters = [...(this.homeActivePosterNodes || [])].some((card) => card !== node);
      if ((this.expandedPosterNode && this.expandedPosterNode !== node) || hasOtherExpandedPosters) {
        this.collapseFocusedPoster(this.expandedPosterNode, { excludeNode: node });
      }
      if (Platform.isVidaa()) {
        positionVidaaHomePosterPreview(
          node,
          this.container?.querySelector(".home-modern-rows-viewport") || this.container?.querySelector(".home-main")
        );
      }
      node.classList.add("is-expanded");
      this.homeActivePosterNodes?.add(node);
      this.hydrateFocusedPosterAssets(node);
      this.expandedPosterNode = node;
      // VIDAA has already reserved the expanded slot and positioned the camera
      // before its compositor-only preview animation starts.
      if (Platform.isVidaa()) {
        return;
      }
      requestAnimationFrame(() => {
        if (node.isConnected && this.expandedPosterNode === node && node.classList.contains("focused")) {
          this.ensureTrackHorizontalVisibility(node);
        }
      });
    },
    async getTrailerSourceForItem(item) {
      if (isCollectionFolderItem(item)) {
        return null;
      }
      const itemId = String(item?.id || item?.contentId || "").trim();
      const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
      if (!itemId) {
        return null;
      }
      try {
        const itemMeta = { ...(item || {}), id: itemId, type: itemType };
        const inlineFallbackSource = resolveTrailerSource(itemMeta);
        const addonMetaPromise = inlineFallbackSource
          ? Promise.resolve({ status: "error" })
          : withTimeout(metaRepository.getMetaFromAllAddons(itemType, itemId), 3200, {
              status: "error",
              message: "timeout"
            });
        const [inlineSource, result] = await Promise.all([
          withTimeout(resolveTrailerMetaWithTmdbFallback(itemMeta, itemType), 2200, null),
          addonMetaPromise
        ]);
        if (inlineSource) {
          return inlineSource;
        }
        if (inlineFallbackSource) {
          return inlineFallbackSource;
        }
        return result?.status === "success" ? resolveTrailerSource({ ...(result?.data || {}), id: itemId, type: itemType }) : null;
      } catch (error) {
        console.warn("Home trailer preview lookup failed", error);
        return null;
      }
    },
    prefetchFocusedPosterTrailer(node) {
      if (!this.isModernPosterNode(node) || this.isCollectionFolderNode(node)) {
        return Promise.resolve(null);
      }
      const flowKey = this.getFocusedPosterFlowKey(node);
      if (!flowKey) {
        return Promise.resolve(null);
      }
      this.focusedPosterTrailerSourcePromises ||= new Map();
      const cached = this.focusedPosterTrailerSourcePromises.get(flowKey);
      if (cached) {
        return cached;
      }
      const sourceItem = this.getNodeHeroSource(node);
      const promise = this.getTrailerSourceForItem(sourceItem).catch((error) => {
        console.warn("Home trailer preview prefetch failed", error);
        return null;
      });
      this.focusedPosterTrailerSourcePromises.set(flowKey, promise);
      // Keep this session cache bounded while retaining the Android-style
      // focus prefetch for recently visited cards.
      while (this.focusedPosterTrailerSourcePromises.size > 32) {
        const oldestKey = this.focusedPosterTrailerSourcePromises.keys().next().value;
        this.focusedPosterTrailerSourcePromises.delete(oldestKey);
      }
      return promise;
    }
  };
}
