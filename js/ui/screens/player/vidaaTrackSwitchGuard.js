import { PlayerController } from "../../../core/player/playerController.js";
import { Platform } from "../../../platform/index.js";
import { registerVidaaTrackSwitch } from "../../../platform/vidaa/vidaaTrackSwitchGuard.js";

export function beginVidaaTrackSwitch(screen) {
  const video = PlayerController.video;
  if (!Platform.isVidaa() || !video) return;
  const guard = {
    video,
    source: video.src,
    playRequestToken: PlayerController.playRequestToken,
    mountToken: screen.playerMountToken,
    expiresAt: Date.now() + 1500
  };
  guard.isCurrent = () =>
    screen.nativeTrackSwitchGuard === guard &&
    screen.playerMountToken === guard.mountToken &&
    screen.isActiveMountToken?.(guard.mountToken) !== false;
  screen.nativeTrackSwitchGuard = guard;
  registerVidaaTrackSwitch(guard);
}
