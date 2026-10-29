import {
  StreamScreen,
  StreamBadgeSettingsStore,
  DebridSettingsStore,
  STREAM_DPAD_REPEAT_THROTTLE_MS,
  clamp,
  getDpadDirection,
  isBackEvent,
  normalizeAddonLogoUrl,
  resolveAddonLogo,
  t
} from "../../screens/stream/streamScreen.js";
import { createSourcesRenderer } from "./sourcesRenderer.js";
import { filterNames, findSourceRow, rowBadges, rowKeys } from "./sourcesModel.js";

// New TV Sources screen (beta): the StreamScreen data logic (loading, chips, playback, Back, party)
// is inherited; only the view is replaced by a recycled pool of fixed-height rows. Focus keeps the
// StreamScreen shape ({ zone: "filter", index } or { zone: "card", row }) so inherited code still
// drives it; the row key is kept so arriving sources do not move the focused source.
export const NewSourcesScreen = {
  ...StreamScreen,

  // The view factory, a property so Node tests can run the inherited logic with a recording view.
  createSourcesRenderer,

  render() {
    this.cancelScheduledRender();
    this.syncAutoPlayUiState();
    if (this.autoPlayUiActive) {
      // The automatic play loading screen replaces the whole view, with the StreamScreen markup.
      this.disposeSourcesView();
      StreamScreen.render.call(this);
      return;
    }
    // Badge settings are read once per view: rowBadges caches its chips for this snapshot.
    const badgeSettings = (this.sourcesBadgeSettings ||= {
      ...StreamBadgeSettingsStore.snapshot(),
      enabled: DebridSettingsStore.get().streamBadgesEnabled !== false
    });
    if (!this.sourcesRenderer) {
      this.renderedMarkup = null;
      this.sourcesRenderer = this.createSourcesRenderer(this.container, {
        header: {
          ...this.getHeaderMeta(),
          backdrop: this.getBackdropUrl(),
          logo: this.params?.logo || ""
        },
        skeletonMarkup: this.renderLoadingCards(3),
        moreMarkup: this.renderLoadingCards(1),
        badgesOnTop: badgeSettings.badgePlacement === "TOP"
      });
    }
    // Continue Watching resume: its StreamScreen overlay covers the shell; no rows are drawn under it.
    this.sourcesRenderer.setOverlay(this.renderContinueWatchingResumeOverlay());
    if (this.autoResumeUiActive) return;
    const names = this.getOrderedFilterNames();
    if (this.addonFilter !== "all" && !names.includes(this.addonFilter)) {
      // An error chip can disappear after the user selected it (StreamScreen.refreshSourceChipsOnly).
      this.addonFilter = "all";
      this.streamVirtualFocusReset = true;
      this.focusState = this.getFilteredStreams("all").length
        ? { zone: "card", row: 0, action: "play" }
        : { zone: "filter", index: 1 };
    }
    const items = this.getFilteredStreams();
    const keys = rowKeys(items);
    const row = Number(this.focusState?.row);
    // StreamScreen focuses preferredStreamId at the end of the search; here as soon as it arrives.
    const preferredId = String(this.params?.preferredStreamId || "").trim();
    // A party link shown first keeps the focus (StreamScreen bindStreamParty), as for a user move.
    const preferredRow =
      preferredId && !this.streamUserMovedFocus && !items[0]?.partyShared
        ? items.findIndex((stream) => String(stream?.id || "") === preferredId)
        : -1;
    // New earlier sources replace the initial first result; once the user moved, keep the source.
    const holdFirstResult =
      this.focusState?.zone === "card" && row === 0 && !this.streamUserMovedFocus;
    // As in StreamScreen, the focused row indexes the rendered list (inherited code may set it);
    // a focus restored from the player carries the key and source of its row (captureRouteState).
    const card = this.focusState?.zone === "card" ? this.focusState : null;
    const focusedKey = card ? card.key || this.sourcesView?.keys[row] || "" : "";
    const focusedId = card ? String(card.streamId ?? this.sourcesView?.items[row]?.id ?? "") : "";
    if (preferredRow >= 0 && !this.streamVirtualFocusReset) {
      this.focusState = { zone: "card", row: preferredRow, index: preferredRow, action: "play" };
    } else if (card && !holdFirstResult && !this.streamVirtualFocusReset) {
      const index = findSourceRow(items, keys, focusedKey, focusedId);
      if (index >= 0) this.focusState = { ...this.focusState, row: index, index };
    }
    const pending = this.hasPendingSourceLoads();
    this.sourcesView = { items, keys, chipKeys: ["all", ...names] };
    this.normalizeSourcesFocus();
    this.sourcesRenderer.update(
      {
        ...this.sourcesView,
        ...this.sourcesChipView(),
        isPartySource: (stream) => Boolean(this.isPartySourceStream?.(stream)),
        showAddonLogo: badgeSettings.showAddonLogo === true,
        badgesFor: (stream) => rowBadges(stream, badgeSettings),
        logoFor: (stream) =>
          normalizeAddonLogoUrl(stream.addonLogo) ||
          resolveAddonLogo(stream.addonName, this.addonLogoLookup),
        // The empty state stays global: another addon may still provide sources.
        loading: !items.length && (pending || this.hasPendingSourceLoads("all")),
        more: items.length > 0 && pending,
        message: this.error || t("sources_no_streams", {}, "No streams found"),
        resetScroll: Boolean(this.streamVirtualFocusReset)
      },
      this.focusState
    );
    this.streamVirtualFocusReset = false;
  },

  /** Clamps the focus to the current rows and chips. */
  normalizeSourcesFocus() {
    const { items, chipKeys } = this.sourcesView;
    const focus = this.focusState || {};
    if (focus.zone === "card" && items.length) {
      const row = clamp(Number(focus.row || 0), 0, items.length - 1);
      this.focusState = { zone: "card", row, index: row, action: "play" };
    } else {
      const index =
        focus.zone === "filter"
          ? Number(focus.index || 0)
          : 1 + Math.max(0, chipKeys.indexOf(this.addonFilter));
      this.focusState = { zone: "filter", index: clamp(index, 0, chipKeys.length) };
    }
  },

  applySourcesFocus() {
    this.normalizeSourcesFocus();
    this.sourcesRenderer.setFocus(this.focusState);
  },

  moveSourcesFocus(direction) {
    const { items, chipKeys } = this.sourcesView;
    const focus = this.focusState;
    const step = direction === "left" || direction === "up" ? -1 : 1;
    if (focus.zone === "filter") {
      if (direction === "left" || direction === "right") {
        const next = clamp(focus.index + step, 0, chipKeys.length);
        if (next) this.setAddonFilter(chipKeys[next - 1], "filter", next);
        else {
          this.focusState = { zone: "filter", index: 0 };
          this.applySourcesFocus();
        }
      } else if (direction === "down" && items.length) {
        this.focusState = { zone: "card", row: 0, action: "play" };
        this.applySourcesFocus();
      }
      return;
    }
    if (direction === "left" || direction === "right") {
      const current = Math.max(0, chipKeys.indexOf(this.addonFilter));
      this.setAddonFilter(
        chipKeys[clamp(current + step, 0, chipKeys.length - 1)],
        "card",
        focus.row
      );
      return;
    }
    this.focusState =
      direction === "up" && focus.row === 0
        ? { zone: "filter", index: 1 + Math.max(0, chipKeys.indexOf(this.addonFilter)) }
        : { zone: "card", row: focus.row + step, action: "play" };
    this.applySourcesFocus();
  },

  activateSourcesFocus() {
    const focus = this.focusState;
    if (focus.zone === "card") {
      const stream = this.sourcesView.items[focus.row];
      if (stream) this.playStream(stream.id);
    } else if (focus.index === 0) this.refreshStreams();
    else this.setAddonFilter(this.sourcesView.chipKeys[focus.index - 1], "filter", focus.index);
  },

  onKeyDown(event) {
    // Back and the automatic play overlay keep the StreamScreen handling.
    if (!this.sourcesRenderer || this.autoPlayUiActive || isBackEvent(event)) {
      StreamScreen.onKeyDown.call(this, event);
      return;
    }
    // The resume overlay hides the list: only Back acts, as in StreamScreen.
    if (this.autoResumeUiActive) return;
    // Inherited data code may have set the focus since the last render.
    this.normalizeSourcesFocus();
    const direction = getDpadDirection(event);
    if (direction) {
      event?.preventDefault?.();
      if (event?.repeat) {
        const now = Date.now();
        if (now - Number(this.streamLastNavigationRepeatAt || 0) < STREAM_DPAD_REPEAT_THROTTLE_MS)
          return;
        this.streamLastNavigationRepeatAt = now;
      }
      this.streamUserMovedFocus = true;
      this.moveSourcesFocus(direction);
      return;
    }
    // A held OK must not start the source again.
    if (Number(event?.keyCode || 0) !== 13 || event?.repeat) return;
    this.activateSourcesFocus();
  },

  onPointerFocus(target) {
    if (!this.sourcesRenderer || !target || !this.container?.contains(target)) return false;
    const node = target.closest?.(
      ".stream-route-chip[data-chip-index], [data-action='playStream'][data-stream-row]"
    );
    if (!node) return false;
    this.streamUserMovedFocus = true;
    this.focusState = node.dataset.chipIndex
      ? { zone: "filter", index: Number(node.dataset.chipIndex) }
      : { zone: "card", row: Number(node.dataset.streamRow), action: "play" };
    this.applySourcesFocus();
    return true;
  },

  onPointerActivate(target) {
    const action = target?.closest?.("[data-action]")?.dataset.action;
    if (!this.sourcesRenderer || (action !== "setFilter" && action !== "playStream")) {
      return StreamScreen.onPointerActivate.call(this, target);
    }
    if (!this.onPointerFocus(target)) return false;
    if (action === "playStream") this.playStream(target.closest("[data-action]").dataset.streamId);
    else this.activateSourcesFocus();
    return true;
  },

  sourcesChipView() {
    return {
      chipKeys: this.sourcesView.chipKeys,
      filter: this.addonFilter,
      chipStatus: (name) => this.sourceChips.find((chip) => chip.name === name)?.status || "success"
    };
  },

  /** Error chip cleanup: updates the chips alone; the focused chip keeps its addon. */
  refreshSourceChipsOnly() {
    if (!this.sourcesRenderer || !this.sourcesView) return false;
    const names = this.getOrderedFilterNames();
    // The selected chip is gone: render() falls back to All.
    if (this.addonFilter !== "all" && !names.includes(this.addonFilter)) return false;
    const focusedChip =
      this.focusState?.zone === "filter" && this.focusState.index > 0
        ? this.sourcesView.chipKeys[this.focusState.index - 1]
        : null;
    this.sourcesView = { ...this.sourcesView, chipKeys: ["all", ...names] };
    this.sourcesRenderer.updateChips(this.sourcesChipView());
    if (focusedChip !== null) {
      const index = this.sourcesView.chipKeys.indexOf(focusedChip);
      if (index >= 0) this.focusState = { zone: "filter", index: index + 1 };
      this.applySourcesFocus();
    }
    return true;
  },

  // setAddonFilter's render() already restarts the window of a new filter (streamVirtualFocusReset).
  applyAddonFilterInPlace() {
    return false;
  },

  getOrderedFilterNames() {
    return filterNames(this.streams, this.sourceChips);
  },

  /**
   * StreamScreen snapshot, plus the focused row's key and stream id in its focusState: the
   * inherited mount restores focusState as is, and render() finds the source again by key, then
   * by id, wherever late or reattached sources moved it. listScrollTop is unused here.
   */
  captureRouteState() {
    const state = StreamScreen.captureRouteState.call(this);
    const row = Number(this.focusState?.row);
    const stream = this.focusState?.zone === "card" ? this.sourcesView?.items[row] : null;
    if (stream) {
      state.focusState = {
        ...state.focusState,
        key: this.sourcesView.keys[row],
        streamId: String(stream.id ?? "")
      };
    }
    return state;
  },

  disposeSourcesView() {
    this.sourcesRenderer?.dispose();
    this.sourcesRenderer = null;
    this.sourcesView = null;
    this.sourcesBadgeSettings = null;
  },

  cleanup() {
    StreamScreen.cleanup.call(this);
    this.disposeSourcesView();
  }
};
