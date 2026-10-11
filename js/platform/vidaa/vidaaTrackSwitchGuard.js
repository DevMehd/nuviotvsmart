const activeTrackSwitches = new WeakMap();

export function registerVidaaTrackSwitch(guard) {
  if (guard?.video) activeTrackSwitches.set(guard.video, guard);
}

export function isTransientVidaaTrackSwitchError({
  video,
  currentVideo = video,
  playRequestToken,
  mountToken,
  guard,
  mediaErrorCode,
  eventDetail = {}
}) {
  const activeGuard = guard || activeTrackSwitches.get(video);
  if (
    !activeGuard ||
    activeTrackSwitches.get(video) !== activeGuard ||
    currentVideo !== video ||
    activeGuard.video !== video ||
    activeGuard.source !== video?.src ||
    activeGuard.playRequestToken !== playRequestToken ||
    (mountToken !== undefined && activeGuard.mountToken !== mountToken) ||
    (typeof activeGuard.isCurrent === "function" && !activeGuard.isCurrent()) ||
    Date.now() >= activeGuard.expiresAt ||
    Number(mediaErrorCode || 0) !== 0 ||
    Number(video?.error?.code || 0) !== 0
  ) {
    return false;
  }

  // Native track changes can emit a bare error event while the same decoder
  // continues playing. Keep explicit stream/engine failures on the error path.
  return Object.entries(eventDetail).every(([key, value]) => {
    if (key === "mediaErrorCode") return Number(value || 0) === 0;
    if (key === "playbackEngine") return !value || value === "native";
    return value === undefined || value === null || value === "" || value === false || value === 0;
  });
}
