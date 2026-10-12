const escape = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );

export function showVidaaDetailPreview(container, params = {}, meta = null) {
  if (globalThis.__NUVIO_PLATFORM__ !== "vidaa" || !container) return;
  const shell = container.querySelector(".detail-loading-shell");
  if (!shell) return;
  const title = meta?.name || params.fallbackTitle || "";
  const artwork =
    meta?.background || params.fallbackBackground || meta?.poster || params.fallbackPoster || "";
  let preview = shell.querySelector(".vidaa-detail-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "vidaa-detail-preview";
    shell.appendChild(preview);
    shell.classList.add("has-vidaa-preview");
  }
  // Non-interactive preview: playback/resume controls wait for authoritative
  // progress, while the selected title and artwork are already on screen.
  const safeArtwork = /^(https?:\/\/|\/)/i.test(artwork) ? artwork : "";
  preview.innerHTML = `${safeArtwork ? `<img class="vidaa-detail-preview-art" src="${escape(safeArtwork)}" alt="" decoding="async" />` : ""}<div class="vidaa-detail-preview-copy"><h1>${escape(title)}</h1><p>${escape(String(meta?.description || "").slice(0, 400))}</p><span>Chargement des informations…</span></div>`;
}
