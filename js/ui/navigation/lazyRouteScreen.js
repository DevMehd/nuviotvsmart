import { Router } from "./routerState.js";

// Used only by the VIDAA module build (scripts/build-vidaa-modules.mjs): a router
// screen whose code is fetched on its first mount, then put in its route slot.
const RELOAD_FLAG = "nuvio-lazy-route-reload";

function storage() {
  try {
    return globalThis.sessionStorage || null;
  } catch (_) {
    return null;
  }
}

export function lazyRouteScreen(load) {
  let pending = null;
  let routeName = "";
  const placeholder = {
    async mount(params, context) {
      // "home" is a getter without setter and is never lazy.
      routeName ||= Object.keys(Router.routes || {}).find(
        (name) => name !== "home" && Router.routes[name] === placeholder
      );
      pending ||= load().catch((error) => {
        pending = null;
        throw error;
      });
      let Screen;
      try {
        Screen = await pending;
      } catch (error) {
        // A chunk of a replaced deployment is gone: reload once into the new build.
        const store = storage();
        if (store && !store.getItem(RELOAD_FLAG) && globalThis.location?.reload) {
          store.setItem(RELOAD_FLAG, "1");
          globalThis.location.reload();
          return;
        }
        throw error;
      }
      storage()?.removeItem(RELOAD_FLAG);
      if (routeName) Router.routes[routeName] = Screen;
      // The user left (or reopened with other params) while the chunk loaded.
      if (Router.current !== routeName || Router.currentParams !== params) return;
      return Screen.mount(params, context);
    }
  };
  return placeholder;
}
