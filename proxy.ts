import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 proxy — runs on every non-static request (always on the Node.js
 * runtime in Next 16, so process.env is read per request).
 *
 * Responsibilities:
 *  1. Generate a per-response CSP nonce for Google Tag Manager and forward
 *     it to Server Components via the x-nonce request header.
 *  2. Send anyone without a session to the login (/auth/login).
 *
 * The session cookie's presence is only a routing hint. What protects data is
 * the API: every backend call carries the session's bearer token (Caddy's
 * forward_auth, or the recording route handlers), and the API verifies it.
 */
// Kept in step with lib/auth/session.ts. Duplicated rather than imported:
// that module is server-only and pulls in Redis and the OIDC client.
const SESSION_COOKIE = "transcribe_session";

// Paths reachable without a session. Mirrors what courtstranscribe excluded
// from Easy Auth (static assets, health), plus the login routes themselves.
// /cognitiveservices, /speech and /stt are handled by Caddy before Next.js.
const PUBLIC_PATHS = new Set([
  "/health",
  "/manifest.json",
  "/favicon.ico",
  "/service-worker.js",
  "/register-sw.js",
  "/env-config.js",
]);
const PUBLIC_ASSET = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|txt)$/i;

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/auth/") ||
    PUBLIC_ASSET.test(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. CSP nonce (production only) ────────────────────────────────────────
  // In development, Next.js/Turbopack use eval() and unnonce'd inline scripts
  // for HMR and React DevTools. Enforcing CSP in dev breaks those tools, so
  // we only apply the header in production where React never uses eval().
  const isDevelopment = process.env.NODE_ENV === "development";
  const nonce = btoa(crypto.randomUUID());

  // Include the backend API origin so fetch() calls aren't blocked by CSP.
  //
  // This MUST NOT use process.env.NEXT_PUBLIC_API_URL. Next inlines
  // NEXT_PUBLIC_* at build time, and CNP builds one image for every
  // environment, so that value is frozen to whatever the build machine had —
  // in practice the "http://localhost:8000" fallback below. Emitting that into
  // a deployed CSP is at best noise and at worst a trap: the header would look
  // like it permits the API while actually permitting nothing useful, and any
  // genuinely cross-origin API URL set at runtime would be blocked with only a
  // console error to show for it.
  //
  // Deployed environments are same-origin by design: the Helm chart points
  // NEXT_PUBLIC_API_URL at this app's own ingress host and Caddy proxies
  // /api/* onward to the backend, so 'self' already covers every call. Only
  // local development talks to a separate origin, and CSP is not applied there
  // (see the isDevelopment guard below).
  const apiUrl = isDevelopment
    ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    : "";

  const csp = [
    `script-src 'nonce-${nonce}' 'self' https://*.googletagmanager.com`,
    // script-src-elem must be set explicitly — otherwise the browser falls back to
    // script-src, which lacks blob:. The Azure Speech SDK loads its worker module
    // as a blob: URL <script>, so script-src-elem needs blob: while script-src
    // (which covers eval/inline) remains unchanged.
    `script-src-elem 'nonce-${nonce}' 'self' https://*.googletagmanager.com blob:`,
    // The Azure Speech SDK creates workers from both blob: and data: URLs:
    // - blob: for the audio-processing worker
    // - data: for an inline timer/keepalive scheduler worker
    // Without the data: worker the SDK's keepalive stops firing after the first
    // silence period, silently killing the transcription session.
    `worker-src blob: data: 'self'`,
    `img-src 'self' https://*.googletagmanager.com https://*.google-analytics.com https://*.g.doubleclick.net`,
    `connect-src ${["'self'", apiUrl].filter(Boolean).join(" ")} https://*.googletagmanager.com https://www.google.com https://*.google-analytics.com https://*.g.doubleclick.net`,
    `frame-src https://*.googletagmanager.com`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'self'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // ── 2. Login gate ─────────────────────────────────────────────────────────
  //
  // On App Service, Easy Auth sat in front of the whole app and required a
  // login for everything except a short list of excluded paths; this file only
  // gated /admin and /recording on top. On CNP there is no Easy Auth, so this
  // is now the only gate and it covers every page, matching what production
  // users experience today. AUTH_ENABLED is false for local development and
  // preview environments.
  if (process.env.AUTH_ENABLED === "true" && !isPublicPath(pathname)) {
    if (!request.cookies.get(SESSION_COOKIE)) {
      // Fetches from the recording area to its own /api/* route handlers get
      // a 401 they can act on, not an HTML redirect.
      if (pathname.startsWith("/api/")) {
        return new NextResponse(null, { status: 401 });
      }
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set(
        "returnTo",
        `${request.nextUrl.pathname}${request.nextUrl.search}`
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (!isDevelopment) {
    response.headers.set("Content-Security-Policy", csp);
  }

  return response;
}

export const config = {
  matcher: [
    {
      // Run on all routes except Next.js static assets and the Sentry tunnel.
      source: "/((?!_next/static|_next/image|favicon.ico|monitoring).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
