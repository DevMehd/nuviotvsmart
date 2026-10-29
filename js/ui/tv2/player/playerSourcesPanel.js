// In-player Sources of the new VIDAA player (lot P, P5): the route's candidates, an addon
// filter, sources that failed in this run, and a reload on request only (never while the list
// is just open: no addon request during playback unless the user asks). Switching stays with
// the screen and is always user-driven. No DOM: the screen renders the rows in its side panel.
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { orderStreamsByAddonOrder } from "../../../core/streams/streamOrdering.js";
import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";
import {
  flattenStreams,
  mergeStreamItems
} from "../../screens/stream/streamScreenHelpers-02-flatten-streams.js";
import { streamMergeKey } from "../../screens/stream/streamScreenHelpers-01-stream-badge-limit.js";

/** Rows rendered at once around the focus (hundreds of cards froze 4K playback on VIDAA). */
export const SOURCE_WINDOW = 9;

/** First rendered row so that the focus stays inside a window of `size` rows. */
export function sourceWindowStart(length, focus, size = SOURCE_WINDOW) {
  return Math.max(0, Math.min(focus - Math.floor(size / 2), length - size));
}

const keyOf = (stream) => (stream ? streamMergeKey(stream) || String(stream.id || "") : "");

/**
 * params: the route params (streamCandidates, itemType, videoId/itemId, season, episode).
 * onChange(): called when the list, the loading state or a failure mark changes.
 */
export function createPlayerSources(
  params = {},
  { repository = streamRepository, onChange = () => {} } = {}
) {
  let items = mergeStreamItems(
    [],
    Array.isArray(params.streamCandidates) ? params.streamCandidates : []
  );
  let filter = "all";
  let loadToken = 0;
  let controller = null;
  const failed = new Set();
  const state = { loading: false, error: false };

  const ordered = () =>
    orderStreamsByAddonOrder(items, [], {
      isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
    });
  const filters = () => [
    "all",
    ...new Set(
      ordered()
        .map((stream) => String(stream?.addonName || "").trim())
        .filter(Boolean)
    )
  ];

  function cancel() {
    controller?.abort?.();
    controller = null;
    loadToken += 1;
    if (state.loading) {
      state.loading = false;
      onChange();
    }
    // Same as the old closeSourcesPanel: local plugin searches stop with the panel.
    repository.setLocalPluginSearchPaused?.(true);
  }

  return {
    get loading() {
      return state.loading;
    },
    get error() {
      return state.error;
    },
    get filter() {
      return filter;
    },
    filters,
    /** Ordered sources of the current filter. */
    list() {
      const all = ordered();
      return filter === "all" ? all : all.filter((stream) => stream.addonName === filter);
    },
    /** Left/Right: the next addon filter, wrapping. */
    cycleFilter(step) {
      const all = filters();
      filter = all[(all.indexOf(filter) + step + all.length) % all.length] || "all";
    },
    /** A synthetic route link is not in the candidates: it is listed so the focus can find it. */
    include(stream) {
      if (stream && !items.some((item) => item === stream || keyOf(item) === keyOf(stream)))
        items = [stream, ...items];
    },
    isSame(a, b) {
      return Boolean(a && b && (a === b || (keyOf(a) && keyOf(a) === keyOf(b))));
    },
    markFailed(stream, value = true) {
      const key = keyOf(stream);
      if (!key || failed.has(key) === value) return;
      if (value) failed.add(key);
      else failed.delete(key);
      onChange();
    },
    isFailed(stream) {
      return failed.has(keyOf(stream));
    },
    /** Same request as the old reloadSources: chunks merged as addons answer; abortable. */
    async reload() {
      const type = String(params.itemType || "movie").toLowerCase() || "movie";
      const videoId = String(params.videoId || params.itemId || "");
      if (!videoId || state.loading) return;
      repository.setLocalPluginSearchPaused?.(false);
      const token = ++loadToken;
      const abort = typeof AbortController === "function" ? new AbortController() : null;
      controller = abort;
      state.loading = true;
      state.error = false;
      onChange();
      const merge = (result) => {
        const incoming = flattenStreams(result);
        if (incoming.length) items = mergeStreamItems(items, incoming);
      };
      try {
        const result = await repository.getStreamsFromAllAddons(type, videoId, {
          itemId: String(params.itemId || ""),
          season: params.season ?? null,
          episode: params.episode ?? null,
          forceRefresh: true,
          signal: abort?.signal || null,
          onChunk: (chunk) => {
            if (token !== loadToken) return;
            merge(chunk);
            onChange();
          }
        });
        if (token === loadToken) merge(result);
      } catch (_) {
        if (token === loadToken) state.error = true;
      } finally {
        if (controller === abort) controller = null;
        if (token === loadToken) {
          state.loading = false;
          onChange();
        }
      }
    },
    cancel
  };
}
