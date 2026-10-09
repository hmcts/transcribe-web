import "server-only";
import { randomBytes } from "node:crypto";
import { getAuthConfig } from "@/lib/auth/config";
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

/**
 * Resolve the session for a cookie value, refreshing the ID token when it is
 * close to expiry. Returns null when there is no usable session; a session
 * that cannot be refreshed is deleted.
 */
export async function getActiveSession(
  sessionId: string | undefined
): Promise<Session | null> {
  if (!sessionId) return null;
  const session = await readSession(sessionId);
  if (!session) return null;
  const current = await refreshIfNeeded(session);
  if (!current) {
    await deleteSession(sessionId);
    return null;
  }
  if (current !== session) {
    await writeSession(sessionId, current);
  }
  return current;
}

/** The bearer token to send to the API for this session, if any. */
export async function bearerForSession(
  sessionId: string | undefined
): Promise<string | null> {
  const session = await getActiveSession(sessionId);
  return session?.idToken ?? null;
}
