function findD1(env) {
  for (const [name, value] of Object.entries(env || {})) {
    if (value && typeof value.prepare === "function") return value;
  }
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function authorized(request, env) {
  const supplied = request.headers.get("X-MTSMS-Sync-Key") || "";
  const expected = env.MTSMS_SYNC_SECRET || "";
  return expected && supplied === expected;
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mtsms_live_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      source_device TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ticket TEXT,
      payload_b64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mtsms_live_events_seq ON mtsms_live_events(seq)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mtsms_live_events_created ON mtsms_live_events(created_at)`).run();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);

  const db = findD1(env);
  if (!db) return json({ ok: false, error: "No D1 binding found in this Pages project." }, 503);

  await ensureTable(db);
  const url = new URL(request.url);

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }

    const eventId = String(body.event_id || "").trim();
    const source = String(body.source_device || request.headers.get("X-MTSMS-Device") || "").trim();
    const eventType = String(body.event_type || "STATE").trim();
    const ticket = String(body.ticket || "").trim();
    const payload = String(body.payload_b64 || "").trim();
    const createdAt = String(body.created_at || new Date().toISOString()).trim();

    if (!eventId || !source || !payload) {
      return json({ ok: false, error: "event_id, source_device, and payload_b64 are required" }, 400);
    }

    await db.prepare(`
      INSERT OR IGNORE INTO mtsms_live_events
      (event_id, source_device, event_type, ticket, payload_b64, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(eventId, source, eventType, ticket, payload, createdAt).run();

    // Keep the live-event table small. Historical business records remain in the normal sync tables.
    await db.prepare(`DELETE FROM mtsms_live_events WHERE datetime(created_at) < datetime('now','-2 days')`).run();

    const row = await db.prepare(`SELECT seq FROM mtsms_live_events WHERE event_id = ?`).bind(eventId).first();
    return json({ ok: true, seq: row ? row.seq : 0, event_id: eventId });
  }

  if (request.method === "GET") {
    const after = Math.max(0, Number(url.searchParams.get("after") || 0) || 0);
    const device = String(url.searchParams.get("device") || request.headers.get("X-MTSMS-Device") || "").trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25) || 25));

    const result = await db.prepare(`
      SELECT seq, event_id, source_device, event_type, ticket, payload_b64, created_at
      FROM mtsms_live_events
      WHERE seq > ? AND source_device <> ?
      ORDER BY seq ASC
      LIMIT ?
    `).bind(after, device, limit).all();

    return json({ ok: true, events: result.results || [] });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
