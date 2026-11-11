import "server-only";
import { randomBytes } from "node:crypto";
import {
  BackendError,
  mintAppToken,
  REMINT_WITHIN_MS,
  withToken,
} from "@/lib/auth/app-token";
import { getAuthConfig } from "@/lib/auth/config";
import { isDevLoginEnabled } from "@/lib/auth/dev-mode";
import { isPreviewSignInEnabled } from "@/lib/auth/preview-mode";
import { refreshIfNeeded } from "@/lib/auth/oidc";
import {
  deleteSession,
  readSession,
  type Session,
  writeSession,
} from "@/lib/auth/session-store";

export const SESSION_COOKIE = "transcribe_session";
/** Binds the login callback to the browser that started it (login CSRF). */
export const LOGIN_STATE_COOKIE = "transcribe_login_state";

export function cookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    // Lax, not Strict: the return from Entra is a cross-site top-level GET.
    sameSite: "lax" as const,
    secure: getAuthConfig().appUrl.startsWith("https://"),
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Only same-site relative paths are allowed as post-login destinations, so the
 * login endpoint cannot be used as an open redirect.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return "/";
  }
  if (value.startsWith("/auth/")) return "/";
  return value;
}

/** Whether the session's user holds one of the access roles, when any are set. */
export function hasAppAccess(session: Session): boolean {
  const { accessRoles } = getAuthConfig();
  return (
    accessRoles.length === 0 ||
    accessRoles.some((role) => session.user.roles.includes(role))
  );
}

/** Mint a token for this session's user, keeping its remembered context. */
export function mintForSession(session: Session) {
  return mintAppToken({
    // A persona or preview-user session has no Entra token: the API gets none.
    idToken: session.devPersona || session.previewUser ? undefined : session.idToken,
    devPersona: session.devPersona,
    requestedContext: session.context,
  });
}

/**
 * Write a session a refresh or re-mint produced from ``snapshot``, unless someone changed the
 * stored session since: a context switch or a leave (which store a newer token and context)
 * must not be undone by a slower refresh that started from the old one. Returns the session
 * now in force: ``next`` if it was stored, else what the other writer stored.
 *
 * Not stored at all (signed out meanwhile): nothing is written, so a refresh cannot bring a
 * session back, and ``next`` serves this request only.
 *
 * Read-then-write, not atomic across replicas: it closes the window from a whole refresh
 * (a network call) to a few milliseconds, and the loser's next re-mint repeats the context
 * the session last stored.
 */
export async function persistRefreshed(
  sessionId: string,
  snapshot: Session,
  next: Session
): Promise<Session> {
  const stored = await readSession(sessionId);
  if (!stored) return next;
  const unchanged =
    stored.appToken === snapshot.appToken &&
    JSON.stringify(stored.context ?? null) ===
      JSON.stringify(snapshot.context ?? null);
  if (!unchanged) return stored;
  await writeSession(sessionId, next);
  return next;
}

/** Re-mints in flight, so concurrent requests of one session mint once. */
const minting = new Map<string, Promise<Session | null>>();

/**
 * Make sure the session holds a BenchNotes token with more than a minute left,
 * minting a new one from the Entra ID token (or, in local development, the
 * persona) and the session's remembered context. Returns null when the API
 * says the session is over (the ID token is refused, or the user is blocked);
 * a blip (API unreachable or erroring) keeps a still-valid token.
 */
async function ensureAppToken(
  sessionId: string,
  session: Session
): Promise<Session | null> {
  const expiresAt = session.appTokenExpiresAt ?? 0;
  if (session.appToken && expiresAt - Date.now() > REMINT_WITHIN_MS) {
    return session;
  }
  const inFlight = minting.get(sessionId);
  if (inFlight) return inFlight;

  const work = (async (): Promise<Session | null> => {
    try {
      return withToken(session, await mintForSession(session));
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.status === 401 || error.status === 403)
      ) {
        console.warn("[auth] token mint refused; session ends", error.message);
        await deleteSession(sessionId);
        return null;
      }
      console.warn("[auth] token mint failed", error);
      // Still valid for a while: keep going on it. Otherwise there is nothing
      // to send, and the caller treats it as signed out for now.
      return session.appToken && expiresAt > Date.now() ? session : null;
    }
  })();
  minting.set(sessionId, work);
  try {
    return await work;
  } finally {
    minting.delete(sessionId);
  }
}

/**
 * Resolve the session for a cookie value: refresh the Entra ID token when it
 * is close to expiry, then make sure there is a usable BenchNotes token.
 * Returns null when there is no usable session; a session that cannot be
 * refreshed, or whose user no longer holds an access role, is deleted.
 */
export async function getActiveSession(
  sessionId: string | undefined
): Promise<Session | null> {
  if (!sessionId) return null;
  const session = await readSession(sessionId);
  if (!session) return null;

  let current: Session | null;
  if (session.devPersona) {
    // A persona session means nothing outside local development.
    if (!isDevLoginEnabled()) {
      await deleteSession(sessionId);
      return null;
    }
    current = session;
  } else if (session.previewUser) {
    // A preview session means nothing once preview sign-in is off (or login is on).
    if (!isPreviewSignInEnabled()) {
      await deleteSession(sessionId);
      return null;
    }
    current = session;
  } else {
    current = await refreshIfNeeded(session);
    if (!current || !hasAppAccess(current)) {
      await deleteSession(sessionId);
      return null;
    }
  }

  const withApp = await ensureAppToken(sessionId, current);
  if (!withApp) return null;
  if (withApp !== session) {
    return persistRefreshed(sessionId, session, withApp);
  }
  return withApp;
}

/** The bearer token to send to the API for this session, if any: the BenchNotes
 * token, never the Entra one. */
export async function bearerForSession(
  sessionId: string | undefined
): Promise<string | null> {
  const session = await getActiveSession(sessionId);
  return session?.appToken ?? null;
}
