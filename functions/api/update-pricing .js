// functions/api/update-pricing.js
//
// Receives live pricing from the MTSMS Excel workbook's UPDATE WEBSITE button.
// Uses the SAME Cloudflare bindings already used by website hours:
//   HOURS_KV      - existing KV namespace
//   UPDATE_SECRET - existing secret matching Settings!J54
//
// Stores live pricing under a separate KV key: current_pricing.

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

  const keys = ["wood1", "wood2", "sawdust"];
  for (const key of keys) {
    const item = payload?.[key];
    if (!item || typeof item.price_per_lb !== "number" || !Number.isFinite(item.price_per_lb) || item.price_per_lb < 0) {
      return json({ error: `${key} must include a valid non-negative price_per_lb.` }, 400);
    }
    if (typeof item.in_stock !== "boolean") {
      return json({ error: `${key} must include boolean in_stock.` }, 400);
    }
  }

  await env.HOURS_KV.put("current_pricing", JSON.stringify(payload));

  return json({
    success: true,
    receivedAt: new Date().toISOString(),
    products: keys.length,
  }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
