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
  return Boolean(expected) && supplied === expected;
}

function findD1(env) {
  // Try common binding names first, then safely inspect the remaining bindings.
  const preferred = ["DB", "MTSMS_DB", "D1", "DATABASE"];
  for (const name of preferred) {
    try {
      const value = env && env[name];
      if (value && typeof value.prepare === "function") {
        return { db: value, name };
      }
    } catch (_) {}
  }

  for (const name of Object.keys(env || {})) {
    try {
      const value = env[name];
      if (value && typeof value.prepare === "function") {
        return { db: value, name };
      }
    } catch (_) {}
  }

  return { db: null, name: "" };
}

async function ensureTable(db) {
  // Keep the schema deliberately simple for the live channel.
  // INTEGER PRIMARY KEY auto-generates an increasing row id in SQLite/D1.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mtsms_live_events (
      seq INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      source_device TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ticket TEXT,
      payload_b64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (!authorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const found = findD1(env);
    if (!found.db) {
      return json({
        ok: false,
        error: "No D1 binding found in this Pages project."
      }, 503);
    }

    const db = found.db;
    await ensureTable(db);

    const url = new URL(request.url);

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
      }

      const eventId = String(body.event_id || "").trim();
      const source = String(
        body.source_device ||
        request.headers.get("X-MTSMS-Device") ||
        ""
      ).trim();
      const eventType = String(body.event_type || "STATE").trim();
      const ticket = String(body.ticket || "").trim();
      const payload = String(body.payload_b64 || "").trim();
      const createdAt = String(body.created_at || new Date().toISOString()).trim();

      if (!eventId || !source || !payload) {
        return json({
          ok: false,
          error: "event_id, source_device, and payload_b64 are required"
        }, 400);
      }

      await db.prepare(`
        INSERT OR IGNORE INTO mtsms_live_events
        (event_id, source_device, event_type, ticket, payload_b64, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        eventId,
        source,
        eventType,
        ticket,
        payload,
        createdAt
      ).run();

      const row = await db.prepare(`
        SELECT seq
        FROM mtsms_live_events
        WHERE event_id = ?
      `).bind(eventId).first();

      return json({
        ok: true,
        seq: row ? Number(row.seq || 0) : 0,
        event_id: eventId,
        d1_binding: found.name
      });
    }

    if (request.method === "GET") {
      const after = Math.max(
        0,
        Number(url.searchParams.get("after") || 0) || 0
      );
      const device = String(
        url.searchParams.get("device") ||
        request.headers.get("X-MTSMS-Device") ||
        ""
      ).trim();
      const limit = Math.min(
        50,
        Math.max(1, Number(url.searchParams.get("limit") || 25) || 25)
      );

      const result = await db.prepare(`
        SELECT
          seq,
          event_id,
          source_device,
          event_type,
          ticket,
          payload_b64,
          created_at
        FROM mtsms_live_events
        WHERE seq > ?
          AND source_device <> ?
        ORDER BY seq ASC
        LIMIT ?
      `).bind(after, device, limit).all();

      return json({
        ok: true,
        events: result.results || [],
        d1_binding: found.name
      });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);

  } catch (err) {
    // Return the actual runtime/D1 error instead of allowing Cloudflare
    // to replace it with generic Worker error 1101.
    return json({
      ok: false,
      error: "mtsms-live runtime error",
      detail: String(err && err.message ? err.message : err)
    }, 500);
  }
}
