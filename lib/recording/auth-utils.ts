import "server-only";
import { bearerForSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * What a recording route handler or server component sends to the backend.
 *
 * Previously this forwarded App Service Easy Auth's headers
 * (x-ms-client-principal and x-ms-token-aad-access-token) and fell back to a
 * service API key. On CNP there is no Easy Auth: the token comes from this
 * app's own server-side session, and the backend authenticates from that
 * token alone. Without a session there is no token, and the backend answers
 * 401 — there is no service-key fallback for user routes.
 */
export interface BackendAuthContext {
  bearerToken: string | null;
}

/** Read our session cookie from a Cookie header. */
function sessionIdFrom(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/**
 * Route handlers: resolve from the request's session cookie. Takes any
 * Request (reads the Cookie header) rather than relying on NextRequest's
 * cookies helper.
 */
export async function getBackendAuthContext(
  request: Pick<Request, "headers">
): Promise<BackendAuthContext> {
  return {
    bearerToken: await bearerForSession(
      sessionIdFrom(request.headers.get("cookie"))
    ),
  };
}

/**
 * React Server Components have no NextRequest, so read the cookie through
 * next/headers. Imported dynamically so this module stays usable from route
 * handlers (and their tests) without pulling in the RSC-only API.
 */
export async function getServerComponentAuthContext(): Promise<BackendAuthContext> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return {
    bearerToken: await bearerForSession(store.get(SESSION_COOKIE)?.value),
  };
}
