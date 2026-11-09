import { type NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/auth/app-token";
import { bearerForSession, SESSION_COOKIE } from "@/lib/auth/session";
import { parseRuntimeFlags } from "@/lib/flags/runtime-flags";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2_000;

/**
 * The runtime feature flags for `proxy.ts` (DIAAT-392): `GET /api/flags` with the
 * session's BenchNotes token, which the proxy does not have. It gives back only
 * what the API's own `/api/flags` gives any signed-in user, so it adds nothing
 * a browser could not already read; without a session it answers 401, and any
 * failure is a 502 (the proxy then keeps the deploy-time value).
 */
export async function GET(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };
  const token = await bearerForSession(
    request.cookies.get(SESSION_COOKIE)?.value
  );
  if (!token) {
    return NextResponse.json(
      { detail: { code: "unauthenticated", message: "Not signed in" } },
      { status: 401, headers: noStore }
    );
  }
  try {
    const response = await fetch(`${backendUrl()}/api/flags`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const flags = response.ok ? parseRuntimeFlags(await response.json()) : null;
    if (!flags) throw new Error(`flags answered ${response.status}`);
    return NextResponse.json(flags, { headers: noStore });
  } catch {
    return NextResponse.json(
      { detail: { code: "flags_unavailable", message: "Flags could not be read" } },
      { status: 502, headers: noStore }
    );
  }
}
