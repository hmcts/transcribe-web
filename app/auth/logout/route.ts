import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { endSessionUrl } from "@/lib/auth/oidc";
import { cookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { deleteSession, readSession } from "@/lib/auth/session-store";

export const dynamic = "force-dynamic";

/** End the local session, then the Entra ID session. */
export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  let idTokenHint: string | undefined;
  if (sessionId) {
    idTokenHint = (await readSession(sessionId))?.idToken;
    await deleteSession(sessionId);
  }

  let destination = new URL("/", config.appUrl);
  if (config.enabled) {
    try {
      destination = await endSessionUrl(idTokenHint);
    } catch (err) {
      console.warn(
        "[auth] could not build end-session URL; signing out locally only",
        err
      );
    }
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
