import { type NextRequest, NextResponse } from "next/server";
import {
  asContextResponse,
  backendCallWithToken,
} from "@/lib/auth/app-token";
import {
  backendRefusal,
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

  let body: { jurisdiction?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
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
      await backendCallWithToken(
        "/api/me/context",
        held.session.appToken as string,
        { method: "PUT", body: { jurisdiction, role } }
      )
    );
    return await storeTokenAndReply(held.sessionId, held.session, response);
  } catch (error) {
    return backendRefusal(error);
  }
}
