/**
 * The API's refusals about roles and requests, in words a person can act on
 * (DIAAT-373). The API sends its own message with every refusal and the screens
 * fall back to it, so a code this file does not know is still shown. These are the
 * codes where the web can say more than the API does, or where the same code means
 * different things in different places (`assignment_not_allowed`).
 *
 * | code                         | status | where it happens                                   |
 * |------------------------------|--------|----------------------------------------------------|
 * | `own_request`                | 403    | approving or rejecting your own access request      |
 * | `assignment_not_allowed`     | 403    | a role the caller may not give (to anyone, themselves included) |
 * | `ambiguous_email`            | 409    | assigning by an email that more than one user has used |
 * | `jurisdiction_disabled`      | 409    | assigning, or approving, into a disabled jurisdiction |
 * | `too_many_pending_requests`  | 409    | asking for access with the limit of requests waiting |
 * | `permission_denied`          | 403    | saving a jurisdiction's name or enabled switch without `jurisdiction.create` |
 */

export const OWN_REQUEST = "own_request";
export const ASSIGNMENT_NOT_ALLOWED = "assignment_not_allowed";
export const AMBIGUOUS_EMAIL = "ambiguous_email";
export const JURISDICTION_DISABLED = "jurisdiction_disabled";
export const TOO_MANY_PENDING_REQUESTS = "too_many_pending_requests";
export const PERMISSION_DENIED = "permission_denied";

/** Shown next to the Approve and Reject buttons' place on your own request. */
export const OWN_REQUEST_NOTE =
  "This is your own request. Another administrator has to decide it.";

export interface RefusalContext {
  /** The refusal came from saving a jurisdiction's settings. */
  savingJurisdiction?: boolean;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : undefined;
}

/**
 * The text to show for a refusal: ours for the codes above, otherwise the API's
 * own message, otherwise `fallback`.
 */
export function describeRefusal(
  error: unknown,
  context: RefusalContext = {},
  fallback = "Something went wrong"
): string {
  const apiMessage =
    error instanceof Error && error.message ? error.message : undefined;
  switch (codeOf(error)) {
    case OWN_REQUEST:
      return OWN_REQUEST_NOTE;
    case AMBIGUOUS_EMAIL:
      return "More than one person has signed in with that email address, so it is not clear who you mean. Choose the person from the list that appears as you type, instead of adding the address.";
    case JURISDICTION_DISABLED:
      return "That jurisdiction is switched off, so nobody can be given a role there. A super administrator can switch it on again in Admin, Jurisdictions.";
    case TOO_MANY_PENDING_REQUESTS:
      return "You already have as many requests waiting as are allowed. Withdraw one of them, then ask again.";
    case PERMISSION_DENIED:
      return context.savingJurisdiction
        ? "Only a super administrator can rename or switch off a jurisdiction. Everything else on this page you can still change."
        : (apiMessage ?? fallback);
    default:
      return apiMessage ?? fallback;
  }
}
