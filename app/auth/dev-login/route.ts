import { type NextRequest, NextResponse } from "next/server";
import {
  BackendError,
  backendErrorCode,
  mintAppToken,
  withToken,
} from "@/lib/auth/app-token";
import { getAuthConfig } from "@/lib/auth/config";
import { isDevLoginEnabled } from "@/lib/auth/dev-mode";
import {
  cookieOptions,
  newSessionId,
  SESSION_COOKIE,
  safeReturnTo,
} from "@/lib/auth/session";
import {
  deleteSession,
  type Session,
  writeSession,
} from "@/lib/auth/session-store";

export const dynamic = "force-dynamic";

const PERSONA = /^[a-z0-9][a-z0-9-]{0,39}$/;

function text(status: number, message: string): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Local development only: sign in as one of the API's seeded personas, with no
 * Entra. `/auth/dev-login?persona=<name>[&returnTo=/path]`.
 *
 * Answers 404, as if the route did not exist, unless login is off
 * (AUTH_ENABLED is not "true") and this is not a production build. The API
 * refuses personas itself unless it runs with ENVIRONMENT=local.
 */
export async function GET(request: NextRequest) {
  if (!isDevLoginEnabled()) {
    return text(404, "Not found");
  }

  const params = request.nextUrl.searchParams;
  const persona = params.get("persona") ?? "";
  if (!PERSONA.test(persona)) {
    return text(400, "Name a persona: /auth/dev-login?persona=judge-et");
  }
  const returnTo = safeReturnTo(params.get("returnTo"));

  let minted;
  try {
    minted = await mintAppToken({ devPersona: persona });
  } catch (error) {
    if (error instanceof BackendError && error.status > 0 && error.status < 500) {
      if (backendErrorCode(error) === "user_deactivated") {
        return text(
          403,
          `The user for persona "${persona}" has been deactivated. Reactivate it in Admin, Users (as a user who may), or re-seed a fresh database.`
        );
      }
      return text(
        401,
        `The API did not accept the persona "${persona}" (${error.status}). Is it seeded, and is the API running with ENVIRONMENT=local?`
      );
    }
    console.warn("[auth] dev login: the API could not be reached", error);
    return text(502, "The API could not be reached. Is it running?");
  }

  const config = getAuthConfig();
  const previous = request.cookies.get(SESSION_COOKIE)?.value;
  if (previous) await deleteSession(previous);

  const base: Session = {
    idToken: "",
    // No Entra token to refresh: never counts as expiring.
    idTokenExpiresAt: Number.MAX_SAFE_INTEGER,
    user: {
      oid: minted.me.user.id,
      name: minted.me.user.name,
      email: minted.me.user.email,
      roles: [],
    },
    createdAt: Date.now(),
    devPersona: persona,
  };
  const sessionId = newSessionId();
  await writeSession(sessionId, withToken(base, minted));

  // On the origin the developer used (localhost or 127.0.0.1), so the cookie
  // set here is the one the next request sends.
  const response = NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(
    SESSION_COOKIE,
    sessionId,
    cookieOptions(config.sessionTtlSeconds)
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
