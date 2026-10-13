/* eslint-disable no-unused-vars */
import * as internals from "./startupSyncService.js";

export function createStartupSyncServiceMethods03() {
  const {
    AuthManager,
    ProfileManager,
    ProfileSyncService,
    LibrarySyncService,
    WatchProgressSyncService,
    SavedLibrarySyncService,
    WatchedItemsSyncService,
    PluginSyncService,
    ProfileSettingsSyncService,
    CollectionSyncService,
    HomeCatalogSettingsSyncService,
    getSyncBackoffRemainingMs,
    isSyncBackoffActive,
    ADDON_PUSH_DEBOUNCE_MS,
    currentSyncKey,
    runSurface
  } = internals;

  return {
    async requestLibrarySyncNow() {
      if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
        return false;
      }
      const generation = this.runGeneration;
      const profileId = ProfileManager.getActiveProfileId();
      const profileKey = currentSyncKey(profileId);
      if (this.libraryInFlightPromise && this.libraryInFlightGeneration === generation) {
        return this.libraryInFlightPromise;
      }
      if (isSyncBackoffActive()) {
        this.scheduleBackoffRetry();
        return false;
      }

      let requestPromise = null;
      requestPromise = (async () => {
        try {
          if (!this.isCurrentProfile(profileId, profileKey)) {
            return false;
          }
          // Refresh the library and phone-managed Home inputs on foreground
          // activity. Addon/plugin manifests retain the explicit refresh path.
          const savedLibraryResult = await runSurface("periodic saved library", () => SavedLibrarySyncService.pull(profileId));
          if (!savedLibraryResult.ok) {
            return false;
          }
          const homeResults = await Promise.all([
            runSurface("periodic collections", () => CollectionSyncService.pull(profileId)),
            runSurface("periodic home catalog settings", () => HomeCatalogSettingsSyncService.pull(profileId))
          ]);
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) return false;
          if (homeResults.some((result) => result.ok && result.value === true)) {
            internals.notifySyncPullCompleted({
              key: profileKey,
              profileId,
              changedHomeInputs: true,
              source: "phone-library"
            });
          }
          if (isSyncBackoffActive()) {
            this.scheduleBackoffRetry();
            return false;
          }
          return this.isCurrentRun(generation) && this.isCurrentProfile(profileId, profileKey);
        } finally {
          if (this.libraryInFlightPromise === requestPromise) {
            this.libraryInFlightPromise = null;
            this.libraryInFlightGeneration = 0;
          }
        }
      })();
      this.libraryInFlightPromise = requestPromise;
      this.libraryInFlightGeneration = generation;
      return requestPromise;
    },
    async syncPush({
      generation = this.runGeneration,
      profileId = ProfileManager.getActiveProfileId(),
      key = currentSyncKey(profileId)
    } = {}) {
      if (
        !this.isCurrentRun(generation) ||
        !AuthManager.isAuthenticated ||
        isSyncBackoffActive() ||
        !this.isCurrentProfile(profileId, key)
      ) {
        this.scheduleBackoffRetry();
        return false;
      }
      const surfaces = [
        ["profiles push", () => ProfileSyncService.push()],
        ["profile settings push", () => ProfileSettingsSyncService.push()],
        ["collections push", () => CollectionSyncService.push()],
        ["home catalog settings push", () => HomeCatalogSettingsSyncService.push()],
        ["plugins push", () => PluginSyncService.push(profileId)],
        ["addons push", () => LibrarySyncService.push()],
        ["saved library push", () => SavedLibrarySyncService.push(profileId)],
        ["watched items push", () => WatchedItemsSyncService.push(profileId)],
        ["watch progress push", () => WatchProgressSyncService.push(profileId)]
      ];
      for (const [label, task] of surfaces) {
        if (!this.isCurrentRun(generation) || isSyncBackoffActive() || !this.isCurrentProfile(profileId, key)) {
          this.scheduleBackoffRetry();
          return false;
        }
        await runSurface(label, task);
      }
      return !isSyncBackoffActive();
    },
    async syncCycle() {
      return this.requestWatchStateSyncNow();
    },
    scheduleAddonPush(delayMs = ADDON_PUSH_DEBOUNCE_MS) {
      if (!this.started || !this.profileScopedSyncEnabled) {
        return;
      }
      if (this.addonPushTimer) {
        clearTimeout(this.addonPushTimer);
      }
      const cooldownMs = getSyncBackoffRemainingMs();
      const effectiveDelayMs = Math.max(ADDON_PUSH_DEBOUNCE_MS, Number(delayMs) || 0, cooldownMs > 0 ? cooldownMs + 50 : 0);
      this.addonPushTimer = setTimeout(() => {
        this.addonPushTimer = null;
        let pushPromise = null;
        pushPromise = Promise.resolve()
          .then(async () => {
            if (!AuthManager.isAuthenticated) {
              return false;
            }
            if (isSyncBackoffActive()) {
              this.scheduleAddonPush();
              return false;
            }
            const didPush = await LibrarySyncService.push();
            if (!didPush && isSyncBackoffActive()) {
              this.scheduleAddonPush();
            }
            return didPush;
          })
          .catch((error) => {
            console.warn("Addon push failed", error);
            return false;
          })
          .finally(() => {
            if (this.addonPushPromise === pushPromise) {
              this.addonPushPromise = null;
            }
          });
        this.addonPushPromise = pushPromise;
      }, effectiveDelayMs);
    }
  };
}
