import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { homeMetadataSettingsSignature, isHomeTmdbEnabled } from "./homeMetadataSettings.js";

export function isHomeHeroLocalizationPending(hero, layoutMode = "modern") {
  if (!hero || ["continueWatching", "collection"].includes(hero.heroSource)) return false;
  const settings = TmdbSettingsStore.get();
  if (!isHomeTmdbEnabled(layoutMode, settings) || (!settings.useBasicInfo && !settings.useArtwork))
    return false;
  if (
    String(settings.language || "en")
      .toLowerCase()
      .startsWith("en")
  )
    return false;
  const signature = homeMetadataSettingsSignature();
  return (
    hero.heroTmdbLocalizationSignature !== signature &&
    !(hero.heroMetaEnriched && hero.heroEnrichmentSignature === signature)
  );
}
