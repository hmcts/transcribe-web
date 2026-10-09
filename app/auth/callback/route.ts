import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { completeLogin } from "@/lib/auth/oidc";
import {
  cookieOptions,
  LOGIN_STATE_COOKIE,
  newSessionId,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import {
  deleteSession,
  takePendingLogin,
  writeSession,
} from "@/lib/auth/session-store";

export const dynamic = "force-dynamic";

function failed(status: number, reason: string): NextResponse {
  console.warn(`[auth] login callback rejected: ${reason}`);
  return new NextResponse(
    "Sign-in could not be completed. Please go back to the service and sign in again.",
    {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

/** Entra ID redirects here with an authorization code. */
export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  if (!config.enabled) {
    return NextResponse.redirect(new URL("/", config.appUrl));
  }

  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return failed(
      401,
      `identity provider returned ${error}: ${params.get("error_description") ?? ""}`
    );
  }

  // The state must match both the cookie set on this browser at /auth/login
  // (so a login started elsewhere cannot be completed here) and a pending
  // login we issued (single use, so a callback cannot be replayed).
  const state = params.get("state");
  const cookieState = request.cookies.get(LOGIN_STATE_COOKIE)?.value;
  if (!state || !cookieState || state !== cookieState) {
    return failed(400, "state missing or does not match this browser");
  }
  const pending = await takePendingLogin(state);
  if (!pending) {
    return failed(
      400,
      "no pending login for this state (expired or already used)"
    );
  }

  let session;
  try {
    session = await completeLogin(request.nextUrl.search, pending);
  } catch (err) {
    console.warn("[auth] code exchange failed", err);
    return failed(400, "code exchange failed");
  }

  // Always a new session ID on sign-in, so a pre-existing cookie cannot be
  // fixed onto the authenticated session.
  const previous = request.cookies.get(SESSION_COOKIE)?.value;
  if (previous) await deleteSession(previous);
  const sessionId = newSessionId();
  await writeSession(sessionId, session);

  const response = NextResponse.redirect(
    new URL(pending.returnTo, config.appUrl)
  );
  response.cookies.set(
    SESSION_COOKIE,
    sessionId,
    cookieOptions(config.sessionTtlSeconds)
  );
  response.cookies.set(LOGIN_STATE_COOKIE, "", cookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
