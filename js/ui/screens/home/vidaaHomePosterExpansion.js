const SLOT_WIDTH_PROPERTY = "--vidaa-poster-expanded-slot-width";
const PREVIEW_EDGE_INSET = 8;
const EXPANSION_DURATION_MS = 180;
const positionedPreviews = new WeakMap();
const activePreviews = new Set();

function cssPixels(value, fallback) {
  const text = String(value || "").trim();
  return /^\d+(?:\.\d+)?px$/.test(text) ? Number.parseFloat(text) : fallback;
}

function saveStyles(element, properties) {
  return properties.map((name) => [
    name,
    element.style.getPropertyValue(name),
    element.style.getPropertyPriority(name)
  ]);
}

function restoreStyles(element, declarations) {
  declarations.forEach(([name, value, priority]) => {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  });
}

function finishAnimation(position) {
  if (position.animationFrame) cancelAnimationFrame(position.animationFrame);
  if (position.cleanupTimer) clearTimeout(position.cleanupTimer);
  position.animationFrame = 0;
  position.cleanupTimer = 0;
  position.animated.forEach(({ element, styles }) => restoreStyles(element, styles));
  position.animated.length = 0;
  restorePreviewPoster(position);
  position.node.classList.remove("vidaa-poster-expanding");
}

function restorePreviewPoster(position) {
  const poster = position.poster;
  if (!poster) return;
  if (poster.style == null) poster.element.removeAttribute("style");
  else poster.element.setAttribute("style", poster.style);
  if (poster.element.parentElement === position.node && position.node.contains(poster.parent)) {
    poster.parent.insertBefore(
      poster.element,
      poster.next?.parentNode === poster.parent ? poster.next : poster.parent.firstChild
    );
  }
  position.poster = null;
}

