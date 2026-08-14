// functions/portal.html.js
//
// Because this file is named to match the exact route (/portal.html),
// it ONLY runs when someone requests that specific page. Every other
// page on the site (index.html, images, etc.) stays plain static
// content — free and unlimited, never touching this code at all.
//
// Credentials are NOT stored here. They come from environment
// variables set in the Cloudflare dashboard (see setup steps),
// so nothing sensitive ever lives in the GitHub repo.

export async function onRequest(context) {
  const { request, env } = context;

  const expectedUser = env.STAFF_USER;
  const expectedPass = env.STAFF_PASSWORD;

  // Safety check: if the env vars haven't been set yet in Cloudflare,
  // fail closed (block access) rather than accidentally leaving the
  // page open.
  if (!expectedUser || !expectedPass) {
    return new Response(
      "Staff login isn't configured yet. Set STAFF_USER and STAFF_PASSWORD in Cloudflare Pages settings.",
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("Authorization");

  if (authHeader && authHeader.startsWith("Basic ")) {
    const encoded = authHeader.slice(6);
    const decoded = atob(encoded); // "username:password"
    const separatorIndex = decoded.indexOf(":");
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);

    if (user === expectedUser && pass === expectedPass) {
      // Correct credentials — serve the actual portal.html file.
      return context.next();
    }
  }

  // No credentials, or wrong ones — ask the browser to prompt for a
  // username/password. This is the browser's own built-in login box,
  // no custom page needed.
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="MontanaTimberline Staff", charset="UTF-8"',
    },
  });
}
