import { Router } from "../../navigation/routerState.js";
import { I18n } from "../../../i18n/index.js";

const t = (key, fallback) => I18n.t(key, {}, { fallback });

// Preserve old settings links while sending account linking to the upstream
// tracking screen. Application credentials belong to the build, not this UI.
export function renderTraktIntegrationDetail() {
  this.actionMap.set("integration:trakt:account", () => Router.navigate("trakt"));
  return `
    ${this.renderSectionHeader({ label: "Trakt", subtitle: t("trakt_description", "Sync your watchlist, watch progress, continue watching, scrobbles, and personal lists with Trakt.") })}
    <div class="settings-group-card settings-group-card-fill"><div class="settings-stack">
      ${this.renderActionRow({
        focusKey: "integration:back",
        title: t("settings_integration_back", "Back to integrations"),
        icon: "back"
      })}
      ${this.renderActionRow({
        focusKey: "integration:trakt:account",
        title: t("trakt_account_login", "Trakt account"),
        subtitle: t("trakt_generate_code", "Generate activation code")
      })}
    </div></div>`;
}
