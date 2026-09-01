import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 proxy — runs on every non-static request.
 *
 * Responsibilities:
 *  1. Generate a per-response CSP nonce for Google Tag Manager and forward
 *     it to Server Components via the x-nonce request header.
 *  2. Protect the /admin route with Azure Easy Auth in production.
 *
 * In production (Azure Easy Auth), the presence of the
 * `AppServiceAuthSession` cookie proves the user has authenticated.
 * The actual admin authorization check is enforced server-side with
 * JWT role checks. The admin layout also verifies access before rendering.
 *
 * In local development (`NODE_ENV === "development"`) the admin gate is
 * skipped so developers can work without Azure AD.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. CSP nonce (production only) ────────────────────────────────────────
  // In development, Next.js/Turbopack use eval() and unnonce'd inline scripts
  // for HMR and React DevTools. Enforcing CSP in dev breaks those tools, so
  // we only apply the header in production where React never uses eval().
  const isDevelopment = process.env.NODE_ENV === "development";
  const nonce = btoa(crypto.randomUUID());

  // Include the backend API origin so fetch() calls aren't blocked by CSP.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
    `connect-src 'self' ${apiUrl} https://*.googletagmanager.com https://www.google.com https://*.google-analytics.com https://*.g.doubleclick.net`,
    `frame-src https://*.googletagmanager.com`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'self'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // ── 2. Auth guard for gated areas (production only) ────────────────────────
  //
  // MERGE NOTE: the recording frontend had its own middleware.ts that gated
  // EVERY route whenever EASY_AUTH_ENABLED=true. In Next.js 16 proxy.ts
  // supersedes middleware.ts, so only one edge handler can exist — and adopting
  // the blanket gate would have forced an Easy Auth login on dictation's public
  // pages (/cookies, /privacy, /help, /coming-soon), a regression.
  //
  // Resolution: keep this single edge handler and gate the recording area
  // explicitly alongside /admin. Both areas keep the behaviour they had; the
  // public pages stay public. Real authorization remains server-side.
  if (pathname.startsWith("/admin") || pathname.startsWith("/recording")) {
    // MERGE NOTE: the two areas gated on different signals. Dictation used
    // NODE_ENV; recording used EASY_AUTH_ENABLED, which Terraform sets false on
    // dev so Playwright e2e and manual checks can run without an AAD login.
    // Collapsing to NODE_ENV alone would have silently started gating the
    // recording area on dev and broken that. EASY_AUTH_ENABLED therefore still
    // wins where it is set explicitly.
    const easyAuthFlag = process.env.EASY_AUTH_ENABLED;
    const gateEnabled =
      easyAuthFlag !== undefined
        ? easyAuthFlag === "true"
        : process.env.NODE_ENV !== "development";

    if (gateEnabled) {
      const authCookie =
        request.cookies.get("AppServiceAuthSession") ??
        request.cookies.get(".AspNetCore.Cookies");

      if (!authCookie) {
        const loginUrl = new URL("/.auth/login/aad", request.url);
        loginUrl.searchParams.set(
          "post_login_redirect_uri",
          request.nextUrl.pathname
        );
        return NextResponse.redirect(loginUrl);
      }
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
