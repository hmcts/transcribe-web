import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { isPreviewSignInEnabled } from "@/lib/auth/preview-mode";
import { beginLogin } from "@/lib/auth/oidc";
import {
  cookieOptions,
  LOGIN_STATE_COOKIE,
  safeReturnTo,
} from "@/lib/auth/session";
import { writePendingLogin } from "@/lib/auth/session-store";

export const dynamic = "force-dynamic";

/** Start the Entra ID login. `?returnTo=/path` is where to land afterwards. */
export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  if (!config.enabled) {
    // A PR preview signs the preview user in (a 401 from the API ends up here).
    if (isPreviewSignInEnabled()) {
      const signIn = new URL("/auth/preview-login", config.appUrl);
      signIn.searchParams.set("returnTo", returnTo);
      return NextResponse.redirect(signIn);
    }
    return NextResponse.redirect(new URL(returnTo, config.appUrl));
  }

  const { url, pending } = await beginLogin(returnTo);
  await writePendingLogin(pending);

  const response = NextResponse.redirect(url);
  response.cookies.set(
    LOGIN_STATE_COOKIE,
    pending.state,
    cookieOptions(10 * 60)
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
