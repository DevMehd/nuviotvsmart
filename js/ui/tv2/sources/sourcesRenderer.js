// DOM view of the new TV Sources screen (beta): the shell is written once, filter chips are kept by
// addon name and the list is a recycled pool of fixed-height rows moved with transforms. Data
// updates and focus moves only change text, attributes, classes and transforms; nothing is measured.
import { Environment } from "../../../platform/environment.js";
import { contentTextDirection } from "../../../core/util/contentTextDirection.js";
import { normalizeStreamDisplayText } from "../../../core/streams/streamDisplayText.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { escapeHtml, t } from "../../screens/stream/streamScreenHelpers-01-stream-badge-limit.js";
import { slotFor } from "../railEngine.js";
import { rowViewModel, sourcesWindow, SOURCES_ROW_PITCH } from "./sourcesModel.js";

const REFRESH_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>';

const ROW_MARKUP = `
  <article class="stream-route-card stream-route-card-action focusable" data-action="playStream" data-card-action="play" tabindex="0">
    <div class="stream-route-card-copy">
      <div class="stream-route-card-heading"><span class="tv2-sources-headline"></span><span class="stream-route-party-chip" hidden></span></div>
      <div class="stream-route-card-quality"></div>
      <div class="stream-route-card-line tv2-sources-description"></div>
    </div>
    <div class="stream-route-card-side" hidden>
      <div class="stream-route-addon-badge"><span></span></div>
      <div class="stream-route-addon-name"></div>
    </div>
  </article>`;

const textDirection = (node, text) => {
  if (node.textContent !== text) {
    node.textContent = text;
    node.setAttribute("dir", contentTextDirection(text));
  }
};

function shellMarkup({ title, logo, episodeLabel, subtitle, detailLine, isSeries, backdrop }) {
  const line = detailLine || (!isSeries && subtitle) || "";
  const text = (className, value) =>
    value
      ? `<div class="${className}" dir="${contentTextDirection(value)}">${escapeHtml(value)}</div>`
      : "";
  return `
    <div class="stream-route-shell tv2-sources">
      <div class="stream-route-backdrop"${backdrop ? ` style="background-image:url('${String(backdrop).replace(/'/g, "%27")}')"` : ""}></div>
      <div class="stream-route-backdrop-dim"></div>
      <div class="stream-route-left-gradient"></div>
      <div class="stream-route-right-gradient"></div>
      <div class="stream-route-content">
        <section class="stream-route-left">
          <div class="stream-route-left-inner">
            ${logo ? `<img src="${escapeHtml(logo)}" class="stream-route-logo" alt="${escapeHtml(title)}" />` : `<h1 class="stream-route-title" dir="${contentTextDirection(title)}">${escapeHtml(title)}</h1>`}
            ${text("stream-route-episode-code", episodeLabel)}
            ${text("stream-route-subtitle", subtitle)}
            ${text("stream-route-detail-line", line)}
          </div>
        </section>
        <section class="stream-route-right">
          <div class="stream-route-chip-wrap">
            <div class="stream-route-chip-track"><button class="stream-route-chip focusable" data-action="refreshStreams" data-chip-index="0" tabindex="0" aria-label="${escapeHtml(t("cd_refresh", {}, "Refresh"))}">${REFRESH_ICON}</button></div>
          </div>
          <div class="stream-route-panel-shell">
            <div class="stream-route-panel">
              <div class="stream-route-list">
                <div class="tv2-sources-status"></div>
                <div class="tv2-sources-track"><div class="tv2-sources-more" hidden></div></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>`;
}

/**
 * header: getHeaderMeta() plus backdrop and logo; skeletonMarkup: the loading cards shown before the
 * first source; moreMarkup: the loading card under the sources while addons are still loading.
 */
