// functions/_middleware.js
//
// Runs on every request to this Pages project before any static file is
// served. It only steps in for the paths listed in PROTECTED_PATHS —
// everything else (index.html, images, etc.) passes through untouched.
//
// Credentials are NOT stored in this file. They come from environment
// variables you set in the Cloudflare dashboard (see instructions below),
// so nothing sensitive ever lives in the GitHub repo.

const PROTECTED_PATHS = ["/portal.html"];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const needsAuth = PROTECTED_PATHS.some(
    (path) => url.pathname === path
  );

  if (!needsAuth) {
    return context.next();
  }

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
      return context.next(); // credentials correct, let the request through
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
