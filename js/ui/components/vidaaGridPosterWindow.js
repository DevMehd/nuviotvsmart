import { isVidaaNavigationBusy } from "../navigation/vidaaNavigationActivity.js";

const POSTER_SELECTOR = ".seeall-card-poster-image";
const POSTERS_PER_FRAME = 4;
const COMMIT_BUDGET_MS = 4;

function frameTime() {
  try {
    const now = globalThis.performance?.now?.();
    if (Number.isFinite(now)) return now;
  } catch (_) {}
  return Date.now();
}

function releaseImage(image) {
  const src = image.getAttribute("src");
  if (!src) return;
  image.dataset.src = src;
  // Setting src to an empty string can request the app document on old TVs.
  image.removeAttribute("src");
}

function cancelFrame(state) {
  if (state.frame != null) cancelAnimationFrame(state.frame);
  state.frame = null;
}

function stateFor(owner, scrollerSelector) {
  if (owner.vidaaGridPosterWindow) return owner.vidaaGridPosterWindow;
  const state = (owner.vidaaGridPosterWindow = {
    scrollerSelector,
    resident: new Set(),
    queue: [],
    frame: null,
    timer: null,
    needsScan: false,
    onResize: null
  });
  state.onResize = () => {
    if (owner.vidaaGridPosterWindow !== state) return;
    owner.buildNavigationModel?.();
    scheduleVidaaGridPosterWindow(owner, scrollerSelector);
  };
  globalThis.window?.addEventListener?.("resize", state.onResize);
  return state;
}

export function disposeVidaaGridPosterWindow(owner) {
  const state = owner.vidaaGridPosterWindow;
  if (!state) return;
  cancelFrame(state);
  if (state.timer != null) clearTimeout(state.timer);
  globalThis.window?.removeEventListener?.("resize", state.onResize);
  for (const image of state.resident) releaseImage(image);
  state.resident.clear();
  state.queue = [];
  owner.vidaaGridPosterWindow = null;
}

export function captureVidaaGridPosters(owner) {
  const posters = new Map();
  for (const image of owner.vidaaGridPosterWindow?.resident || []) {
    if (!image.isConnected || !image.complete || image.naturalWidth <= 0) continue;
    const card = image.closest(".seeall-card");
    const src = image.getAttribute("src");
    if (card && src) posters.set(posterKey(card, src), image);
  }
  return posters;
}

export function restoreVidaaGridPosters(owner, posters) {
  if (!posters?.size) return;
  owner.container?.querySelectorAll(`${POSTER_SELECTOR}[data-src]`).forEach((image) => {
    const card = image.closest(".seeall-card");
    if (!card) return;
    const key = posterKey(card, image.dataset.src);
    const loaded = posters.get(key);
    if (!loaded) return;
    loaded.alt = image.alt;
    image.parentNode.replaceChild(loaded, image);
    posters.delete(key);
  });
}

function posterKey(card, src) {
  return JSON.stringify([card.dataset.itemType, card.dataset.itemId || card.dataset.focusKey, src]);
}

export function scheduleVidaaGridPosterWindow(owner, scrollerSelector) {
  if (
    !owner.container ||
    owner.container.isConnected === false ||
    owner.container.style?.display === "none"
  )
    return;
  const state = stateFor(owner, scrollerSelector);
  // Coalesce scroll/focus events into one frame, then measure the latest
  // viewport before assigning sources. Cancelling the frame on every scroll
  // would starve the visible posters throughout an animated/held scroll.
  state.needsScan = true;
  state.queue = [];
  if (isVidaaNavigationBusy()) {
    if (state.timer == null) {
      const resumePrefetch = () => {
        state.timer = null;
        if (owner.vidaaGridPosterWindow !== state) return;
        if (isVidaaNavigationBusy()) state.timer = setTimeout(resumePrefetch, 60);
        else scheduleVidaaGridPosterWindow(owner, scrollerSelector);
      };
      state.timer = setTimeout(resumePrefetch, 60);
    }
  } else {
    if (state.timer != null) clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.frame == null) state.frame = requestAnimationFrame(() => runFrame(owner, state));
}

function runFrame(owner, state) {
  state.frame = null;
  if (owner.vidaaGridPosterWindow !== state) return;
  if (state.needsScan) {
    state.needsScan = false;
    scanWindow(owner, state);
  }
  if (owner.vidaaGridPosterWindow !== state) return;
  commitBatch(state);
  if (state.queue.length) state.frame = requestAnimationFrame(() => runFrame(owner, state));
}

function scanWindow(owner, state) {
  const scroller = owner.container?.querySelector(state.scrollerSelector);
  const rows = owner.navModel?.rows;
  if (!scroller || scroller.isConnected === false || !rows?.length) {
    disposeVidaaGridPosterWindow(owner);
    return;
  }
  const viewport = scroller.getBoundingClientRect();
  const height = Math.max(1, Number(viewport.height || viewport.bottom - viewport.top));
  const idlePrefetch = Math.max(320, Math.min(640, height));
  // During held navigation spend work on the actual viewport only. Keep its
  // posters progressing; fill the larger runway once input becomes quiet.
  const prefetch = isVidaaNavigationBusy() ? 0 : idlePrefetch;
  const retention = Math.max(idlePrefetch * 2, height * 2.5);
  const rowRects = new Map();
  const rectForRow = (index) => {
    if (!rowRects.has(index)) rowRects.set(index, rows[index]?.[0]?.getBoundingClientRect());
    return rowRects.get(index);
  };
  // Reuse the actual navigation rows: no estimated card heights or columns,
  // and no all-image geometry scan as a paged grid grows.
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rectForRow(middle).bottom < viewport.top - prefetch) low = middle + 1;
    else high = middle;
  }
  const candidates = [];
  for (let index = low; index < rows.length; index++) {
    const rect = rectForRow(index);
    if (rect.top > viewport.bottom + prefetch) break;
    const distance = Math.max(viewport.top - rect.bottom, rect.top - viewport.bottom, 0);
    candidates.push({ index, distance });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const release = [];
  for (const image of state.resident) {
    const card = image.isConnected ? image.closest(".seeall-card") : null;
    const row = Number(card?.dataset.navRow);
    const rect = Number.isInteger(row) && row >= 0 && row < rows.length ? rectForRow(row) : null;
    if (!rect || rect.bottom < viewport.top - retention || rect.top > viewport.bottom + retention) {
      release.push(image);
    }
  }
  const queued = new Set();
  for (const { index } of candidates) {
    for (const card of rows[index]) {
      const image = card.querySelector(POSTER_SELECTOR);
      if (!image || !image.isConnected) continue;
      if (image.getAttribute("src")) {
        state.resident.add(image);
      } else if (image.dataset.src && !queued.has(image)) {
        queued.add(image);
        state.queue.push(image);
      }
    }
  }
  // Finish geometry before changing image sources or starting any requests.
  for (const image of release) {
    releaseImage(image);
    state.resident.delete(image);
  }
}

function commitBatch(state) {
  const startedAt = frameTime();
  for (let assigned = 0; state.queue.length && assigned < POSTERS_PER_FRAME; assigned++) {
    if (assigned > 0 && frameTime() - startedAt >= COMMIT_BUDGET_MS) break;
    const image = state.queue.shift();
    const src = String(image.dataset.src || "").trim();
    if (!image.isConnected || !src) continue;
    image.loading = "eager";
    image.removeAttribute("data-src");
    image.src = src;
    state.resident.add(image);
  }
}
