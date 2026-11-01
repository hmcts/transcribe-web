import "server-only";
import { bearerForSession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  JURISDICTION_HEADER,
  JURISDICTION_QUERY,
} from "@/lib/jurisdiction-session";

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
  /** DIAAT-334: the jurisdiction the browser tab works in, passed on to the API
   * (which checks the user belongs to it). Absent from a server component, which
   * has no tab: the API then uses the user's remembered jurisdiction. */
  jurisdiction?: string | null;
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
  const jurisdiction = request.headers.get(JURISDICTION_HEADER)?.trim();
  return {
    bearerToken: await bearerForSession(
      sessionIdFrom(request.headers.get("cookie"))
    ),
    ...(jurisdiction && { jurisdiction }),
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

/**
 * The jurisdiction an <audio> source names in its query (DIAAT-334): it cannot
 * send the header. For the audio route alone; every other route takes the header.
 */
export function jurisdictionFromAudioUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get(JURISDICTION_QUERY)?.trim() || null;
  } catch {
    return null;
  }
}
