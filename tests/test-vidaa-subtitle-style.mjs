import assert from "node:assert/strict";

globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, documentElement: {} };
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { Platform } = await import("../js/platform/index.js");
const { renderPlaybackSubtitleBody } =
  await import("../js/ui/screens/settings/settingsScreenPlaybackMarkup-04-subtitles.js");
const { registerPlaybackActionsPart02 } =
  await import("../js/ui/screens/settings/settingsScreenPlaybackActions-02.js");

function cssStyle() {
  const values = new Map();
  return {
    setProperty: (key, value) => values.set(key, value),
    removeProperty: (key) => values.delete(key),
    getPropertyValue: (key) => values.get(key) || ""
  };
}
const root = { style: cssStyle() };
const video = { style: cssStyle() };
Object.assign(PlayerController, { video, playbackEngine: "native", avplayActive: false });
const counts = { cues: 0, trackRefresh: 0, persisted: 0 };
const ui = {
  ...PlayerScreen,
  uiRefs: { root },
  subtitleDelayMs: 0,
  subtitleStyleSettings: {
    fontSize: 120,
    textColor: "#FFFFFF",
    textOpacity: 100,
    outlineColor: "#000000",
    outlineEnabled: true,
    backgroundColor: "#B3B3B380",
    verticalOffset: 0
  },
  schedulePersistPlayerPresentationSettings() {
    counts.persisted++;
  },
  persistSubtitleDelayPreference() {},
  renderSubtitleStyleControlInPlace: () => true,
  refreshSubtitleCueStyles() {
    counts.cues++;
  },
  refreshSubtitleTrackRendering() {
    counts.trackRefresh++;
  },
  renderBitmapSubtitleAtCurrentTime() {},
  isAssAddonSubtitleActive: () => false
};

const backgroundControl = ui.getSubtitleStyleControls().find(({ id }) => id === "backgroundColor");
assert.equal(backgroundControl.disabled, true);
assert.equal(backgroundControl.value, "Off");
assert.equal(ui.adjustSubtitleStyleControl("backgroundColor", 1), false);
assert.equal(
  counts.persisted,
  0,
  "Disabled background adjustments do not save an unavailable appearance"
);
ui.applySubtitlePresentationSettings({ refreshCueStyles: false });
assert.equal(root.style.getPropertyValue("--player-subtitle-background"), "transparent");
assert.equal(video.style.getPropertyValue("--player-subtitle-background"), "transparent");
assert.equal(counts.cues, 0, "Gray background must not rescan native subtitle cues");
assert.equal(
  counts.trackRefresh,
  0,
  "Gray background must not toggle native modes or create track events"
);
for (const id of ["fontSize", "textColor", "textOpacity", "bold", "outlineColor", "outlineEnabled"])
  ui.adjustSubtitleStyleControl(id, 1);
assert.equal(counts.cues, 0);
assert.equal(counts.trackRefresh, 0);
for (let index = 0; index < 50; index++)
  ui.adjustSubtitleStyleControl("backgroundColor", index % 2 ? -1 : 1, { isRepeat: true });
assert.equal(counts.cues, 0, "Repeated appearance edits remain CSS-only");
assert.equal(counts.trackRefresh, 0);
ui.adjustSubtitleStyleControl("delay", 1);
assert.equal(counts.cues, 1, "Native timing must still update when delay changes");
assert.equal(counts.trackRefresh, 0, "VIDAA delay updates never cycle native track modes");
ui.adjustSubtitleStyleControl("verticalOffset", 1);
assert.equal(counts.cues, 2, "Native position must still update when offset changes");
assert.equal(counts.trackRefresh, 0, "VIDAA offset updates never cycle native track modes");
globalThis.__NUVIO_PLATFORM__ = "tizen";
Platform.current = null;
ui.adjustSubtitleStyleControl("backgroundColor", 1);
assert.equal(counts.cues, 3, "Tizen native rendering keeps its existing refresh contract");
assert.equal(counts.trackRefresh, 1);
assert.notEqual(root.style.getPropertyValue("--player-subtitle-background"), "transparent");
for (const platform of ["vidaa", "tizen", "webos"]) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  Platform.current = null;
  const model = { player: { subtitleStyle: { backgroundColor: "#B3B3B380" } } };
  const rows = [];
  let dialogs = 0;
  const settings = {
    actionMap: new Map(),
    renderActionRow(row) {
      rows.push(row);
      return "";
    },
    renderToggleRow: () => "",
    openOptionDialog() {
      dialogs++;
    }
  };
  renderPlaybackSubtitleBody.call(settings, model);
  const row = rows.find(({ focusKey }) => focusKey === "playback:subtitleBackgroundColor");
  assert.equal(row.disabled, platform === "vidaa");
  if (platform === "vidaa")
    assert.equal(
      row.value,
      "Off",
      "Saved gray backgrounds must not appear enabled in VIDAA settings"
    );
  registerPlaybackActionsPart02.call(settings, model);
  settings.actionMap.get("playback:subtitleBackgroundColor")();
  assert.equal(
    dialogs,
    platform === "vidaa" ? 0 : 1,
    "VIDAA blocks the background action; other TVs keep the picker"
  );
}
console.log(
  "PASS VIDAA captions/UI stay transparent and appearance/delay/offset never cycle native modes; Tizen background/refresh remain active"
);
