import assert from "node:assert/strict";
import { selectAutoPlayStream } from "../js/core/streams/streamAutoPlaySelector.js";
import {
  normalizeStreamDisplayText,
  normalizeStreamSearchText,
  normalizeStreamMatchPattern
} from "../js/core/streams/streamDisplayText.js";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { getStreamHeadline, getStreamDescriptionLines, StreamScreen } =
  await import("../js/ui/screens/stream/streamScreen.js");
const { createPlayerScreenMethods63 } =
  await import("../js/ui/screens/player/playerScreenMethods-63-get-source-request-key.js");
const { createPlayerScreenMethods67 } =
  await import("../js/ui/screens/player/playerScreenMethods-67-render-episode-streams-view.js");

for (const [decorated, readable] of [
  ["𝐈𝐓 𝘐𝘵 𝕀𝕥 ℐ𝒯 ＩＴ ⒾⓉ 🄸🅃 🅸🆃 🅘🅣", "IT It It IT IT IT IT IT IT"],
  ["𝐈t 🇮t I\u200bT I\u200dT I\u2060T", "It It IT IT IT"],
  ["🇮🇹🇬🇧 🇯🇵", "[IT][GB] [JP]"],
  ["🅸️🆃️ 𝟜𝕂", "IT 4K"],
  ["Città 日本語 العربية 👩‍💻", "Città 日本語 العربية 👩‍💻"],
  ["�T \ud835", "�T \ud835"]
]) {
  assert.equal(normalizeStreamDisplayText(decorated), readable);
  assert.equal(normalizeStreamSearchText(decorated), readable);
}

const styledPattern = new RegExp(normalizeStreamMatchPattern("^(?!.*CAM).*\\b𝐈𝐓\\b$"));
assert.ok(styledPattern.test("Audio IT"));
assert.equal(styledPattern.test("CAM IT"), false);
const flagPattern = new RegExp(normalizeStreamMatchPattern("^🇮🇹$"));
assert.equal(flagPattern.test(normalizeStreamSearchText("🇮🇹")), true);
assert.equal(flagPattern.test("I"), false, "A flag must not become a character class");
assert.equal(new RegExp(normalizeStreamMatchPattern("\\🇮🇹")).test("[IT]"), true);
const flagClass = new RegExp(normalizeStreamMatchPattern("[🇮🇹]"));
for (const ordinary of ["I", "T", "[", "]"]) assert.equal(flagClass.test(ordinary), false);
assert.equal(normalizeStreamMatchPattern("[𝐀-𝐙]"), "[𝐀-𝐙]");
for (const pattern of ["[Ａ-Ｚ]", "[ⓐ-ⓩ]"]) {
  assert.equal(normalizeStreamMatchPattern(pattern), pattern);
  const originalClass = new RegExp(pattern);
  const preservedClass = new RegExp(normalizeStreamMatchPattern(pattern));
  for (const text of ["α", "中", "A", "Ａ"])
    assert.equal(preservedClass.test(text), originalClass.test(text));
}
assert.equal(
  selectAutoPlayStream([{ description: "𝐂𝐀𝐌 1080p", url: "https://fixture.invalid/cam" }], {
    mode: "REGEX_MATCH",
    regexPattern: "(?!.*(𝐂𝐀𝐌|TS)).*1080p"
  }),
  null
);
const urlPattern = new RegExp(normalizeStreamMatchPattern("https://fixture\\.invalid/𝐈𝐓"));
assert.equal(urlPattern.test("https://fixture.invalid/𝐈𝐓"), true);
const unchangedPattern = "^(?!.*(CAM|TS)).*\\bIT\\b[0-9]+\\.mkv$";
assert.equal(normalizeStreamMatchPattern(unchangedPattern), unchangedPattern);

const source = {
  id: "original-𝐈𝐓",
  name: "Source 𝐈t",
  title: "𝟜𝕂 🇮🇹",
  description: "Audio: 🅸🆃\n🇮🇹 / English\nCittà 日本語",
  addonName: "Fixture",
  url: "https://fixture.invalid/𝐈𝐓?token=🇮🇹"
};
const original = structuredClone(source);
assert.equal(getStreamHeadline(source), "Source It");
assert.deepEqual(getStreamDescriptionLines(source), [
  "Audio: IT",
  "[IT] / English",
  "Città 日本語"
]);
const markup = StreamScreen.renderStreamCard.call(
  { isCardActionFocused: () => false },
  source,
  0,
  false,
  { showAddonLogo: false }
);
assert.ok(markup.includes("Source It"));
assert.ok(markup.includes("Audio: IT"));
assert.ok(markup.includes("[IT] / English"));

const playerSource = { ...source, label: source.name };
const panel = {
  childNodes: [],
  classList: { toggle() {} },
  querySelector: () => null,
  innerHTML: ""
};
createPlayerScreenMethods63().renderSourcesPanel.call({
  cancelScheduledSourcesPanelRender() {},
  uiRefs: { sourcesPanel: panel },
  sourcesPanelVisible: true,
  sourcesFocus: { zone: "list", index: 0 },
  params: {},
  streamCandidates: [],
  getOrderedStreamCandidates: () => [playerSource],
  getSourceFilters: () => [],
  getFilteredSources: () => [playerSource],
  ensureSourcesFocus() {},
  syncSourcesFocusDom() {}
});
assert.ok(panel.innerHTML.includes("Source It"));
assert.ok(panel.innerHTML.includes("Audio: IT"));
assert.ok(!panel.innerHTML.includes("🅸🆃"));
const episodeMarkup = createPlayerScreenMethods67().renderEpisodeStreamsView.call({
  episodes: [],
  episodePanelIndex: 0,
  episodePanelStreamFocus: { zone: "streams", index: 0 },
  getEpisodePanelStreamFilters: () => [],
  getFilteredEpisodePanelStreams: () => [playerSource]
});
assert.ok(episodeMarkup.includes("Source It"));
assert.ok(episodeMarkup.includes("Audio: IT"));
assert.ok(!episodeMarkup.includes("🅸🆃"));
assert.deepEqual(source, original, "Readability must not mutate source IDs, URLs or metadata");

console.log(
  "PASS: readable VIDAA stream labels/flags in picker, descriptions and player panels; regex syntax, other scripts and source identity preserved"
);
