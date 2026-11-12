import type { NextRequest } from "next/server";
import { asContextResponse } from "@/lib/auth/app-token";
import {
  backendRefusal,
  callWithSessionToken,
  requireSession,
  storeTokenAndReply,
  unauthenticated,
} from "@/lib/auth/route-support";

export const dynamic = "force-dynamic";

/**
 * Leave a jurisdiction (DIAAT-390): the browser's way to
 * `DELETE /api/me/jurisdictions/{code}`. As for choosing a context, the new
 * token stays in the session and the browser gets only `me`.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const held = await requireSession(request);
  if (!held) return unauthenticated();
  const { code } = await params;

  try {
    const response = asContextResponse(
      await callWithSessionToken(
        held,
        `/api/me/jurisdictions/${encodeURIComponent(code)}`,
        { method: "DELETE" }
      )
    );
    return await storeTokenAndReply(held.sessionId, held.session, response);
  } catch (error) {
    return backendRefusal(error);
  }
}
