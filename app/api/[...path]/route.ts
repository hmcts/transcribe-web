import { type NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/auth/app-token";
import { isDevLoginEnabled } from "@/lib/auth/dev-mode";
import { bearerForSession, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Local development only: the stand-in for Caddy's `forward_auth` (see the
 * Caddyfile). In deployment Caddy sends `/api/*` to the API with the session's
 * BenchNotes token attached; locally there is no Caddy, so this route does the
 * same: it discards whatever Authorization header the browser sent, attaches
 * the session's token and streams the request on.
 *
 * Routes with their own handler (app/api/jobs, upload, audio, version) take
 * precedence over this catch-all and keep their paths.
 *
 * Answers 404 unless login is off (AUTH_ENABLED is not "true") and this is not
 * a production build (isDevLoginEnabled).
 */

// Routes that return the token itself. The browser reaches them only through
// /auth/* (lib/auth), which keeps the token in the session.
const TOKEN_ROUTES = [
  /^auth\/session$/,
  /^me\/context$/,
  /^me\/jurisdictions\/[^/]+$/,
];

// Never copied from the browser's request.
const REQUEST_HEADERS_DROPPED = new Set([
  "host",
  "connection",
  "content-length",
  "cookie",
  "authorization",
  "x-dev-persona",
  "x-requested-context",
  "x-ms-client-principal",
  "x-ms-client-principal-id",
  "x-ms-client-principal-name",
  "x-ms-client-principal-idp",
  "x-ms-token-aad-access-token",
  "x-ms-token-aad-id-token",
]);

// fetch() has already decoded the body, so these no longer describe it.
const RESPONSE_HEADERS_DROPPED = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, { params }: Context) {
  if (!isDevLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { path } = await params;
  const joined = path.join("/");
  if (TOKEN_ROUTES.some((route) => route.test(joined))) {
    return NextResponse.json(
      {
        detail: {
          code: "not_through_the_browser",
          message: "This route returns the access token: use /auth/* instead.",
        },
      },
      { status: 404 }
    );
  }

  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!REQUEST_HEADERS_DROPPED.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  const token = await bearerForSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl()}/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        // Required by Node's fetch to stream a request body.
        ...(hasBody && { duplex: "half" }),
        redirect: "manual",
        cache: "no-store",
      } as RequestInit
    );
  } catch (error) {
    console.warn("[dev-proxy] the API could not be reached", error);
    return NextResponse.json(
      {
        detail: {
          code: "backend_unavailable",
          message: "The API could not be reached. Is it running?",
        },
      },
      { status: 502 }
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!RESPONSE_HEADERS_DROPPED.has(name.toLowerCase())) {
      responseHeaders.append(name, value);
    }
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
