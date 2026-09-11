// functions/api/hours.js
//
// Public, read-only endpoint. The homepage's JavaScript fetches this
// on page load and picks out whichever season is currently active
// based on today's date, matching the MTSMS "seasons" payload shape.
//
// Returns { data: null } if nothing has been posted yet, so the
// homepage falls back to whatever's hard-coded in index.html.

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.HOURS_KV) {
    return json({ data: null }, 200);
  }

  const stored = await env.HOURS_KV.get("current_hours");
  const data = stored ? JSON.parse(stored) : null;

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
