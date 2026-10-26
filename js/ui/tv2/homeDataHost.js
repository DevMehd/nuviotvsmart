import { nextShuffleVisit } from "../../core/player/episodeShuffle.js";
import { createHomeScreenMethods03 } from "../screens/home/homeScreenMethods-03-is-scroll-animation-active.js";
import { createHomeScreenMethods22 } from "../screens/home/homeScreenMethods-22-pick-initial-hero.js";
import { createHomeScreenMethods24 } from "../screens/home/homeScreenMethods-24-schedule-home-lazy-image-hydration.js";
import { createHomeScreenMethods25 } from "../screens/home/homeScreenMethods-25-build-episode-progress-index.js";
import { createHomeScreenMethods26 } from "../screens/home/homeScreenMethods-26-build-next-up-items.js";
import { createHomeScreenMethods27 } from "../screens/home/homeScreenMethods-27-enrich-continue-watching.js";

/**
 * The current Home's data methods (catalog fetch, release filter, row order, runtime batch sizes,
 * Continue Watching / Next Up enrichment and snapshot) hosted without DOM for the new Home (nuv-091),
 * so both load the same rows.
 */
export function createHomeDataHost({ layoutPrefs = {} } = {}) {
  return {
    ...createHomeScreenMethods03(),
    ...createHomeScreenMethods22(),
    ...createHomeScreenMethods24(),
    ...createHomeScreenMethods25(),
    ...createHomeScreenMethods26(),
    ...createHomeScreenMethods27(),
    layoutPrefs,
    collections: [],
    shuffleVisit: nextShuffleVisit(),
    continueWatchingDisplay: []
  };
}
