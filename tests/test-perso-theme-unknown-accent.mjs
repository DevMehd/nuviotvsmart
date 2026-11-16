// A theme name the TV does not know (the phone's "SYSTEM" accent, or any future
// one) is kept in storage and sent back unchanged; only the TV display falls
// back to its default accent. Known themes, CUSTOM and old storage keep working.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
globalThis.location = { search: "" };
globalThis.fetch = async () => {
  throw new Error("Theme checks must stay offline");
};
const cssVars = {};
const element = () => ({ style: { setProperty() {} }, dataset: {} });
globalThis.document = {
  documentElement: { style: { setProperty: (key, value) => (cssVars[key] = value) }, dataset: {} },
  head: { appendChild() {} },
  getElementById: () => null,
  createElement: element,
  querySelectorAll: () => []
};

const { ThemeStore } = await import("../js/data/local/themeStore.js");
const { theme_settings } = await import("../js/core/profile/profileSettingsSyncFeature-theme-settings.js");
const { ThemeManager } = await import("../js/ui/theme/themeManager.js");
const { ThemeColors } = await import("../js/ui/theme/themeColors.js");

const PROFILE = "1";
const reset = (value) => ThemeStore.replaceForProfile(PROFILE, value, { silentSync: true });
const white = ThemeColors.getPalette("WHITE");

// Unknown theme from the phone: stored and sent back as is.
reset({});
assert.equal(theme_settings.import(PROFILE, { selected_theme: "system" }), true);
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "SYSTEM");
assert.equal(theme_settings.export(PROFILE).selected_theme, "SYSTEM");
// Display only: the TV default accent, without rewriting the stored choice.
for (const enforceAccess of [false, true]) {
  ThemeManager.apply({ enforceAccess, access: null });
  assert.equal(cssVars["--secondary-color"], white["--secondary-color"]);
  assert.equal(cssVars["--focus-color"], white["--focus-color"]);
}
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "SYSTEM");
assert.equal(theme_settings.export(PROFILE).selected_theme, "SYSTEM");
// Another unknown name from a future phone version, wrapped like the RPC sends it.
theme_settings.import(PROFILE, { selected_theme: { type: "string", value: "AURORA" } });
assert.equal(theme_settings.export(PROFILE).selected_theme, "AURORA");

// A known theme behaves as before.
reset({});
theme_settings.import(PROFILE, { selected_theme: "CRIMSON" });
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "CRIMSON");
assert.equal(ThemeStore.getForProfile(PROFILE).accentColor, "#e53935");
assert.equal(theme_settings.export(PROFILE).selected_theme, "CRIMSON");
ThemeManager.apply();
assert.equal(cssVars["--secondary-color"], ThemeColors.getPalette("CRIMSON")["--secondary-color"]);

// Leaving SYSTEM for a known theme works.
reset({ themeName: "SYSTEM", accentColor: "#ffffff" });
theme_settings.import(PROFILE, { selected_theme: "OCEAN" });
assert.equal(theme_settings.export(PROFILE).selected_theme, "OCEAN");

// CUSTOM unchanged.
reset({});
theme_settings.import(PROFILE, { selected_theme: "CUSTOM", custom_theme_colors: "#112233,#445566,#778899" });
const custom = ThemeStore.getForProfile(PROFILE);
assert.equal(custom.themeName, "CUSTOM");
assert.equal(custom.accentColor, "#445566");
assert.equal(theme_settings.export(PROFILE).selected_theme, "CUSTOM");
assert.equal(theme_settings.export(PROFILE).custom_theme_colors, "#112233,#445566,#778899");

// Old storage stays as before: coherent, accent only, or theme/accent mismatch.
reset({ themeName: "OCEAN", accentColor: "#1e88e5" });
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "OCEAN");
reset({ accentColor: "#42a5f5" });
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "OCEAN");
reset({ themeName: "WHITE", accentColor: "#66bb6a" });
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "EMERALD");
reset({});
assert.equal(ThemeStore.getForProfile(PROFILE).themeName, "WHITE");
assert.equal(theme_settings.export(PROFILE).selected_theme, "WHITE");

console.log("PASS: unknown synced theme kept, TV default accent shown, known themes and CUSTOM unchanged.");
