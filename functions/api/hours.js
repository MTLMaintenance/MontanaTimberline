// functions/api/hours.js
//
// Public, read-only endpoint. The homepage's JavaScript fetches this
// on page load to display the current hours. If nothing has been
// stored yet (KV is empty), it returns null so the homepage falls
// back to whatever's hard-coded in index.html.

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
      // Short cache so a burst of visitors doesn't hammer KV, but
      // updates still show up within a minute of Excel pushing them.
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
