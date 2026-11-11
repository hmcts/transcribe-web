import { type NextRequest, NextResponse } from "next/server";
import { BackendError, mintAppToken, withToken } from "@/lib/auth/app-token";
import { getAuthConfig } from "@/lib/auth/config";
import { isPreviewSignInEnabled } from "@/lib/auth/preview-mode";
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
 * PR previews only: sign the browser in as the API's fixed preview user, with no
 * Entra. `/auth/preview-login[?returnTo=/path]`. The page gate (proxy.ts) and a 401
 * from the API send a browser without a session here.
 *
 * Answers 404, as if the route did not exist, unless PREVIEW_USER_SIGN_IN=true and
 * login is off (AUTH_ENABLED is not "true"): isPreviewSignInEnabled. The API signs
 * the preview user in only with ENVIRONMENT=preview, and only for a sign-in that
 * sends no Authorization header, so none is sent, and no persona either.
 *
 * No context is requested: the preview user holds every role, so the API answers
 * "choose", and the existing chooser (and the header's switcher) picks one.
 */
export async function GET(request: NextRequest) {
  if (!isPreviewSignInEnabled()) {
    return text(404, "Not found");
  }

  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  let minted;
  try {
    minted = await mintAppToken({});
  } catch (error) {
    if (error instanceof BackendError && error.status > 0 && error.status < 500) {
      return text(
        401,
        `The API did not sign in the preview user (${error.status}). Does it run with ENVIRONMENT=preview and AUTH_PREVIEW_USER_ENABLED=true?`
      );
    }
    console.warn("[auth] preview login: the API could not be reached", error);
    return text(502, "The API could not be reached. Try again in a moment.");
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
    previewUser: true,
  };
  const sessionId = newSessionId();
  await writeSession(sessionId, withToken(base, minted));

  const response = NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(
    SESSION_COOKIE,
    sessionId,
    cookieOptions(config.sessionTtlSeconds)
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
