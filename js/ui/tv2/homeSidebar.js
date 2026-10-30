import {
  getRootSidebarNodes,
  renderRootSidebar,
  setModernSidebarPillIconOnly
} from "../components/sidebarNavigationHelpers-03-render-root-sidebar.js";

/**
 * Root sidebar of the new Home (legacy rail or modern pill), shared by the DOM and WebGL renderers
 * (lot W6): it stays DOM, above the canvas. `markup()` goes inside `.tv2-home`; the class writes
 * are the current Home's setModernSidebarExpanded / setLegacySidebarExpanded fast paths.
 */
export function createHomeSidebar(container, layout = {}) {
  let open = false;
  let pillIconOnly = false;
  const selector = layout.modernSidebar ? ".modern-sidebar-shell" : ".home-sidebar";
  return {
    markup: () => renderRootSidebar({ selectedRoute: "home", layout }),

    setOpen(value) {
      open = Boolean(value);
      container.querySelector(".tv2-home")?.classList.toggle("tv2-sidebar-open", open);
      const sidebar = container.querySelector(selector);
      if (layout.modernSidebar) {
        sidebar?.classList.toggle("expanded", open);
        sidebar?.classList.toggle("panel-visible", open);
        container
          .querySelector(".modern-sidebar-panel")
          ?.setAttribute("aria-hidden", open ? "false" : "true");
        return;
      }
      sidebar?.classList.toggle("expanded", open);
      // Labels show only with content-expanded, as the current Home's setLegacySidebarExpanded.
      sidebar?.classList.toggle("content-expanded", open);
    },

    setProfile(profile) {
      const sidebar = container.querySelector(selector);
      if (!sidebar) return;
      sidebar.outerHTML = renderRootSidebar({
        selectedRoute: "home",
        layout,
        profile,
        expanded: open,
        pillIconOnly
      });
    },

    /** Modern sidebar pill (modernSidebar): icon only or with its label. */
    setPill(iconOnly) {
      pillIconOnly = Boolean(iconOnly);
      setModernSidebarPillIconOnly(container, pillIconOnly);
    },

    /** Legacy items, or the modern panel's (the pill itself is not a stop). */
    items: () => getRootSidebarNodes(container, layout)
  };
}
