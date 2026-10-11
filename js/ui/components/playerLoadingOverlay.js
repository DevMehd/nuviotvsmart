function escape(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
  );
}

export function renderPlayerLoadingOverlay(
  meta = {},
  { id = "playerLoadingOverlay", status = "", manualSelectionLabel = "" } = {}
) {
  const { title = "Nuvio", subtitle = "", logoUrl = "", backdropUrl = "" } = meta;
  return `
    <div id="${escape(id)}" class="player-loading-overlay">
      <div class="player-loading-backdrop"${backdropUrl ? ` style="background-image:url('${escape(String(backdropUrl).replace(/'/g, "%27"))}')"` : ""}></div>
      <div class="player-loading-gradient"></div>
      <div class="player-loading-center">
        <div class="player-loading-identity${logoUrl ? " has-logo" : ""}${status ? " is-loading-progress" : ""}">
          ${
            logoUrl
              ? `
            <div class="player-loading-logo-stack">
              <img class="player-loading-logo player-loading-logo-base" src="${escape(logoUrl)}" alt="${escape(title || "logo")}" />
              <div class="player-loading-logo-fill-clip hidden">
                <img class="player-loading-logo player-loading-logo-fill" src="${escape(logoUrl)}" alt="" aria-hidden="true" />
              </div>
            </div>`
              : ""
          }
          <div class="player-loading-title">${escape(title)}</div>
        </div>
        <div class="player-loading-subtitle${subtitle ? "" : " hidden"}">${escape(subtitle)}</div>
        <div class="player-loading-status${status ? "" : " hidden"}"${status ? ' role="alert"' : ""}>${escape(status)}</div>
        ${manualSelectionLabel ? `<div class="player-startup-error-actions"><button class="player-startup-error-button focusable" data-action="chooseManualStream">${escape(manualSelectionLabel)}</button></div>` : ""}
      </div>
    </div>`;
}
