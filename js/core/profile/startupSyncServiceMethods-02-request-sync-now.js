import * as internals from "./startupSyncService.js";

function surfaceChangedHomeInputs(result) {
  return !(result && result.ok === true && result.value === false);
}

async function getProfileHomeSignature(ProfileManager) {
  try {
    const profiles = await ProfileManager.getProfiles();
    if (!Array.isArray(profiles)) {
      return null;
    }
    return JSON.stringify(
      profiles.map((profile) => ({
        id: profile?.id,
        profileIndex: profile?.profileIndex,
        name: profile?.name,
        avatarColorHex: profile?.avatarColorHex,
        avatarId: profile?.avatarId,
        avatarUrl: profile?.avatarUrl,
        profileBackgroundId: profile?.profileBackgroundId,
        profileBackgroundUrl: profile?.profileBackgroundUrl,
        usesPrimaryAddons: profile?.usesPrimaryAddons,
        usesPrimaryPlugins: profile?.usesPrimaryPlugins,
        isPrimary: profile?.isPrimary
      }))
    );
  } catch (_) {
    return null;
  }
}

export function createStartupSyncServiceMethods02() {
  const {
    AuthManager,
    ProfileManager,
    ProfileSyncService,
    addonRepository,
    LibrarySyncService,
    WatchProgressSyncService,
    SavedLibrarySyncService,
    WatchedItemsSyncService,
    PluginSyncService,
    ProfileSettingsSyncService,
    ProviderCredentialSyncService,
    SimklSyncService,
    CollectionSyncService,
    HomeCatalogSettingsSyncService,
    ThemeManager,
    MemberAccessRepository,
    I18n,
    hasProfileSettingsCloudSyncPending,
    isSyncBackoffActive,
    resetSyncBackoff,
    MAX_PULL_ATTEMPTS,
    FORCE_RESYNC_MIN_INTERVAL_MS,
    sleep,
    normalizeProfileId,
    currentSyncKey,
    runSurface,
    notifySyncPullCompleted
  } = internals;

  return {
    markHomeInputsChanged(changed) {
      if (changed) {
        this.lastPullChangedHomeInputs = true;
      }
    },
    getLastPullChangedHomeInputs() {
      return this.lastPullChangedHomeInputs;
    },
    async requestSyncNow({
      force = true,
      includeProfileSettings = true,
      allowWarmRepeat = false,
      pushAfterPull = false,
      notifyPullCompleted = false
    } = {}) {
      if (!this.started) {
        return false;
      }
      const generation = this.runGeneration;
      const profileId = ProfileManager.getActiveProfileId();
      const key = currentSyncKey(profileId);
      if (this.inFlightPromise && this.inFlightGeneration === generation) {
        if (this.inFlightKey !== key) {
          await this.inFlightPromise.catch(() => false);
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) return false;
          return this.requestSyncNow({ force, includeProfileSettings, allowWarmRepeat, pushAfterPull, notifyPullCompleted });
        }
        this.queuePendingSyncRequest({
          force,
          includeProfileSettings,
          pushAfterPull,
          notifyPullCompleted
        });
        return this.inFlightPromise;
      }
      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        this.scheduleBackoffRetry({ notifyPullCompleted });
        return false;
      }

      const now = Date.now();
      const coversProfileSettings = !includeProfileSettings || this.lastPulledIncludedProfileSettings === true;
      if (
        force &&
        this.lastPullCompleted &&
        this.lastPulledKey === key &&
        coversProfileSettings &&
        now - this.lastPulledAtMs < FORCE_RESYNC_MIN_INTERVAL_MS
      ) {
        if (notifyPullCompleted) {
          notifySyncPullCompleted({
            profileId: normalizeProfileId(profileId),
            includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
            changedHomeInputs: false,
            completedAt: Date.now()
          });
        }
        return true;
      }
      // Warm and cold starts both pull the complete account snapshot. Share the
      // same in-flight promise so Home and a profile switch can await either.
      let requestPromise = null;
      requestPromise = Promise.resolve().then(async () => {
        let completed = false;
        let changedHomeInputs = false;
        try {
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) return false;
          this.inFlight = true;
          this.lastPullCompleted = false;
          for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
            if (!this.isCurrentRun(generation) || !AuthManager.isAuthenticated) {
              break;
            }
            if (!this.isCurrentProfile(profileId, key)) {
              break;
            }
            if (isSyncBackoffActive()) {
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }

            const didComplete = await this.syncPull({
              includeProfileScoped: this.profileScopedSyncEnabled,
              includeProfileSettings,
              generation,
              profileId,
              key
            });
            if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) break;
            changedHomeInputs = changedHomeInputs || Boolean(this.lastPullChangedHomeInputs);
            this.markHomeInputsChanged(changedHomeInputs);
            if (didComplete && this.isCurrentRun(generation) && this.isCurrentProfile(profileId, key) && !isSyncBackoffActive()) {
              if (pushAfterPull && this.profileScopedSyncEnabled) {
                await this.syncPush({ generation, profileId, key });
              }
              if (this.isCurrentRun(generation) && this.isCurrentProfile(profileId, key) && !isSyncBackoffActive()) {
                this.markFullPullSucceeded(key, includeProfileSettings);
                resetSyncBackoff();
                completed = true;
                if (notifyPullCompleted) {
                  notifySyncPullCompleted({
                    profileId: normalizeProfileId(profileId),
                    includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
                    changedHomeInputs: Boolean(this.lastPullChangedHomeInputs),
                    completedAt: Date.now()
                  });
                }
                break;
              }
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }
            if (isSyncBackoffActive()) {
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }
            if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) break;
            if (attempt < MAX_PULL_ATTEMPTS) {
              await sleep(3000, AuthManager.getSessionSignal?.());
            }
          }
          if (
            !completed &&
            changedHomeInputs &&
            notifyPullCompleted &&
            this.isCurrentRun(generation) &&
            this.isCurrentProfile(profileId, key)
          ) {
            // A later write may fail after a pull already applied fresh data.
            // Publish those inputs now, including when backoff moves the retry
            // into a separate request, while retaining the failed result.
            notifySyncPullCompleted({
              profileId: normalizeProfileId(profileId),
              includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
              changedHomeInputs: true,
              succeeded: false,
              completedAt: Date.now()
            });
          }
          if (this.isCurrentRun(generation)) this.lastPullCompleted = completed;
          return completed;
        } finally {
          if (this.inFlightPromise === requestPromise) {
            this.inFlight = false;
            this.inFlightPromise = null;
            this.inFlightGeneration = 0;
            this.inFlightKey = null;
          }
          const pending = this.isCurrentRun(generation) ? this.pendingSyncRequest : null;
          if (this.isCurrentRun(generation)) this.pendingSyncRequest = null;
          if (pending && this.isCurrentRun(generation)) {
            setTimeout(() => {
              if (!this.isCurrentRun(generation)) return;
              void this.requestSyncNow(pending).catch((error) => {
                console.warn("Queued startup sync failed", error);
              });
            }, 0);
          }
        }
      });
      this.inFlightPromise = requestPromise;
      this.inFlightGeneration = generation;
      this.inFlightKey = key;
      return requestPromise;
    },
    async syncPull({
      includeProfileScoped = this.profileScopedSyncEnabled,
      includeProfileSettings = true,
      generation = this.runGeneration,
      profileId = ProfileManager.getActiveProfileId(),
      key = currentSyncKey(profileId)
    } = {}) {
      if (!this.isCurrentRun(generation) || !AuthManager.isAuthenticated || !this.isCurrentProfile(profileId, key)) {
        return false;
      }
      this.lastPullChangedHomeInputs = false;
      WatchedItemsSyncService.resetLastPullChangedHomeInputs?.();
      WatchProgressSyncService.resetLastPullChangedHomeInputs?.();
      const profileSignatureBefore = await getProfileHomeSignature(ProfileManager);
      if (profileSignatureBefore == null) {
        this.markHomeInputsChanged(true);
      }
      let profileSettingsSignatureBefore = null;
      if (includeProfileSettings) {
        try {
          profileSettingsSignatureBefore = ProfileSettingsSyncService.getHomeInputSignature?.(profileId) ?? null;
        } catch (_) {
          this.markHomeInputsChanged(true);
        }
      }
      await ProfileSyncService.pull();
      if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) {
        return false;
      }
      const profileStatus = ProfileSyncService.getLastPullStatus?.();
      const profileSignatureAfter = await getProfileHomeSignature(ProfileManager);
      this.markHomeInputsChanged(
        profileStatus !== "ok" ||
          profileSignatureBefore == null ||
          profileSignatureAfter == null ||
          profileSignatureBefore !== profileSignatureAfter
      );
      if (profileStatus === "deferred") {
        this.scheduleBackoffRetry();
        return false;
      }
      if (profileStatus !== "ok") {
        return false;
      }

      const activeProfileId = profileId;
      if (includeProfileSettings) {
        const profileSettingsResult = await runSurface("profile settings", async () => {
          const didApply = await ProfileSettingsSyncService.pull(activeProfileId);
          if (hasProfileSettingsCloudSyncPending(activeProfileId) && !isSyncBackoffActive()) {
            await ProfileSettingsSyncService.push(activeProfileId);
          }
          return didApply;
        });
        let profileSettingsSignatureAfter = null;
        try {
          profileSettingsSignatureAfter = ProfileSettingsSyncService.getHomeInputSignature?.(activeProfileId) ?? null;
        } catch (_) {}
        this.markHomeInputsChanged(
          !profileSettingsResult.ok ||
            profileSettingsSignatureBefore == null ||
            profileSettingsSignatureAfter == null ||
            profileSettingsSignatureBefore !== profileSettingsSignatureAfter
        );
        if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) return false;
        if (profileSettingsResult.ok && profileSettingsResult.value) {
          await runSurface("profile settings theme", async () => {
            await I18n.init();
            const memberAccess = await MemberAccessRepository.getAccess().catch(() => MemberAccessRepository.getCurrentAccess());
            ThemeManager.apply({ enforceAccess: true, access: memberAccess });
            I18n.apply();
          });
        }
      }

      await Promise.all([
        runSurface("provider credentials", () => ProviderCredentialSyncService.syncFromRemote(activeProfileId)),
        runSurface("Simkl refresh", () =>
          SimklSyncService.refresh().catch((error) => {
            console.warn("Simkl automatic refresh failed", error);
            return false;
          })
        )
      ]);

      if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key)) {
        return false;
      }

      if (!includeProfileScoped) {
        return this.isCurrentRun(generation) && !isSyncBackoffActive();
      }
      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        return false;
      }

      const addonUrlsBefore = JSON.stringify(addonRepository.getInstalledAddonUrls());
      const homeSurfaceResults = await Promise.all([
        // Android pulls plugins and addons as independent surfaces. Keep a
        // plugin-service/readiness failure from suppressing the addon snapshot.
        runSurface("plugins", () => PluginSyncService.pull(activeProfileId)),
        runSurface("collections", () => CollectionSyncService.pull(activeProfileId)),
        runSurface("home catalog settings", () => HomeCatalogSettingsSyncService.pull(activeProfileId)),
        runSurface("addons", () => LibrarySyncService.pull()),
        runSurface("saved library", () => SavedLibrarySyncService.pull(activeProfileId))
      ]);

      // Only these three surfaces provide Home catalog rows. The profile
      // settings surface is checked separately against the exact settings the
      // current Home render consumed; plugin settings and the saved-library
      // list do not form catalog or Continue Watching rows.
      const collectionsResult = homeSurfaceResults[1];
      const homeCatalogSettingsResult = homeSurfaceResults[2];
      this.markHomeInputsChanged(surfaceChangedHomeInputs(collectionsResult) || CollectionSyncService.getLastPullFailed?.() !== false);
      this.markHomeInputsChanged(
        surfaceChangedHomeInputs(homeCatalogSettingsResult) || HomeCatalogSettingsSyncService.getLastPullFailed?.() !== false
      );
      const addonUrlsAfter = JSON.stringify(addonRepository.getInstalledAddonUrls());
      const addonPullStatus = LibrarySyncService.getLastPullStatus?.();
      this.markHomeInputsChanged(addonUrlsBefore !== addonUrlsAfter || addonPullStatus?.state !== "ok");

      if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key) || isSyncBackoffActive()) {
        return false;
      }
      const watchedItemsResult = await runSurface("watched items", async () => {
        await WatchedItemsSyncService.pull(activeProfileId);
        return WatchedItemsSyncService.getLastPullChangedHomeInputs?.() === false ? false : true;
      });
      this.markHomeInputsChanged(surfaceChangedHomeInputs(watchedItemsResult));
      const watchedStatus = WatchedItemsSyncService.getLastPullStatus();
      const watchedSucceeded = watchedItemsResult.ok && ["ok", "skipped"].includes(watchedStatus);
      if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key) || isSyncBackoffActive()) {
        return false;
      }
      const watchProgressResult = await runSurface("watch progress", async () => {
        await WatchProgressSyncService.pull(activeProfileId);
        return WatchProgressSyncService.getLastPullChangedHomeInputs?.() === false ? false : true;
      });
      this.markHomeInputsChanged(surfaceChangedHomeInputs(watchProgressResult));
      const progressStatus = WatchProgressSyncService.getLastPullStatus();
      const progressSucceeded = watchProgressResult.ok && ["ok", "skipped"].includes(progressStatus);
      // Playback may have persisted locally just before the TV was stopped,
      // before its debounced push ran. Reconcile those writes at restart rather
      // than waiting for the next foreground or fifteen-minute periodic cycle.
      let writesSucceeded = true;
      for (const [label, syncService, status] of [
        ["watched items", WatchedItemsSyncService, watchedStatus],
        ["watch progress", WatchProgressSyncService, progressStatus]
      ]) {
        if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, key) || isSyncBackoffActive()) return false;
        if (status === "ok" && syncService.getLastPullHadUnsynced?.()) {
          const pushResult = await runSurface(`${label} startup push`, () => syncService.push(activeProfileId));
          writesSucceeded = writesSucceeded && pushResult.ok && pushResult.value !== false;
        }
      }
      return (
        watchedSucceeded &&
        progressSucceeded &&
        writesSucceeded &&
        this.isCurrentRun(generation) &&
        this.isCurrentProfile(profileId, key) &&
        !isSyncBackoffActive()
      );
    },
    async requestWatchStateSyncNow() {
      if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
        return false;
      }
      const generation = this.runGeneration;
      const profileId = ProfileManager.getActiveProfileId();
      const profileKey = currentSyncKey(profileId);
      if (this.watchStateInFlightPromise && this.watchStateInFlightGeneration === generation) {
        if (this.watchStateInFlightKey !== profileKey) {
          await this.watchStateInFlightPromise.catch(() => false);
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) return false;
          return this.requestWatchStateSyncNow();
        }
        return this.watchStateInFlightPromise;
      }
      if (isSyncBackoffActive()) {
        this.scheduleBackoffRetry();
        return false;
      }

      const watchedItemsRevisionBefore = WatchedItemsSyncService.getHomeInputChangeRevision?.() ?? 0;
      const watchProgressRevisionBefore = WatchProgressSyncService.getHomeInputChangeRevision?.() ?? 0;
      let requestPromise = null;
      requestPromise = (async () => {
        try {
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) {
            return false;
          }
          const watchedResult = await runSurface("periodic watched items", () => WatchedItemsSyncService.pull(profileId));
          const watchedStatus = WatchedItemsSyncService.getLastPullStatus();
          const watchedSucceeded = watchedResult.ok && ["ok", "skipped"].includes(watchedStatus);
          let writesSucceeded = true;
          if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) return false;
          if (watchedSucceeded && watchedStatus === "ok" && WatchedItemsSyncService.getLastPullHadUnsynced?.() && !isSyncBackoffActive()) {
            const pushResult = await runSurface("periodic watched items push", () => WatchedItemsSyncService.push(profileId));
            writesSucceeded = writesSucceeded && pushResult.ok && pushResult.value !== false;
          }
          let progressSucceeded = false;
          if (!isSyncBackoffActive()) {
            if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) {
              return false;
            }
            const progressResult = await runSurface("periodic watch progress", () => WatchProgressSyncService.pull(profileId));
            const progressStatus = WatchProgressSyncService.getLastPullStatus();
            progressSucceeded = progressResult.ok && ["ok", "skipped"].includes(progressStatus);
            if (!this.isCurrentRun(generation) || !this.isCurrentProfile(profileId, profileKey)) return false;
            if (
              progressSucceeded &&
              progressStatus === "ok" &&
              WatchProgressSyncService.getLastPullHadUnsynced?.() &&
              !isSyncBackoffActive()
            ) {
              const pushResult = await runSurface("periodic watch progress push", () => WatchProgressSyncService.push(profileId));
              writesSucceeded = writesSucceeded && pushResult.ok && pushResult.value !== false;
            }
          }
          if (isSyncBackoffActive()) {
            this.scheduleBackoffRetry();
            return false;
          }
          const requestIsCurrent = this.isCurrentRun(generation) && this.isCurrentProfile(profileId, profileKey);
          const changedHomeInputs =
            watchedItemsRevisionBefore !== (WatchedItemsSyncService.getHomeInputChangeRevision?.() ?? 0) ||
            watchProgressRevisionBefore !== (WatchProgressSyncService.getHomeInputChangeRevision?.() ?? 0);
          if (requestIsCurrent && changedHomeInputs) {
            notifySyncPullCompleted({
              profileId: normalizeProfileId(profileId),
              includeProfileScoped: true,
              changedHomeInputs: true,
              source: "watch-state",
              completedAt: Date.now()
            });
          }
          return requestIsCurrent && watchedSucceeded && progressSucceeded && writesSucceeded;
        } finally {
          if (this.watchStateInFlightPromise === requestPromise) {
            this.watchStateInFlightPromise = null;
            this.watchStateInFlightGeneration = 0;
            this.watchStateInFlightKey = null;
          }
        }
      })();
      this.watchStateInFlightPromise = requestPromise;
      this.watchStateInFlightGeneration = generation;
      this.watchStateInFlightKey = profileKey;
      return requestPromise;
    }
  };
}
