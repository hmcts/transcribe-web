/**
 * Authentication helpers for browser code.
 *
 * On CNP the browser never holds an access token. The frontend server keeps
 * tokens in a server-side session (lib/auth/*), Caddy attaches the session's
 * bearer token to every backend /api/* call via forward_auth, and the
 * recording area's route handlers attach it themselves. The only thing the
 * browser carries is an httpOnly session cookie.
 */

/**
 * Always null — see above. Kept so that callers which add an `Authorization`
 * header only when a token exists keep working unchanged.
 */
export async function getAuthToken(): Promise<string | null> {
  return null;
}

/** Login URL that returns to `returnTo` (default: the current page). */
export function loginUrl(returnTo?: string): string {
  const target =
    returnTo ?? `${window.location.pathname}${window.location.search}`;
  return `/auth/login?returnTo=${encodeURIComponent(target)}`;
}
