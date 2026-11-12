/**
 * The service lead's sign-off, which switching a jurisdiction or a template on for
 * everyone (live) needs (DIAAT-347): who signed it off, and the admin's confirmation
 * that they have. The API records it with the date and the admin who saved it.
 */

export interface SignOff {
  service_lead: string;
  signed_off_at: string | null;
}

/** What the admin has entered so far. */
export interface SignOffDraft {
  serviceLead: string;
  confirmed: boolean;
}

export const NO_SIGN_OFF: SignOffDraft = { serviceLead: "", confirmed: false };

export const SIGN_OFF_MISSING =
  "Enter the service lead's name and tick that they have signed it off.";

/** The sign-off to send, or null while it is not complete. */
export function signOffToSend(
  draft: SignOffDraft
): { service_lead: string; confirmed: true } | null {
  const name = draft.serviceLead.trim();
  return name && draft.confirmed
    ? { service_lead: name, confirmed: true }
    : null;
}

/** "Signed off by A Lead on 12 November 2026". */
export function signedOffText(signOff: SignOff): string {
  const at = signOff.signed_off_at ? new Date(signOff.signed_off_at) : null;
  const date =
    at && !Number.isNaN(at.getTime())
      ? ` on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
      : "";
  return `Signed off by ${signOff.service_lead}${date}`;
}
