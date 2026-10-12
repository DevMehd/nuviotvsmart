function releaseGif(node) {
  node?.classList?.remove("is-focus-gif-active");
  const image = node?.querySelector?.(".home-poster-focus-gif");
  if (!image) return;
  if (!image.dataset.src) image.dataset.src = image.getAttribute("src") || "";
  image.removeAttribute("src");
}

export function clearHomeCollectionFocusGif(screen) {
  const pending = screen.collectionFocusGifPending;
  if (pending) clearTimeout(pending.timer);
  screen.collectionFocusGifPending = null;
  releaseGif(screen.activeCollectionFocusGifNode);
  screen.activeCollectionFocusGifNode = null;
}

export function setHomeCollectionFocusGif(screen, node, active, delayMs = 0) {
  const image = node?.querySelector?.(".home-poster-focus-gif");
  if (!active) {
    if (screen.collectionFocusGifPending?.node === node) {
      clearTimeout(screen.collectionFocusGifPending.timer);
      screen.collectionFocusGifPending = null;
    }
    releaseGif(node);
    if (screen.activeCollectionFocusGifNode === node) screen.activeCollectionFocusGifNode = null;
    return;
  }
  if (!image || image.tagName !== "IMG") return;
  if (screen.collectionFocusGifPending?.node === node) return;
  if (screen.activeCollectionFocusGifNode === node && image.getAttribute("src")) return;
  clearHomeCollectionFocusGif(screen);
  const activate = () => {
    screen.collectionFocusGifPending = null;
    if (
      !node.isConnected ||
      !node.classList.contains("focused") ||
      (screen.getCurrentFocusedNode && screen.getCurrentFocusedNode() !== node)
    )
      return;
    const source = image.dataset.src || image.getAttribute("src") || "";
    if (!source) return;
    image.setAttribute("src", source);
    node.classList.add("is-focus-gif-active");
    screen.activeCollectionFocusGifNode = node;
  };
  if (delayMs <= 0) activate();
  else screen.collectionFocusGifPending = { node, timer: setTimeout(activate, delayMs) };
}
