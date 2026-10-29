// View model of the new TV Sources screen (beta): pure functions, memoised by identity.
import { Environment } from "../../../platform/environment.js";
import { normalizeStreamDisplayText } from "../../../core/streams/streamDisplayText.js";
import { railWindow } from "../railEngine.js";
import { streamRowKeys } from "../../screens/stream/streamScreenHelpers-01-stream-badge-limit.js";
import {
  getAddonBadgeLabel,
  getStreamDescriptionLines,
  getStreamHeadline,
  getStreamQuality
} from "../../screens/stream/streamScreenHelpers-02-flatten-streams.js";
import { getOrderedFilterNames } from "../../screens/stream/streamScreenHelpers-03-render-image-badge-chip.js";

// Fixed row geometry (tv2-sources.css): the list is never measured.
export const SOURCES_ROW_HEIGHT = 168;
export const SOURCES_ROW_GAP = 12;
export const SOURCES_ROW_PITCH = SOURCES_ROW_HEIGHT + SOURCES_ROW_GAP;
// Inner height of .tv2-sources .stream-route-list: five rows and their four gaps.
export const SOURCES_LIST_VIEWPORT = 5 * SOURCES_ROW_HEIGHT + 4 * SOURCES_ROW_GAP;
// Source description lines kept on a card (decision 1: the card clamps them to two lines).
export const SOURCES_DESCRIPTION_LINES = 2;

/** Rows drawn and the track offset: the camera moves only when the focus leaves the visible rows. */
export function sourcesWindow({ count, focusRow = -1, first = 0 }) {
  // The last visible row needs no trailing gap.
  const viewport = SOURCES_LIST_VIEWPORT + SOURCES_ROW_GAP;
  const visible = Math.max(1, Math.floor(viewport / SOURCES_ROW_PITCH));
  let top = Math.max(0, Math.min(first, count - visible));
  if (focusRow >= 0 && focusRow < count) {
    if (focusRow < top) top = focusRow;
    else if (focusRow >= top + visible) top = focusRow - visible + 1;
  }
  const frame = railWindow({
    count,
    focusIndex: Math.max(0, focusRow),
    pitch: SOURCES_ROW_PITCH,
    viewport,
    first: top
  });
  return { ...frame, first: top };
}

const rowKeysCache = new WeakMap();
/** streamRowKeys of a filtered list, computed once per list. */
export function rowKeys(items) {
  let keys = rowKeysCache.get(items);
  if (!keys) {
    keys = streamRowKeys(items);
    rowKeysCache.set(items, keys);
  }
  return keys;
}

let lastFilterNames = null;
/** Filter chip names, recomputed only when the sources or their chips change. */
export function filterNames(streams, chips) {
  if (lastFilterNames?.streams !== streams || lastFilterNames.chips !== chips)
    lastFilterNames = { streams, chips, names: getOrderedFilterNames(chips, streams) };
  return lastFilterNames.names;
}

const readable = (text) =>
  Environment.isVidaa() || Environment.isWebOS() ? normalizeStreamDisplayText(text) : text;
const rowModels = new WeakMap();
/** Text of a source card, computed once per stream object (streams are replaced, never mutated). */
export function rowViewModel(stream) {
  let model = rowModels.get(stream);
  if (!model) {
    model = {
      id: String(stream.id ?? ""),
      headline: getStreamHeadline(stream),
      quality: getStreamQuality(stream),
      description: getStreamDescriptionLines(stream).slice(0, SOURCES_DESCRIPTION_LINES).join("\n"),
      addonName: readable(String(stream.addonName || "Addon")),
      addonLabel: getAddonBadgeLabel(stream.addonName || ""),
      partyShared: Boolean(stream.partyShared),
      partyHostName: String(stream.partyHostName || "")
    };
    rowModels.set(stream, model);
  }
  return model;
}
