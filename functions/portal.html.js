// functions/portal.html.js
//
// Because this file is named to match the exact route (/portal.html),
// it ONLY runs when someone requests that specific page. Every other
// page on the site (index.html, images, etc.) stays plain static
// content — free and unlimited, never touching this code at all.
//
// This checks for a valid signed session cookie (set by
// functions/api/login.js after a correct login on login.html). If
// there's no valid cookie, it redirects to the login page instead
// of showing the portal — no browser popup involved.

export async function onRequest(context) {
  const { request, env } = context;
  const secret = env.SESSION_SECRET;
  const url = new URL(request.url);

  if (secret) {
    const cookieHeader = request.headers.get("Cookie") || "";
    const match = cookieHeader.match(/mtl_staff_session=([^;]+)/);

    if (match) {
      const [expiryStr, signature] = match[1].split(".");
      const expiry = Number(expiryStr);

      if (expiry && expiry > Date.now() && signature) {
        const expectedSignature = await sign(secret, expiryStr);
        if (expectedSignature === signature) {
          return context.next(); // valid session — serve the real portal.html
        }
      }
    }
  }

  // No valid session — send them to the styled login page, remembering
  // where they were trying to go.
  return Response.redirect(`${url.origin}/login.html?redirect=/portal.html`, 302);
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
