// Animate only the two active artwork layers. Web Animations avoids the
// synchronous layout flush used to restart CSS transitions on a reused image.
const transitions = new WeakMap();

export function useVidaaHeroTransition(image) {
  return Boolean(
    image?.animate &&
    globalThis.document?.documentElement?.classList?.contains("vidaa-balanced-motion") &&
    !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
}

export function finishVidaaHeroTransition(image) {
  const state = transitions.get(image);
  if (!state) return;
  transitions.delete(image);
  clearTimeout(state.timer);
  for (const animation of state.animations) animation.cancel();
  state.ghost?.remove();
}

export function swapVidaaHeroImage(image, source, alt, kind, duration = 200) {
  finishVidaaHeroTransition(image);
  if (!image.isConnected) return;
  const previous = image.getAttribute("src");
  const ghostClass = `home-hero-${kind}-transition-ghost`;
  image.classList.remove(`home-hero-${kind}-transition-enter`, "is-visible", "placeholder");
  let ghost = null;
  // Keep the previous picture underneath the incoming one; never fade through
  // an empty background. Oversized source images retain the single-layer path.
  if (
    previous &&
    previous !== source &&
    image.parentElement &&
    image.naturalWidth * image.naturalHeight <= 2000000
  ) {
    ghost = image.cloneNode(false);
    ghost.classList.add(ghostClass);
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("id");
    ghost.removeAttribute("onerror");
    ghost.style.transition = "none";
    image.parentElement.insertBefore(ghost, image);
  }
  image.setAttribute("src", source);
  image.setAttribute("alt", alt);
  const state = { ghost, animations: [], timer: null };
  transitions.set(image, state);
  try {
    state.animations.push(
      image.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration,
        easing: "cubic-bezier(0.2, 0, 0, 1)"
      })
    );
    if (ghost && kind === "logo") {
      state.animations.push(
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: "forwards" })
      );
    }
    state.timer = setTimeout(() => {
      if (transitions.get(image) === state) finishVidaaHeroTransition(image);
    }, duration + 34);
  } catch {
    // Some TV engines expose animate() but reject part of its implementation.
    finishVidaaHeroTransition(image);
  }
}
