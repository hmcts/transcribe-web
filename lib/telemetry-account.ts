import { getCurrentUser } from "@/lib/database";
import { type TelemetryRelay, telemetryRelay } from "@/lib/telemetry-relay";

/**
 * Tell the relay who is signed in now, so it sends (and restores) only that
 * account's telemetry (lib/telemetry-relay.ts). Asked of the API, not taken from
 * what the page last saw: another tab may have signed someone else in on the
 * shared session. Unknown (signed out, or the API not answering): no account, so
 * events waiting for the previous one are kept for it, and the app's relay sends
 * nothing until a later lookup names someone. Never throws.
 */
export async function confirmTelemetryAccount(
  relay: TelemetryRelay = telemetryRelay
): Promise<void> {
  // Numbered: an answer that comes back after a later lookup's is ignored.
  const check = relay.startAccountCheck();
  const user = await getCurrentUser().catch(() => null);
  relay.finishAccountCheck(check, user?.id ? String(user.id) : null);
}
