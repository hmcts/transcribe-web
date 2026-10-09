import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { bearerForSession, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Caddy's forward_auth target for every backend /api/* call (see Caddyfile).
 *
 * 200 with `Authorization: Bearer <id token>` → Caddy copies that header onto
 * the proxied request. 401 → Caddy returns it to the browser, which sends the
 * user to /auth/login.
 *
 * Caddy answers 404 for this path on the public port, so only its own
 * forward_auth subrequest (straight to Next.js on :3001) reaches it; a browser
 * cannot read the token from this response.
 */
export async function GET(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };
  if (!getAuthConfig().enabled) {
    return new NextResponse(null, { status: 200, headers: noStore });
  }
  const token = await bearerForSession(
    request.cookies.get(SESSION_COOKIE)?.value
  );
  if (!token) {
    return new NextResponse(null, {
      status: 401,
      headers: { ...noStore, "WWW-Authenticate": "Bearer" },
    });
  }
  return new NextResponse(null, {
    status: 200,
    headers: { ...noStore, Authorization: `Bearer ${token}` },
  });
}
