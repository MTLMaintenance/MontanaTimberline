// functions/api/update-hours.js
//
// Receives a POST from the Excel "UPDATE WEBSITE" macro and stores
// the submitted hours in Cloudflare KV. The website's homepage reads
// from KV (via /api/hours) to display the current hours — no GitHub
// commit or redeploy needed for routine hour changes.
//
// SECURITY: requires a secret header (X-Update-Secret) matching the
// UPDATE_SECRET environment variable set in Cloudflare. Without a
// matching secret, the request is rejected.
//
// REQUIRED SETUP (see instructions doc):
// 1. Create a KV namespace in Cloudflare and bind it to this Pages
//    project as "HOURS_KV" (Settings → Functions → KV namespace bindings).
// 2. Add an environment variable UPDATE_SECRET (Settings → Environment
//    variables) — a long random string, kept secret, shared only with
//    the Excel macro.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.UPDATE_SECRET) {
    return json({ error: "UPDATE_SECRET isn't configured yet in Cloudflare." }, 503);
  }
  if (!env.HOURS_KV) {
    return json({ error: "HOURS_KV namespace isn't bound to this project yet." }, 503);
  }

  const providedSecret = request.headers.get("X-Update-Secret");
  if (providedSecret !== env.UPDATE_SECRET) {
    return json({ error: "Unauthorized." }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  // Basic shape validation — expects:
  // {
  //   "effective_range": "Aug 15, 2026 – May 15, 2027",
  //   "season_label": "Winter Hours",
  //   "days": [
  //     { "day": "Monday", "hours": "Closed" },
  //     { "day": "Tuesday", "hours": "12:00 PM – 4:00 PM" },
  //     ...
  //   ],
  //   "note": "optional free-text note shown below the table"
  // }
  if (!payload || !Array.isArray(payload.days)) {
    return json({ error: "Payload must include a 'days' array." }, 400);
  }

  payload.updated_at = new Date().toISOString();

  await env.HOURS_KV.put("current_hours", JSON.stringify(payload));

  return json({ success: true, updated_at: payload.updated_at }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
