// functions/api/mtsms-sync.js
//
// Montana Timberline MTSMS multi-terminal synchronization API.
// Cloudflare Pages Function + D1.
//
// Required Pages bindings/secrets:
//   MTSMS_DB           D1 database binding
//   MTSMS_SYNC_SECRET  secret shared by the MTSMS workbooks
//
// Wire format is deliberately simple for Excel/VBA:
//
// Push: POST /api/mtsms-sync
// Header: X-MTSMS-Sync-Key
// Header: X-MTSMS-Device
// Body, one record per line:
//   entity<TAB>base64(record-key)<TAB>payload
//
// Pull: GET /api/mtsms-sync?since=123
// Response:
//   REV<TAB>lastReturnedRevision<TAB>MORE<TAB>0|1
//   entity<TAB>base64(record-key)<TAB>revision<TAB>payload
//
// Snapshot: GET /api/mtsms-sync?mode=snapshot
// Current records only, followed by current global revision.
//
// Status/revision: GET /api/mtsms-sync?mode=status

const MAX_PULL = 1000;
const MAX_PUSH = 250;

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.MTSMS_DB) {
    return text("ERROR\tMTSMS_DB D1 binding is not configured.", 503);
  }

  if (!env.MTSMS_SYNC_SECRET) {
    return text("ERROR\tMTSMS_SYNC_SECRET is not configured.", 503);
  }

  const supplied = request.headers.get("X-MTSMS-Sync-Key") || "";
  if (supplied !== env.MTSMS_SYNC_SECRET) {
    return text("ERROR\tUnauthorized", 401);
  }

  try {
    if (request.method === "GET") return handleGet(request, env);
    if (request.method === "POST") return handlePost(request, env);
    return text("ERROR\tMethod not allowed", 405, { "Allow": "GET, POST" });
  } catch (err) {
    return text("ERROR\t" + safe(err?.message || String(err)), 500);
  }
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") || "").toLowerCase();

  if (mode === "status") {
    const row = await env.MTSMS_DB
      .prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM mtsms_changes")
      .first();
    return text(`OK\tREV\t${Number(row?.rev || 0)}`, 200);
  }

  if (mode === "snapshot") {
    const maxRow = await env.MTSMS_DB
      .prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM mtsms_changes")
      .first();

    const result = await env.MTSMS_DB
      .prepare(
        `SELECT entity, record_key, payload
           FROM mtsms_records
          ORDER BY entity, record_key`
      )
      .all();

    const lines = [`REV\t${Number(maxRow?.rev || 0)}\tMORE\t0`];
    for (const r of (result.results || [])) {
      lines.push(`${r.entity}\t${r.record_key}\t0\t${r.payload}`);
    }
    return text(lines.join("\n"), 200);
  }

  const since = Math.max(0, Number(url.searchParams.get("since") || 0) || 0);

  const result = await env.MTSMS_DB
    .prepare(
      `SELECT rev, entity, record_key, payload
         FROM mtsms_changes
        WHERE rev > ?
        ORDER BY rev
        LIMIT ?`
    )
    .bind(since, MAX_PULL + 1)
    .all();

  const all = result.results || [];
  const more = all.length > MAX_PULL;
  const rows = more ? all.slice(0, MAX_PULL) : all;
  const lastRev = rows.length ? Number(rows[rows.length - 1].rev) : since;

  const lines = [`REV\t${lastRev}\tMORE\t${more ? 1 : 0}`];
  for (const r of rows) {
    lines.push(`${r.entity}\t${r.record_key}\t${r.rev}\t${r.payload}`);
  }
  return text(lines.join("\n"), 200);
}

async function handlePost(request, env) {
  const device = (request.headers.get("X-MTSMS-Device") || "UNKNOWN").slice(0, 80);
  const body = await request.text();

  const lines = body
    .split(/\r?\n/)
    .map(x => x.trimEnd())
    .filter(Boolean);

  if (!lines.length) {
    return text("OK\tCOUNT\t0", 200);
  }
  if (lines.length > MAX_PUSH) {
    return text(`ERROR\tToo many records in one push. Max ${MAX_PUSH}.`, 413);
  }

  const now = new Date().toISOString();
  const statements = [];

  for (const line of lines) {
    const p1 = line.indexOf("\t");
    const p2 = p1 < 0 ? -1 : line.indexOf("\t", p1 + 1);

    if (p1 <= 0 || p2 <= p1 + 1) {
      return text("ERROR\tMalformed sync record.", 400);
    }

    const entity = line.slice(0, p1);
    const recordKey = line.slice(p1 + 1, p2);
    const payload = line.slice(p2 + 1);

    if (!/^[a-z0-9_-]{1,40}$/i.test(entity)) {
      return text("ERROR\tInvalid entity name.", 400);
    }
    if (!recordKey || recordKey.length > 800) {
      return text("ERROR\tInvalid record key.", 400);
    }
    if (payload.length > 500000) {
      return text("ERROR\tRecord payload is too large.", 413);
    }

    statements.push(
      env.MTSMS_DB.prepare(
        `INSERT INTO mtsms_records(entity, record_key, payload, device, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(entity, record_key)
         DO UPDATE SET payload=excluded.payload,
                       device=excluded.device,
                       updated_at=excluded.updated_at`
      ).bind(entity, recordKey, payload, device, now)
    );

    statements.push(
      env.MTSMS_DB.prepare(
        `INSERT INTO mtsms_changes(entity, record_key, payload, device, updated_at)
         VALUES(?, ?, ?, ?, ?)`
      ).bind(entity, recordKey, payload, device, now)
    );
  }

  await env.MTSMS_DB.batch(statements);

  const row = await env.MTSMS_DB
    .prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM mtsms_changes")
    .first();

  return text(`OK\tCOUNT\t${lines.length}\tREV\t${Number(row?.rev || 0)}`, 200);
}

function safe(s) {
  return String(s).replace(/[\r\n\t]+/g, " ").slice(0, 1000);
}

function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
