import "server-only";
import { NextResponse } from "next/server";
import {
  CONTEXT_CHANGED,
  CONTEXT_REQUIRED,
  USER_DEACTIVATED,
} from "@/lib/access/refusals";
import type { BackendApiError } from "@/lib/recording/api-client";

const IDENTITY_REFUSALS = new Set([
  CONTEXT_CHANGED,
  CONTEXT_REQUIRED,
  USER_DEACTIVATED,
]);

/**
 * The API refused the call because of who the user is, not because of this recording: a 409
 * `context_changed` (another tab switched), or a 403 `context_required` or `user_deactivated`.
 * (A plain 401 is not one: it keeps the route's own mapping.) The browser's refusal watcher (lib/access/refusals.ts) needs the status and `detail.code` to show
 * the stale-tab or account notice, so the route handlers pass these on as they came instead of
 * turning them into a 502, a 404 or a bare `{error}`.
 */
export function isIdentityRefusal(err: unknown): err is BackendApiError {
  // By name, not `instanceof`: the check must not depend on which copy of the client a caller
  // (or a test that replaces the client module) has.
  if (!(err instanceof Error) || err.name !== "BackendApiError") return false;
  const { code } = err as BackendApiError;
  return code !== undefined && IDENTITY_REFUSALS.has(code);
}

/** The response for an identity refusal, or null for any other error. */
export function identityRefusalResponse(err: unknown): NextResponse | null {
  if (!isIdentityRefusal(err)) return null;
  return NextResponse.json(
    { detail: { code: err.code, message: "Your access has changed." } },
    { status: err.status }
  );
}
