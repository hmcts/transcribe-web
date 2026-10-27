/**
 * Why a live-draft write or read failed.
 *
 * DIAAT-296: every live-draft failure was caught and thrown away to the
 * console, so a judge dictated for 50 minutes with nothing being saved and no
 * indication on screen. Surfacing the failure is only half the fix â€” the user
 * has to be told the *right* thing, and "you have been signed out" and "the
 * network dropped" need different words and a different next action.
 *
 * The auth case deserves a note, because the ticket describes it wrongly.
 * `getAuthToken()` does **not** throw when `/.auth/refresh` fails: every throw
 * inside it is caught by its own recovery block and it returns `null` (see the
 * "returns null when the refresh endpoint returns an error" case in
 * `tests/unit/lib-auth-utils.test.ts`). So a token failure does not surface as
 * an exception â€” `authHeaders()` quietly returns `{}`, the request goes to the
 * backend with no `Authorization` header, and the backend answers 401. The
 * status code is therefore the honest signal, and it is the one used here.
 * A null token cannot be used as the signal instead: `getAuthToken()` also
 * returns null by design in local development.
 */

export type LiveDraftFailureKind =
  /** Rejected before a response existed â€” offline, DNS, TLS, dropped socket. */
  | "network"
  /** The backend rejected our identity. The user must sign in again. */
  | "auth"
  /** Reached the backend and it refused or broke. Retrying may work. */
  | "server";

export class LiveDraftError extends Error {
  readonly kind: LiveDraftFailureKind;
  /** HTTP status, when the request got far enough to have one. */
  readonly status?: number;

  constructor(
    kind: LiveDraftFailureKind,
    message: string,
    status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "LiveDraftError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Only 401 and 403 mean "your identity was rejected". Everything else that
 * comes back with a status reached the backend and is the backend's problem,
 * including a 400 â€” telling a judge to sign in again when the client sent a
 * malformed body would send them down the wrong path entirely.
 */
export function classifyLiveDraftStatus(status: number): LiveDraftFailureKind {
  return status === 401 || status === 403 ? "auth" : "server";
}

/**
 * Classify anything caught from the live-draft API.
 *
 * Non-`LiveDraftError` throws are treated as network failures because that is
 * what they are in practice: `fetch()` rejects with a bare `TypeError` when the
 * request never reaches the server, which is precisely the browser-side
 * "Failed to fetch" the judge hit in the incident.
 */
export function liveDraftFailureKind(error: unknown): LiveDraftFailureKind {
  return error instanceof LiveDraftError ? error.kind : "network";
}
