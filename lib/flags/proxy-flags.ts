import { isDictationEnabled } from "@/lib/environment";
import { parseRuntimeFlags } from "@/lib/flags/runtime-flags";

/**
 * The runtime dictation flag for `proxy.ts` (DIAAT-392), which turns away
 * `/record` and `/speech-demo` when dictation is off.
 *
 * The proxy cannot call the API itself: it has no BenchNotes token, which lives in
 * the server-side session. So it asks this app's own `/auth/runtime-flags` route
 * (app/auth/runtime-flags/route.ts), passing on the browser's session cookie; that
 * route reads the session's token and calls `GET /api/flags`.
 *
 * Fails to the deploy-time value: if the route, the API or the session cannot
 * answer in time, `isDictationEnabled()` decides, exactly as before the flag
 * existed. The answer is kept for a few seconds so a burst of page loads is one
 * call, and a failure is kept for a shorter time so an outage is not retried on
 * every request. A refused session (401, 403) is neither: the cache is shared, and that
 * browser's expired session must not make everyone else fall back to the deploy default.
 */

export const FLAG_TTL_MS = 10_000;
export const FLAG_FAILURE_TTL_MS = 3_000;
export const FLAG_TIMEOUT_MS = 2_000;

let cached: { value: boolean | null; until: number } | null = null;

/** For tests. */
export function resetProxyFlagCache(): void {
  cached = null;
}

/** Where this server can reach itself. */
function selfOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

export interface FlagFetchDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** The flag as the API has it, or null when it could not be read. */
async function readRuntimeDictationFlag(
  cookie: string | null,
  { fetchImpl = fetch, now = Date.now }: FlagFetchDeps
): Promise<boolean | null> {
  if (cached && cached.until > now()) return cached.value;
  let value: boolean | null = null;
  try {
    const response = await fetchImpl(`${selfOrigin()}/auth/runtime-flags`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(FLAG_TIMEOUT_MS),
    });
    if (response.ok) {
      value = parseRuntimeFlags(await response.json())?.dictation_enabled ?? null;
    } else if (response.status === 401 || response.status === 403) {
      // Only this browser's session was refused (expired, deactivated): not an answer about the
      // flag, and not for other users to inherit from the shared cache.
      return null;
    }
  } catch {
    value = null;
  }
  cached = {
    value,
    until: now() + (value === null ? FLAG_FAILURE_TTL_MS : FLAG_TTL_MS),
  };
  return value;
}

/** Whether dictation pages may be served: the runtime flag, else the deploy default. */
export async function isDictationEnabledAtRuntime(
  cookie: string | null,
  deps: FlagFetchDeps = {}
): Promise<boolean> {
  const runtime = await readRuntimeDictationFlag(cookie, deps);
  return runtime ?? isDictationEnabled();
}
