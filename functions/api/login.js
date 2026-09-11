// functions/api/login.js
//
// Handles POST requests from login.html. Checks the submitted
// username/password against the STAFF_USER / STAFF_PASSWORD
// environment variables, and on success, issues a signed,
// HttpOnly session cookie good for 12 hours.
//
// The cookie is signed with SESSION_SECRET so it can't be forged —
// someone would need that secret (known only to Cloudflare + this
// code) to create a fake valid cookie.

const SESSION_HOURS = 12;

export async function onRequestPost(context) {
  const { request, env } = context;

  const expectedUser = env.STAFF_USER;
  const expectedPass = env.STAFF_PASSWORD;
  const secret = env.SESSION_SECRET;

  if (!expectedUser || !expectedPass || !secret) {
    return json(
      { error: "Login isn't configured yet. Set STAFF_USER, STAFF_PASSWORD, and SESSION_SECRET in Cloudflare Pages settings." },
      503
    );
  }

  let username = "";
  let password = "";
  try {
    const body = await request.json();
    username = body.username || "";
    password = body.password || "";
  } catch (err) {
    return json({ error: "Invalid request." }, 400);
  }

  if (username !== expectedUser || password !== expectedPass) {
    return json({ error: "Incorrect username or password." }, 401);
  }

  const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const signature = await sign(secret, String(expiry));
  const token = `${expiry}.${signature}`;

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `mtl_staff_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 60 * 60}`
  );

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
