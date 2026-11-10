import { getCurrentUser } from "@/lib/database";
import { type TelemetryRelay, telemetryRelay } from "@/lib/telemetry-relay";

/**
 * Tell the relay who is signed in now, so it sends (and restores) only that
 * account's telemetry (lib/telemetry-relay.ts). Asked of the API, not taken from
 * what the page last saw: another tab may have signed someone else in on the
 * shared session. Unknown (signed out, or the API not answering): no account, so
 * events waiting for the previous one are kept for it, never sent under this
 * session. Never throws.
 */
export async function confirmTelemetryAccount(
  relay: TelemetryRelay = telemetryRelay
): Promise<void> {
  const user = await getCurrentUser().catch(() => null);
  relay.setAccount(user?.id ? String(user.id) : null);
}