export function createSourcesRenderer(container, { header, skeletonMarkup, moreMarkup }) {
  container.innerHTML = shellMarkup(header);
  const chipTrack = container.querySelector(".stream-route-chip-track");
  const refreshChip = chipTrack.firstElementChild;
  const status = container.querySelector(".tv2-sources-status");
  const track = container.querySelector(".tv2-sources-track");
  const more = container.querySelector(".tv2-sources-more");
  more.innerHTML = moreMarkup;
  const chips = new Map();
  let chipOrder = [refreshChip];
  const pool = [];
  let view = null;
  let first = 0;
  let poolSize = 1;
  let statusKind = "";
  let focusedNode = null;

  const rowTemplate = document.createElement("div");
  rowTemplate.className = "stream-route-card-row tv2-sources-row";
  rowTemplate.hidden = true;
  rowTemplate.innerHTML = ROW_MARKUP;

  function slot(index) {
    while (pool.length <= index) {
      const row = rowTemplate.cloneNode(true);
      track.appendChild(row);
      const card = row.firstElementChild;
      pool.push({
        row,
        card,
        headline: row.querySelector(".tv2-sources-headline"),
        partyChip: row.querySelector(".stream-route-party-chip"),
        quality: row.querySelector(".stream-route-card-quality"),
        description: row.querySelector(".tv2-sources-description"),
        side: row.querySelector(".stream-route-card-side"),
        addonLabel: row.querySelector(".stream-route-addon-badge span"),
        addonName: row.querySelector(".stream-route-addon-name"),
        index: -1,
        stream: null,
        partySource: false
      });
    }
    return pool[index];
  }

  // The whole pool exists from the start: navigation never creates a node.
  slot(sourcesWindow({ count: Number.MAX_SAFE_INTEGER }).poolSize - 1);

  function fill(entry, index) {
    const stream = view.items[index];
    if (entry.index !== index) {
      entry.index = index;
      entry.row.style.transform = `translateY(${index * SOURCES_ROW_PITCH}px)`;
      entry.row.dataset.streamRow = entry.card.dataset.streamRow = String(index);
    }
    if (entry.row.dataset.streamKey !== view.keys[index])
      entry.row.dataset.streamKey = view.keys[index];
    if (entry.stream !== stream) {
      entry.stream = stream;
      const model = rowViewModel(stream);
      entry.card.dataset.streamId = model.id;
      textDirection(entry.headline, model.headline);
      textDirection(entry.quality, model.quality);
      entry.quality.hidden = !model.quality;
      textDirection(entry.description, model.description);
      entry.description.hidden = !model.description;
      entry.addonLabel.textContent = model.addonLabel;
      textDirection(entry.addonName, model.addonName);
      entry.row.classList.toggle("is-party-shared", model.partyShared);
      entry.partySource = null;
    }
    const partySource = !stream.partyShared && view.isPartySource(stream);
    if (entry.partySource !== partySource) {
      entry.partySource = partySource;
      const model = rowViewModel(stream);
      entry.card.classList.toggle("is-party-marked", model.partyShared || partySource);
      entry.partyChip.hidden = !model.partyShared && !partySource;
      entry.partyChip.textContent = model.partyShared
        ? t("party_shared_by", [model.partyHostName], "Shared by %1$s")
        : partySource
          ? t("party_source", {}, "Party's source")
          : "";
    }
    if (entry.side.hidden === view.showAddonLogo) entry.side.hidden = !view.showAddonLogo;
    if (entry.row.hidden) entry.row.hidden = false;
  }

  function layout(focusRow) {
    const count = view.items.length;
    const frame = sourcesWindow({ count, focusRow, first });
    first = frame.first;
    poolSize = frame.poolSize;
    track.style.transform = `translateY(${frame.offset}px)`;
    const used = new Set();
    for (let index = frame.start; index < frame.end; index += 1) {
      const position = slotFor(index, frame.poolSize);
      used.add(position);
      fill(slot(position), index);
    }
    pool.forEach((entry, position) => {
      if (!used.has(position) && !entry.row.hidden) entry.row.hidden = true;
    });
    more.style.transform = `translateY(${count * SOURCES_ROW_PITCH}px)`;
  }

  function chipLabel(name) {
    const label = name === "all" ? t("common.all", {}, "All") : name;
    return Environment.isVidaa() || Environment.isWebOS()
      ? normalizeStreamDisplayText(label)
      : label;
  }

  function updateChips() {
    const names = new Set(view.chipKeys);
    for (const [name, node] of chips) {
      if (!names.has(name)) {
        node.remove();
        chips.delete(name);
      }
    }
    const order = [refreshChip];
    view.chipKeys.forEach((name, position) => {
      let node = chips.get(name);
      if (!node) {
        node = document.createElement("button");
        node.className = "stream-route-chip focusable";
        node.tabIndex = 0;
        node.dataset.action = "setFilter";
        node.dataset.addon = name;
        const label = document.createElement("span");
        textDirection(label, chipLabel(name));
        node.appendChild(label);
        chips.set(name, node);
      }
      node.dataset.chipIndex = String(position + 1);
      const chipStatus = name === "all" ? "success" : view.chipStatus(name);
      const selected = name === view.filter;
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-selected", selected ? "true" : "false");
      node.classList.toggle("loading", chipStatus === "loading");
      node.classList.toggle("error", chipStatus === "error");
      const spinner = node.querySelector(".stream-route-chip-spinner");
      if (chipStatus === "loading" && !spinner)
        node.insertAdjacentHTML(
          "afterbegin",
          renderLoadingIndicator({ className: "stream-route-chip-spinner" })
        );
      else if (chipStatus !== "loading" && spinner) spinner.remove();
      order.push(node);
    });
    if (
      order.length !== chipOrder.length ||
      order.some((node, index) => chipOrder[index] !== node)
    ) {
      // Appending moves nodes; the focused chip keeps its node, so its focus survives.
      order.forEach((node) => chipTrack.appendChild(node));
      chipOrder = order;
    }
  }

  function updateStatus() {
    const kind = view.items.length ? "" : view.loading ? "loading" : "message";
    if (kind !== statusKind) {
      statusKind = kind;
      status.innerHTML =
        kind === "loading"
          ? skeletonMarkup
          : kind === "message"
            ? '<div class="stream-route-empty"></div>'
            : "";
    }
    if (kind === "message") status.firstElementChild.textContent = view.message;
    track.hidden = !view.items.length;
    more.hidden = !view.more;
  }

  function setFocus(focus) {
    const card = focus?.zone === "card" && view.items.length > 0;
    layout(card ? Number(focus.row) : -1);
    const target = card
      ? pool[slotFor(Number(focus.row), poolSize)].card
      : chipOrder[Math.max(0, Math.min(Number(focus?.index || 0), chipOrder.length - 1))];
    if (focusedNode && focusedNode !== target) focusedNode.classList.remove("focused");
    target.classList.add("focused");
    focusedNode = target;
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    // Chips have their text width: the track scrolls natively, only in the filter zone.
    if (!card) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  return {
    update(nextView, focus) {
      view = nextView;
      if (view.resetScroll) first = 0;
      updateChips();
      updateStatus();
      setFocus(focus);
    },
    setFocus,
    dispose() {
      container.innerHTML = "";
      pool.length = 0;
      chips.clear();
      view = null;
      focusedNode = null;
    }
  };
}
