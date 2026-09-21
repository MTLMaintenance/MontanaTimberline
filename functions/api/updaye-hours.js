// functions/api/update-hours.js
//
// Receives the POST sent by the MTSMS Excel workbook's "UPDATE WEBSITE"
// button (Settings sheet, cell trigger) and stores it in Cloudflare KV.
// The website's /api/hours endpoint serves this back out to the homepage.
//
// This matches the MTSMS v4.46 "Website Hours Sync" contract exactly:
//
//   Method: POST
//   Content-Type: application/json; charset=utf-8
//   Header: X-MTSMS-Key: <secret, matches UPDATE_SECRET below>
//
//   Body shape:
//   {
//     "source": "MTSMS",
//     "version": "4.46",
//     "updatedAt": "2026-09-08T14:32:00",
//     "seasons": [
//       {
//         "name": "Fall-Winter",
//         "start": "08/15",
//         "end": "05/15",
//         "note": "...",
//         "hours": [
//           {"day":"Sunday","closed":true},
//           {"day":"Monday","closed":false,"open":"12:00 PM","close":"4:00 PM"},
//           ...
//         ]
//       },
//       { "name": "Spring-Summer", ... }
//     ]
//   }
//
// REQUIRED SETUP (already done as of this build):
// 1. KV namespace bound to this Pages project as "HOURS_KV".
// 2. Environment variable UPDATE_SECRET set in Cloudflare — this must
//    match exactly what's entered in the Excel Settings sheet, cell J54.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.UPDATE_SECRET) {
    return json({ error: "UPDATE_SECRET isn't configured yet in Cloudflare." }, 503);
  }
  if (!env.HOURS_KV) {
    return json({ error: "HOURS_KV namespace isn't bound to this project yet." }, 503);
  }

  const providedKey = request.headers.get("X-MTSMS-Key");
  if (providedKey !== env.UPDATE_SECRET) {
    return json({ error: "Unauthorized." }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!payload || !Array.isArray(payload.seasons) || payload.seasons.length === 0) {
    return json({ error: "Payload must include a non-empty 'seasons' array." }, 400);
  }

  // Light validation on each season so a malformed entry from Excel
  // doesn't silently break the homepage.
  for (const season of payload.seasons) {
    if (!season.name || !season.start || !season.end || !Array.isArray(season.hours)) {
      return json({ error: `Season '${season.name || "(unnamed)"}' is missing required fields.` }, 400);
    }
  }

  await env.HOURS_KV.put("current_hours", JSON.stringify(payload));

  return json({ success: true, receivedAt: new Date().toISOString(), seasons: payload.seasons.length }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