export function positionVidaaHomePosterPreview(node, viewport = null, { animate = true } = {}) {
  const track = node.closest?.(".home-track");
  const shell = node.closest?.(".home-screen-shell.home-layout-modern");
  const frame = node.querySelector?.(".home-poster-frame");
  if (!track || !shell || !frame || !globalThis.getComputedStyle) return;
  const current = positionedPreviews.get(node);
  if (current?.frame === frame && current.track === track) return;
  clearVidaaHomePosterPreviewPosition(node);
  // Restored markup can already carry is-expanded. Start from the same
  // collapsed geometry as a fresh dwell; never accumulate an expanded width.
  node.classList.remove("is-expanded");
  const styles = getComputedStyle(node);
  const cardRect = node.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const collapsedWidth = cssPixels(styles.width, cardRect.width);
  const trackRect = track.getBoundingClientRect();
  const viewportRect = (viewport || shell).getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  const documentWidth = Number(
    globalThis.document?.documentElement?.clientWidth || globalThis.innerWidth || 0
  );
  const left = Math.max(0, trackRect.left, viewportRect.left, shellRect.left) + PREVIEW_EDGE_INSET;
  const right =
    Math.min(trackRect.right, viewportRect.right, shellRect.right, documentWidth || Infinity) -
    PREVIEW_EDGE_INSET;
  const fixedLandscapeWidth =
    node.classList.contains("is-landscape") &&
    shell.classList.contains("home-modern-landscape-posters");
  const portraitWidth = cssPixels(
    styles.getPropertyValue("--home-modern-portrait-poster-width"),
    collapsedWidth
  );
  const requestedWidth = fixedLandscapeWidth
    ? collapsedWidth
    : cssPixels(
        styles.getPropertyValue(
          node.classList.contains("is-landscape")
            ? "--home-poster-expanded-width"
            : "--home-modern-portrait-expanded-width"
        ),
        portraitWidth * 2.66
      );
  const expandedWidth = Math.max(
    1,
    Math.min(requestedWidth, right - left - (frameRect.width - collapsedWidth))
  );
  const cards = Array.from(track.children).filter((card) =>
    card.classList.contains("home-content-card")
  );
  const index = cards.indexOf(node);
  // The card window retains parked row slots. Only paint/animate the nearby
  // cards, rather than measuring every catalog item after a long scroll.
  const radius = Math.ceil(Math.max(1, right - left) / Math.max(1, cardRect.width)) + 2;
  const participants = (animate ? cards : [])
    .slice(Math.max(0, index - radius), index + radius + 1)
    .filter((card) => !card.classList.contains("vidaa-card-parked"))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }));
  const poster = frame.querySelector(".content-poster");
  const posterRect = poster?.getBoundingClientRect();
  const trackStyles = getComputedStyle(track);
  const position = {
    node,
    frame,
    track,
    viewport,
    scrollLeft: track.scrollLeft,
    expandedScrollLeft: track.scrollLeft,
    collapsedMaxScroll: Math.max(0, track.scrollWidth - track.clientWidth),
    cardLeft: cardRect.left,
    slotStyle: saveStyles(node, [SLOT_WIDTH_PROPERTY, "--vidaa-poster-original-width"]),
    paddingStyle: saveStyles(track, ["padding-right"]),
    animated: [],
    animationFrame: 0,
    cleanupTimer: 0,
    poster: null,
    onResize: null
  };
  positionedPreviews.set(node, position);
  activePreviews.add(node);

  // Reserve the real flex slot once, as upstream does. FLIP then animates only
  // compositor transforms; no flex/width/margin tween relays out the row.
  node.style.setProperty(SLOT_WIDTH_PROPERTY, `${expandedWidth}px`);
  if (posterRect) node.style.setProperty("--vidaa-poster-original-width", `${posterRect.width}px`);
  const clippedTrackRight = Math.max(0, trackRect.right - right + PREVIEW_EDGE_INSET);
  if (clippedTrackRight > 0) {
    track.style.setProperty(
      "padding-right",
      `${(Number.parseFloat(trackStyles.paddingRight) || 0) + clippedTrackRight}px`
    );
  }
  node.classList.add("is-expanded");
  const finalFrame = frame.getBoundingClientRect();
  const finalRects = participants.map(({ element }) => element.getBoundingClientRect());
  const cameraShift = Math.max(0, finalFrame.right - right) - Math.max(0, left - finalFrame.left);
  track.scrollLeft = Math.max(0, position.scrollLeft + cameraShift);
  position.expandedScrollLeft = track.scrollLeft;
  const actualCameraShift = position.expandedScrollLeft - position.scrollLeft;

  // A late backdrop leaves the original portrait undistorted. Keep that same
  // image (and its decoded resource) outside the scaled preview surface; the
  // backdrop-ready opacity rule still reveals the landscape when it is ready.
  if (animate && poster && posterRect) {
    position.poster = {
      element: poster,
      parent: frame,
      next: poster.nextSibling,
      style: poster.getAttribute("style")
    };
    poster.style.setProperty("left", `${posterRect.left - cardRect.left - node.clientLeft}px`);
    poster.style.setProperty("top", `${posterRect.top - cardRect.top - node.clientTop}px`);
    poster.style.setProperty("right", "auto");
    poster.style.setProperty("bottom", "auto");
    poster.style.setProperty("width", `${posterRect.width}px`);
    poster.style.setProperty("height", `${posterRect.height}px`);
    poster.style.setProperty("pointer-events", "none");
    node.appendChild(poster);
  }
  const animateElement = (element, from, to) => {
    const saved = saveStyles(element, [
      "transform",
      "transform-origin",
      "transition",
      "will-change"
    ]);
    position.animated.push({ element, styles: saved, to });
    element.style.setProperty("transition", "none", "important");
    element.style.setProperty("transform-origin", "left top", "important");
    element.style.setProperty("will-change", "transform");
    element.style.setProperty("transform", from, "important");
  };
  participants.forEach(({ element, rect }, i) => {
    const shift = rect.left - finalRects[i].left + actualCameraShift;
    if (Math.abs(shift) > 0.1) animateElement(element, `translateX(${shift}px)`, "translateX(0px)");
  });
  if (animate && Math.abs(finalFrame.width - frameRect.width) > 0.1)
    animateElement(frame, `scaleX(${frameRect.width / finalFrame.width})`, "scaleX(1)");
  if (position.animated.length) {
    node.classList.add("vidaa-poster-expanding");
    // Commit the inverted geometry together. The preview edge and neighboring
    // cards then use the same easing without a layout change on every frame.
    void frame.offsetWidth;
    position.animationFrame = requestAnimationFrame(() => {
      position.animationFrame = 0;
      if (positionedPreviews.get(node) !== position || !node.classList.contains("is-expanded"))
        return;
      position.animated.forEach(({ element, to }) => {
        element.style.setProperty(
          "transition",
          `transform ${EXPANSION_DURATION_MS}ms ease-out`,
          "important"
        );
        element.style.setProperty("transform", to, "important");
      });
      position.cleanupTimer = setTimeout(
        () => finishAnimation(position),
        EXPANSION_DURATION_MS + 40
      );
    });
  } else restorePreviewPoster(position);
  position.onResize = () => {
    const shouldReposition =
      node.isConnected &&
      node.classList.contains("focused") &&
      node.classList.contains("is-expanded");
    clearVidaaHomePosterPreviewPosition(node);
    if (shouldReposition)
      positionVidaaHomePosterPreview(node, viewport?.isConnected === false ? null : viewport, {
        animate: false
      });
  };
  globalThis.window?.addEventListener?.("resize", position.onResize);
}

export function clearVidaaHomePosterPreviewPosition(node) {
  const position = positionedPreviews.get(node);
  if (!position) return;
  // Run before removing is-expanded: restore the camera before dirtying layout,
  // without geometry reads on remote input. Preserve intentional later scrolls.
  if (Math.abs(position.track.scrollLeft - position.expandedScrollLeft) < 1)
    position.track.scrollLeft = position.scrollLeft;
  finishAnimation(position);
  restoreStyles(node, position.slotStyle);
  restoreStyles(position.track, position.paddingStyle);
  globalThis.window?.removeEventListener?.("resize", position.onResize);
  positionedPreviews.delete(node);
  activePreviews.delete(node);
}

export function getVidaaHomePosterPreviewCamera(node) {
  const position = positionedPreviews.get(node);
  if (!position || Math.abs(position.track.scrollLeft - position.expandedScrollLeft) >= 1)
    return null;
  return {
    scrollLeft: position.scrollLeft,
    maxScroll: position.collapsedMaxScroll,
    cardLeft: position.cardLeft
  };
}

export function hasVidaaHomePosterPreview(node) {
  return positionedPreviews.has(node);
}

export function prepareVidaaHomePosterPreviewsForUpdate(container, previews) {
  activePreviews.forEach((node) => {
    if (container.contains(node)) {
      clearVidaaHomePosterPreviewPosition(node);
      previews.add(node);
    }
  });
}

export function clearVidaaHomePosterPreviews(container) {
  activePreviews.forEach((node) => {
    if (!node.isConnected || container?.contains(node)) {
      clearVidaaHomePosterPreviewPosition(node);
      node.classList.remove("is-expanded");
    }
  });
}
