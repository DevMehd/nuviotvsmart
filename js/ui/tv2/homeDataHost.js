import { createHomeScreenMethods03 } from "../screens/home/homeScreenMethods-03-is-scroll-animation-active.js";
import { createHomeScreenMethods22 } from "../screens/home/homeScreenMethods-22-pick-initial-hero.js";

/**
 * The current Home's data methods (catalog fetch, release filter, row order, runtime batch sizes)
 * hosted without DOM for the new Home (nuv-091), so both load the same rows.
 */
export function createHomeDataHost({ layoutPrefs = {} } = {}) {
  return {
    ...createHomeScreenMethods03(),
    ...createHomeScreenMethods22(),
    layoutPrefs,
    collections: []
  };
}
