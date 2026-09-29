// functions/api/update-pricing.js
//
// MTSMS live pricing update endpoint.
// Uses the same Cloudflare bindings as the existing hours endpoint:
//   HOURS_KV
//   UPDATE_SECRET

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    return json({
      ready: true,
      endpoint: "/api/update-pricing",
      accepts: ["POST"]
    }, 200);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, {
      "Allow": "GET, POST"
    });
  }

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

    if (
      !item ||
      typeof item.price_per_lb !== "number" ||
      !Number.isFinite(item.price_per_lb) ||
      item.price_per_lb < 0
    ) {
      return json(
        { error: `${key} must include a valid non-negative price_per_lb.` },
        400
      );
    }

    if (typeof item.in_stock !== "boolean") {
      return json(
        { error: `${key} must include boolean in_stock.` },
        400
      );
    }
  }

  await env.HOURS_KV.put("current_pricing", JSON.stringify(payload));

  return json({
    success: true,
    receivedAt: new Date().toISOString(),
    products: keys.length
  }, 200);
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}
