import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import type { TokenResponse } from "@/lib/access/types";
import {
  BackendError,
  backendCallWithToken,
  withToken,
} from "@/lib/auth/app-token";
import {
  getActiveSession,
  mintForSession,
  persistRefreshed,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { type Session, writeSession } from "@/lib/auth/session-store";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The signed-in session for a request, with a valid BenchNotes token, or null. */
export async function requireSession(
  request: NextRequest
): Promise<{ sessionId: string; session: Session } | null> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getActiveSession(sessionId);
  return sessionId && session ? { sessionId, session } : null;
}

export function unauthenticated(): NextResponse {
  return NextResponse.json(
    { detail: { code: "unauthenticated", message: "Sign in again." } },
    { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } }
  );
}

/** The API's refusal, passed on as it came (status and JSON body) but never more. */
export function backendRefusal(error: unknown): NextResponse {
  if (error instanceof BackendError && error.status > 0) {
    return NextResponse.json(
      error.body ?? { detail: { code: "backend_error", message: error.message } },
      { status: error.status, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    {
      detail: {
        code: "backend_unavailable",
        message: "BenchNotes could not reach its service. Try again.",
      },
    },
    { status: 502, headers: NO_STORE }
  );
}

/**
 * A new token the API returned: kept in the session, and only the `me` object
 * goes back to the browser. The token itself never does.
 */
export async function storeTokenAndReply(
  sessionId: string,
  session: Session,
  tokenResponse: TokenResponse
): Promise<NextResponse> {
  await writeSession(sessionId, withToken(session, tokenResponse));
  return NextResponse.json(tokenResponse.me, { headers: NO_STORE });
}

/**
 * A call that carries the session's BenchNotes token and returns a new one
 * (`PUT /api/me/context`, `DELETE /api/me/jurisdictions/{code}`). The API mints
 * those from the presenting token and never lets one outlive the Entra-verified
 * sign-in it descends from (`sess_exp`), so a chain of them can end in a plain
 * 401 while the user is still signed in. That is not the end of the session:
 * mint again from the Entra ID token (keeping the context) and repeat the call
 * once, so the user is not bounced.
 */
export async function callWithSessionToken(
  held: { sessionId: string; session: Session },
  path: string,
  init: { method: string; body?: unknown }
): Promise<unknown> {
  try {
    return await backendCallWithToken(
      path,
      held.session.appToken as string,
      init
    );
  } catch (error) {
    if (!(error instanceof BackendError) || error.status !== 401) throw error;
  }
  const renewed = withToken(held.session, await mintForSession(held.session));
  // Unless a switch landed meanwhile: then its token is the one to use.
  const kept = await persistRefreshed(held.sessionId, held.session, renewed);
  held.session = kept;
  return backendCallWithToken(path, kept.appToken as string, init);
}
