// Short-lived exchange of a VIDAA diagnostic report between the TV and a phone
// that scans the QR code shown by the TV. The TV posts the report; the phone
// fetches it by an unguessable identifier. Reports are bounded, anonymous by
// construction (see js/core/diagnostics/vidaaBenchmark.js) and never logged.
//
// Storage is the function instance memory by default. When the Vercel project
// has a Blob store (BLOB_READ_WRITE_TOKEN), the report is also written there
// so the link survives cold starts and new instances.
export const REPORT_ID_PATTERN = /^[a-z2-7]{16,32}$/;
export const MAX_REPORT_BYTES = 160 * 1024;
export const REPORT_TTL_MS = 30 * 60 * 1000;
export const MAX_REPORTS = 24;
const MAX_BODY_BYTES = MAX_REPORT_BYTES + 4096;
const BLOB_PREFIX = "diagnostics/";

export function validateDiagnosticReport(report) {
  return Boolean(
    report &&
    typeof report === "object" &&
    !Array.isArray(report) &&
    report.schema === 1 &&
    report.protocol === "vidaa-guided-1" &&
    Array.isArray(report.steps) &&
    report.steps.length <= 8 &&
    report.environment &&
    typeof report.environment === "object" &&
    (report.createdAt === undefined ||
      (typeof report.createdAt === "string" && report.createdAt.length <= 40))
  );
}

export function parseReportId(value) {
  const id = String(value || "").trim();
  return REPORT_ID_PATTERN.test(id) ? id : null;
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );

export function renderMissingReportPage(id) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="6"><title>Diagnostic Nuvio</title><style>body{font:18px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:32px 20px;background:#0f1115;color:#fff}h1{font-size:24px;margin:0 0 12px}p{margin:0 0 12px;color:#c9d3e0}code{color:#fff}</style></head><body><h1>Diagnostic introuvable pour le moment</h1><p>Gardez le code QR affiché sur la télé : elle renvoie le bilan régulièrement. Cette page se recharge toute seule toutes les 6 secondes.</p><p>Si rien n’apparaît après une minute, relancez « Exporter JSON » sur la télé pour obtenir un nouveau code.</p><p>Identifiant : <code>${escapeHtml(id)}</code></p></body></html>`;
}

function defaultLoadBlob() {
  return import("@vercel/blob");
}

export function createDiagnosticReportService({
  now = Date.now,
  loadBlob = defaultLoadBlob,
  blobToken = () => process.env.BLOB_READ_WRITE_TOKEN || ""
} = {}) {
  const reports = new Map();
  let blobModulePromise = null;

  function blobModule() {
    if (!blobToken()) return Promise.resolve(null);
    if (!blobModulePromise)
      blobModulePromise = Promise.resolve()
        .then(() => loadBlob())
        .catch(() => null);
    return blobModulePromise;
  }

  function remember(id, text) {
    reports.delete(id);
    reports.set(id, { text, until: now() + REPORT_TTL_MS });
    for (const [key, entry] of reports) {
      if (reports.size <= MAX_REPORTS && entry.until > now()) break;
      reports.delete(key);
    }
  }

  function recall(id) {
    const entry = reports.get(id);
    if (!entry) return null;
    if (entry.until <= now()) {
      reports.delete(id);
      return null;
    }
    return entry.text;
  }

  async function storeDurably(id, text) {
    const blob = await blobModule();
    if (!blob?.put) return false;
    try {
      await blob.put(`${BLOB_PREFIX}${id}.json`, text, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token: blobToken()
      });
      return true;
    } catch {
      return false;
    }
  }

  async function findDurable(id) {
    const blob = await blobModule();
    if (!blob?.list) return null;
    try {
      const result = await blob.list({
        prefix: `${BLOB_PREFIX}${id}.json`,
        limit: 1,
        token: blobToken()
      });
      const url = result?.blobs?.[0]?.url;
      return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  async function readBody(req) {
    if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) return undefined;
    if (req.body !== undefined) {
      const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return undefined;
      return JSON.parse(text);
    }
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) return undefined;
      parts.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  }

  return async function handle(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (status, error = "diagnostic_report_unavailable") => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error }));
    };
    const host = String(req.headers?.host || "");
    const protocol = String(req.headers?.["x-forwarded-proto"] || "https")
      .split(",")[0]
      .trim();

    if (req.method === "GET") {
      let id = parseReportId(req.query?.id);
      if (!id) {
        try {
          id = parseReportId(
            new URL(String(req.url || "/"), "https://nuvio.local").searchParams.get("id")
          );
        } catch {
          id = null;
        }
      }
      if (!id) return fail(400, "invalid_report_id");
      const text = recall(id);
      if (text) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `inline; filename="nuvio-diagnostic-${id}.json"`);
        return res.end(text);
      }
      const durable = await findDurable(id);
      if (durable) {
        res.statusCode = 302;
        res.setHeader("Location", durable);
        return res.end();
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(renderMissingReportPage(id));
    }

    if (req.method !== "POST") return fail(405);
    const origin = req.headers?.origin;
    if (origin && origin !== `https://${host}` && origin !== `http://${host}`) return fail(403);
    if (!String(req.headers?.["content-type"] || "").startsWith("application/json"))
      return fail(415);
    let body;
    try {
      body = await readBody(req);
    } catch {
      return fail(400);
    }
    if (body === undefined) return fail(413);
    const id = parseReportId(body?.id);
    if (!id || !validateDiagnosticReport(body?.report)) return fail(400, "invalid_report");
    const text = JSON.stringify(body.report);
    if (Buffer.byteLength(text) > MAX_REPORT_BYTES) return fail(413);
    remember(id, text);
    const durable = await storeDurably(id, text);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        id,
        path: `/d/${id}`,
        url: host ? `${protocol === "http" ? "http" : "https"}://${host}/d/${id}` : null,
        durable,
        expiresInSeconds: durable ? null : Math.floor(REPORT_TTL_MS / 1000)
      })
    );
  };
}
