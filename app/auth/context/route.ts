import { type NextRequest, NextResponse } from "next/server";
import { asContextResponse } from "@/lib/auth/app-token";
import {
  backendRefusal,
  callWithSessionToken,
  NO_STORE,
  requireSession,
  storeTokenAndReply,
  unauthenticated,
} from "@/lib/auth/route-support";

export const dynamic = "force-dynamic";

/**
 * Choose the jurisdiction and role to work as (DIAAT-390): the browser's way to
 * `PUT /api/me/context`. The API answers with a new BenchNotes token, which
 * goes into the server-side session; the browser gets only the `me` object.
 * Caddy refuses the API route itself, so the token cannot reach the browser.
 *
 * Body: `{ "jurisdiction": "ET" | null, "role": "..." }`.
 */
export async function POST(request: NextRequest) {
  const held = await requireSession(request);
  if (!held) return unauthenticated();

  // JSON `null` (or a number, string or array) parses fine but is not a body: treat it
  // as an empty one, so it is the 400 below and not a 500.
  let body: { jurisdiction?: unknown; role?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // No body, or not JSON: the same 400.
  }
  const { jurisdiction, role } = body;
  if (
    typeof role !== "string" ||
    !role ||
    !(jurisdiction === null || typeof jurisdiction === "string")
  ) {
    return NextResponse.json(
      {
        detail: {
          code: "invalid_context",
          message: "Send a role and a jurisdiction (or null).",
        },
      },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const response = asContextResponse(
      await callWithSessionToken(held, "/api/me/context", {
        method: "PUT",
        body: { jurisdiction, role },
      })
    );
    return await storeTokenAndReply(held.sessionId, held.session, response);
  } catch (error) {
    return backendRefusal(error);
  }
}
