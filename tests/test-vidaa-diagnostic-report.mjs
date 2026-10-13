import assert from "node:assert/strict";
import {
  createDiagnosticReportService,
  validateDiagnosticReport,
  parseReportId,
  MAX_REPORT_BYTES,
  MAX_REPORTS
} from "../server/diagnosticReportService.js";

const report = {
  schema: 1,
  protocol: "vidaa-guided-1",
  createdAt: "2026-10-13T12:00:00.000Z",
  environment: { declaredModel: "55U6NQ" },
  startup: {},
  steps: [{ id: "idle", status: "complete" }],
  limitations: []
};
const id = "abcdefghijklmnop2345";
assert.ok(validateDiagnosticReport(report));
assert.equal(validateDiagnosticReport({ ...report, schema: 2 }), false);
assert.equal(validateDiagnosticReport({ ...report, steps: Array(9).fill({}) }), false);
assert.equal(validateDiagnosticReport([]), false);
assert.equal(parseReportId("ABCDEFGHIJKLMNOP"), null);
assert.equal(parseReportId("abcdefghijklmno1"), null, "1 is not in the base32 alphabet");
assert.equal(parseReportId("abc"), null);
assert.equal(parseReportId(` ${id} `), id);

function call(
  service,
  { method = "POST", url = "/api/diagnostic-report", query, body, headers = {} }
) {
  const out = { status: 200, headers: {}, text: "" };
  return new Promise((resolve, reject) => {
    service(
      {
        method,
        url,
        query,
        headers: {
          host: "nuvio-vidaa.vercel.app",
          origin: "https://nuvio-vidaa.vercel.app",
          "content-type": "application/json",
          ...headers
        },
        body
      },
      {
        setHeader: (key, value) => (out.headers[key.toLowerCase()] = value),
        set statusCode(value) {
          out.status = value;
        },
        get statusCode() {
          return out.status;
        },
        end: (text = "") => {
          out.text = String(text);
          resolve(out);
        }
      }
    ).catch(reject);
  });
}

{
  let clock = 1_000_000;
  const service = createDiagnosticReportService({ now: () => clock, blobToken: () => "" });
  const posted = await call(service, { body: { id, report } });
  assert.equal(posted.status, 200, posted.text);
  const answer = JSON.parse(posted.text);
  assert.equal(answer.id, id);
  assert.equal(answer.path, `/d/${id}`);
  assert.equal(answer.url, `https://nuvio-vidaa.vercel.app/d/${id}`);
  const local = JSON.parse(
    (
      await call(service, {
        body: { id, report },
        headers: {
          host: "127.0.0.1:4173",
          origin: "http://127.0.0.1:4173",
          "x-forwarded-proto": "http"
        }
      })
    ).text
  );
  assert.equal(local.url, `http://127.0.0.1:4173/d/${id}`);
  assert.equal(answer.durable, false);
  assert.equal(answer.expiresInSeconds, 1800);
  assert.ok(!posted.text.includes("55U6NQ"), "the answer never echoes the report");
  const fetched = await call(service, { method: "GET", query: { id } });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.text, JSON.stringify(report));
  assert.match(fetched.headers["content-type"], /application\/json/);
  assert.match(fetched.headers["content-disposition"], /inline; filename="nuvio-diagnostic-/);
  assert.equal(fetched.headers["cache-control"], "private, no-store");
  const viaUrl = await call(service, { method: "GET", url: `/api/diagnostic-report?id=${id}` });
  assert.equal(viaUrl.status, 200);
  const missing = await call(service, { method: "GET", query: { id: "zzzzzzzzzzzzzzzz" } });
  assert.equal(missing.status, 404);
  assert.match(missing.headers["content-type"], /text\/html/);
  assert.match(missing.text, /http-equiv="refresh"/);
  assert.match(missing.text, /zzzzzzzzzzzzzzzz/);
  assert.equal((await call(service, { method: "GET", query: { id: "<script>" } })).status, 400);
  assert.equal((await call(service, { method: "DELETE" })).status, 405);
  assert.equal(
    (await call(service, { body: { id, report }, headers: { origin: "https://evil.test" } }))
      .status,
    403
  );
  assert.equal(
    (await call(service, { body: "{}", headers: { "content-type": "text/plain" } })).status,
    415
  );
  assert.equal((await call(service, { body: { id, report: { schema: 1 } } })).status, 400);
  assert.equal((await call(service, { body: { id: "short", report } })).status, 400);
  assert.equal(
    (
      await call(service, {
        body: { id, report: { ...report, steps: [{ note: "x".repeat(MAX_REPORT_BYTES) }] } }
      })
    ).status,
    413
  );
  clock += 31 * 60 * 1000;
  assert.equal((await call(service, { method: "GET", query: { id } })).status, 404, "expired");
  for (let i = 0; i < MAX_REPORTS + 1; i += 1) {
    const other = `${String.fromCharCode(97 + (i % 26))}${"b".repeat(15)}${String(i)
      .padStart(2, "0")
      .replace(/[0-9]/g, (d) => "abcdefghij"[d])}`;
    assert.equal((await call(service, { body: { id: other, report } })).status, 200, other);
  }
  const first = `a${"b".repeat(15)}aa`;
  assert.equal((await call(service, { method: "GET", query: { id: first } })).status, 404, "LRU");
}

{
  const puts = [];
  const blob = {
    put: async (pathname, text, options) => {
      puts.push({ pathname, text, options });
    },
    list: async ({ prefix }) => ({
      blobs: puts
        .filter((entry) => entry.pathname.startsWith(prefix))
        .map((entry) => ({ url: `https://store.public.blob.vercel-storage.com/${entry.pathname}` }))
    })
  };
  const options = { blobToken: () => "token", loadBlob: async () => blob };
  const service = createDiagnosticReportService(options);
  const posted = JSON.parse((await call(service, { body: { id, report } })).text);
  assert.equal(posted.durable, true);
  assert.equal(posted.expiresInSeconds, null);
  assert.equal(puts[0].pathname, `diagnostics/${id}.json`);
  assert.equal(puts[0].options.access, "public");
  assert.equal(puts[0].options.addRandomSuffix, false);
  assert.equal(puts[0].options.token, "token");
  const cold = createDiagnosticReportService(options);
  const redirected = await call(cold, { method: "GET", query: { id } });
  assert.equal(redirected.status, 302);
  assert.equal(
    redirected.headers.location,
    `https://store.public.blob.vercel-storage.com/diagnostics/${id}.json`
  );
  const broken = createDiagnosticReportService({
    blobToken: () => "token",
    loadBlob: async () => {
      throw new Error("module missing");
    }
  });
  const fallback = JSON.parse((await call(broken, { body: { id, report } })).text);
  assert.equal(fallback.durable, false);
  assert.equal((await call(broken, { method: "GET", query: { id } })).status, 200);
}
console.log(
  "PASS diagnostic report exchange: validation, memory TTL/LRU, origin checks, Blob fallback and redirect"
);
