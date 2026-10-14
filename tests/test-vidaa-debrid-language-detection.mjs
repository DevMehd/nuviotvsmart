import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };

const { facts, languageFor, languagesFromText } =
  await import("../js/core/debrid/debridStreamPresentationHelpers-02-has-token.js");
const { effectiveSettings, matchesFilters } =
  await import("../js/core/debrid/debridStreamPresentationHelpers-03-effective-settings.js");
const { compareStreams } =
  await import("../js/core/debrid/debridStreamPresentationHelpers-04-compare-key.js");

for (const value of [
  "it",
  "IT",
  "It",
  "ita",
  "Italian",
  "Italiano",
  "IT-IT",
  "it_IT",
  "𝐈𝐓",
  "𝘐𝘛",
  "ＩＴ",
  "ℐ𝒯",
  "I\u200bT",
  "🇮🇹",
  "[IT]"
]) {
  assert.equal(languageFor(value), "IT", `Explicit Italian metadata: ${value}`);
  assert.deepEqual(
    languagesFromText([value], "English"),
    ["IT"],
    `Parsed language takes precedence: ${value}`
  );
}

for (const marker of [
  "ITALIAN",
  "Italiano",
  "ita",
  "IT-IT",
  "it_IT",
  "[It]",
  "Audio: It",
  "Language: 𝐈𝐭",
  "[𝐈𝐓]",
  "𝐈𝐓",
  "𝘐𝘛",
  "ＩＴ",
  "ℐ𝒯",
  "I\u200bT",
  "🇮🇹"
]) {
  assert.deepEqual(
    languagesFromText([], `Example.2026.1080p ${marker}`),
    ["IT"],
    `Italian release marker: ${marker}`
  );
}
assert.deepEqual(
  languagesFromText([], "it"),
  ["IT"],
  "An isolated language label may use lower case"
);
assert.deepEqual(languagesFromText([], "Example\nIt\n1080p"), ["IT"]);
assert.deepEqual(languagesFromText([], "🇮🇹🇬🇧"), ["EN", "IT"]);

for (const [flag, language] of [
  ["🇬🇧", "EN"],
  ["🇺🇸", "EN"],
  ["🇯🇵", "JA"],
  ["🇰🇷", "KO"],
  ["🇨🇳", "ZH"],
  ["🇨🇿", "CS"],
  ["🇧🇷", "PT_BR"]
]) {
  assert.equal(languageFor(flag), language, `Recognized country flag: ${flag}`);
  assert.deepEqual(languagesFromText([], `Example ${flag}`), [language]);
}
for (const country of ["🇨🇦", "🇮🇳", "CA", "IN"]) {
  assert.equal(
    languageFor(country),
    null,
    `Ambiguous countries are not language codes: ${country}`
  );
  assert.deepEqual(
    languagesFromText([], `Example ${country}`),
    [],
    `No guessed language from ${country}`
  );
}
for (const title of [
  "It (2017) 1080p",
  "IT.2017.1080p",
  "Let It Snow 1080p",
  "Somewhere it rains",
  "Italianate.2026.1080p"
]) {
  assert.deepEqual(
    languagesFromText([], title),
    [],
    `Title words are not Italian audio markers: ${title}`
  );
  assert.deepEqual(facts({ title }).languages, [], `Case must survive the facts input: ${title}`);
}

const italian = facts({ title: "Example.2026.1080p", description: "Audio: 𝐈𝐓" });
const english = facts({ title: "Example.2026.1080p", description: "Audio: English" });
const multilingual = facts({ description: "🇮🇹 🇬🇧" });
assert.deepEqual(italian.languages, ["IT"]);
assert.deepEqual(english.languages, ["EN"]);
assert.deepEqual(
  languagesFromText(["English"], "🇮🇹"),
  ["EN"],
  "Structured metadata still takes precedence over display text"
);

const defaults = effectiveSettings({});
assert.equal(matchesFilters(italian, defaults), true);
assert.equal(matchesFilters(english, defaults), true);
assert.equal(
  compareStreams({ fact: english }, { fact: italian }, defaults),
  0,
  "No automatic language sort is introduced"
);
const requiredItalian = effectiveSettings({ streamPreferences: { requiredLanguages: ["IT"] } });
assert.equal(matchesFilters(italian, requiredItalian), true);
assert.equal(matchesFilters(english, requiredItalian), false);
const excludedItalian = effectiveSettings({ streamPreferences: { excludedLanguages: ["IT"] } });
assert.equal(matchesFilters(italian, excludedItalian), false);
assert.equal(matchesFilters(english, excludedItalian), true);
assert.equal(
  matchesFilters(multilingual, excludedItalian),
  true,
  "A multilingual source keeps its non-excluded language"
);
const preferredItalian = effectiveSettings({
  streamPreferences: {
    preferredLanguages: ["IT", "EN"],
    sortCriteria: [{ key: "LANGUAGE", direction: "DESC" }]
  }
});
assert.ok(
  compareStreams({ fact: italian }, { fact: english }, preferredItalian) < 0,
  "Explicit language preference can rank the corrected metadata"
);

console.log(
  "PASS: debrid Italian aliases, styled letters, flags, title boundaries and unchanged language filter/sort rules"
);
