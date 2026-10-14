const PREVIEW_SHIFT_PROPERTY = "--vidaa-poster-preview-shift";
const PREVIEW_WIDTH_PROPERTY = "--vidaa-poster-preview-width";
const PREVIEW_EDGE_INSET = 8;
const positionedPreviews = new WeakMap();

function cssPixels(value, fallback) {
  const text = String(value || "").trim();
  // Custom properties keep calc() expressions in computed styles. The default
  // expansion is 2.66 times the portrait width; runtime sizing supplies px.
  return /^\d+(?:\.\d+)?px$/.test(text) ? Number.parseFloat(text) : fallback;
}

export function positionVidaaHomePosterPreview(node, viewport = null) {
  const track = node.closest?.(".home-track");
  const shell = node.closest?.(".home-screen-shell.home-layout-modern");
  const frame = node.querySelector?.(".home-poster-frame");
  if (!track || !shell || !frame || !globalThis.getComputedStyle) return;
  const fixedLandscapeWidth =
    node.classList.contains("is-landscape") &&
    shell.classList.contains("home-modern-landscape-posters");

  // Read the collapsed geometry once, after navigation settles and before any
  // expansion writes. Moving only the media keeps navigation/camera coordinates
  // unchanged, including when the last card cannot scroll to the left inset.
  const styles = getComputedStyle(node);
  const cardRect = node.getBoundingClientRect();
  const collapsedWidth = cssPixels(styles.width, cardRect.width);
  let position = positionedPreviews.get(node);
  if (position?.frame !== frame) {
    clearVidaaHomePosterPreviewPosition(node);
    const frameRect = frame.getBoundingClientRect();
    position = {
      frame,
      cardWidth: collapsedWidth,
      frameWidth: frameRect.width,
      frameCssWidth: cssPixels(getComputedStyle(frame).width, frameRect.width),
      frameInset: frameRect.left - cardRect.left,
      viewport,
      onResize: null
    };
    position.onResize = () => {
      if (
        !node.isConnected ||
        !node.classList.contains("focused") ||
        !node.classList.contains("is-expanded")
      ) {
        clearVidaaHomePosterPreviewPosition(node);
        return;
      }
      positionVidaaHomePosterPreview(
        node,
        position.viewport?.isConnected === false ? null : position.viewport
      );
    };
    positionedPreviews.set(node, position);
    globalThis.window?.addEventListener?.("resize", position.onResize);
  }
  position.viewport = viewport;
  // Repeated activation/resize starts from the stable collapsed card slot,
  // never from an in-flight or already expanded frame measurement.
  const collapsedFrameWidth = position.frameWidth + collapsedWidth - position.cardWidth;
  const frameCssWidth = position.frameCssWidth + collapsedWidth - position.cardWidth;
  const frameLeft = cardRect.left + position.frameInset;
  const portraitWidth = cssPixels(
    styles.getPropertyValue("--home-modern-portrait-poster-width"),
    cssPixels(styles.getPropertyValue("--home-poster-width"), collapsedWidth)
  );
  const expandedWidth = fixedLandscapeWidth
    ? collapsedWidth
    : cssPixels(
        styles.getPropertyValue(
          node.classList.contains("is-landscape")
            ? "--home-poster-expanded-width"
            : "--home-modern-portrait-expanded-width"
        ),
        portraitWidth * 2.66
      );
  const trackRect = track.getBoundingClientRect();
  const viewportRect = (viewport || shell).getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  // A peeking track or sidebar-offset shell can extend past the physical
  // document viewport. Its own right edge is not necessarily visible on TV.
  const documentWidth = Number(
    globalThis.document?.documentElement?.clientWidth || globalThis.innerWidth || 0
  );
  const left = Math.max(0, trackRect.left, viewportRect.left, shellRect.left) + PREVIEW_EDGE_INSET;
  const right =
    Math.min(
      trackRect.right,
      viewportRect.right,
      shellRect.right,
      documentWidth > 0 ? documentWidth : Number.POSITIVE_INFINITY
    ) - PREVIEW_EDGE_INSET;
  const finalFrameWidth = Math.min(
    collapsedFrameWidth + expandedWidth - collapsedWidth,
    Math.max(1, right - left)
  );
  const shift = Math.max(left, Math.min(frameLeft, right - finalFrameWidth)) - frameLeft;
  // Resize only the visual frame. The card's flex slot and the row's scroll
  // extent stay collapsed, so the next Right cannot inherit expanded geometry.
  node.style.setProperty(
    PREVIEW_WIDTH_PROPERTY,
    `${Math.max(1, finalFrameWidth - collapsedFrameWidth + frameCssWidth)}px`
  );
  if (shift) node.style.setProperty(PREVIEW_SHIFT_PROPERTY, `${shift}px`);
  else node.style.removeProperty(PREVIEW_SHIFT_PROPERTY);
}

export function clearVidaaHomePosterPreviewPosition(node) {
  // Collapse is on the remote input path: no geometry reads or queued frames.
  node.style?.removeProperty?.(PREVIEW_SHIFT_PROPERTY);
  node.style?.removeProperty?.(PREVIEW_WIDTH_PROPERTY);
  globalThis.window?.removeEventListener?.("resize", positionedPreviews.get(node)?.onResize);
  positionedPreviews.delete(node);
}
