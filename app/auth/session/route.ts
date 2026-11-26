import type { NextRequest } from "next/server";
import { BackendError } from "@/lib/auth/app-token";
import { mintForSession } from "@/lib/auth/session";
import {
  backendRefusal,
  requireSession,
  storeTokenAndReply,
  unauthenticated,
} from "@/lib/auth/route-support";

export const dynamic = "force-dynamic";

/**
 * Mint a fresh BenchNotes token now, rather than near expiry (for instance
 * after an access request is approved), keeping the session's context. Only
 * the `me` object goes back to the browser, never the token (DIAAT-373).
 */
export async function POST(request: NextRequest) {
  const held = await requireSession(request);
  if (!held) return unauthenticated();
  try {
    const minted = await mintForSession(held.session);
    return await storeTokenAndReply(held.sessionId, held.session, minted);
  } catch (error) {
    if (error instanceof BackendError && (error.status === 401 || error.status === 403)) {
      return unauthenticated();
    }
    return backendRefusal(error);
  }
}
