// View model of the new TV Sources screen (beta): pure functions, memoised by identity.
import { Environment } from "../../../platform/environment.js";
import { normalizeStreamDisplayText } from "../../../core/streams/streamDisplayText.js";
import { railWindow } from "../railEngine.js";
import { normalizeAddonLogoUrl } from "../../../core/media/addonLogoCache.js";
import { getStreamImageBadges } from "../../../core/streams/streamBadgePresets.js";
import { normalizeStreamBadgeChipColor } from "../../../core/streams/streamBadgeRules.js";
import { getStreamPresentationBadges } from "../../../core/streams/streamPresentationBadges.js";
import {
  formatBytes,
  STREAM_BADGE_LIMIT,
  streamRowKeys,
  t
} from "../../screens/stream/streamScreenHelpers-01-stream-badge-limit.js";
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
// Badge chips of a card: the nine images of the current screen (or its technical chips), then the size.
export const SOURCES_BADGE_SLOTS = STREAM_BADGE_LIMIT + 1;
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

const rowBadgeModels = new WeakMap();
/**
 * Badge chips of a source card in the current screen's order (renderImportedStreamBadgeChipContents):
 * image badges, technical chips only without an image, then the size. Computed once per stream and
 * settings object; `settings` is a StreamBadgeSettingsStore snapshot plus `enabled`.
 */
export function rowBadges(stream, settings) {
  const cached = rowBadgeModels.get(stream);
  if (cached?.settings === settings) return cached.badges;
  const badges = [];
  if (settings.enabled) {
    for (const badge of getStreamImageBadges(stream, settings).slice(0, STREAM_BADGE_LIMIT)) {
      const url = normalizeAddonLogoUrl(badge.imageURL);
      if (!url) continue;
      const filled = /^filled(?:\s|$)/i.test(String(badge.tagStyle || "").trim());
      const background = normalizeStreamBadgeChipColor(badge.tagColor);
      const outline = normalizeStreamBadgeChipColor(badge.borderColor);
      const color = normalizeStreamBadgeChipColor(badge.textColor);
      badges.push({
        kind: "image",
        url,
        filled,
        alt: String(badge.name || ""),
        style: [
          filled && background ? `background:${background};` : "",
          outline ? `border-color:${outline};` : "",
          color ? `color:${color};` : ""
        ].join("")
      });
    }
    // At most nine labels (getStreamPresentationBadges), so every chip has a slot.
    if (!badges.length)
      getStreamPresentationBadges(stream, t("trakt_cached_label", {}, "En cache")).forEach((text) =>
        badges.push({ kind: "technical", text })
      );
    const size = stream.behaviorHints?.videoSize;
    if (settings.showFileSizeBadges !== false && size != null)
      badges.push({
        kind: "size",
        text: t("streams_size", [formatBytes(size)], `SIZE ${formatBytes(size)}`)
      });
  }
  rowBadgeModels.set(stream, { settings, badges });
  return badges;
}
