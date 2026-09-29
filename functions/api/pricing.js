// functions/api/pricing.js
//
// Public, read-only live pricing endpoint for the Montana Timberline homepage.
// Returns { data: null } until MTSMS has published pricing at least once.

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.HOURS_KV) {
    return json({ data: null }, 200);
  }

  const stored = await env.HOURS_KV.get("current_pricing");
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
