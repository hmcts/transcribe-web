/**
 * Browser failures that no tracker saw once Sentry was removed (DIAAT-205, D8):
 *
 * - `ui.error`: a client-side error caught by the error page (`render`), by
 *   `window.onerror` or as an unhandled promise rejection. Only the error's class
 *   name, where it was caught, the route (IDs replaced) and the Next.js digest:
 *   never its message or stack, which can quote page content.
 * - `upload.transfer_failed`: a dictation upload the browser could not send to
 *   storage after its retries.
 *
 * Both are operational events, sent through the relay without analytics consent
 * (transcribe-api's telemetry contract). Repeats of one error on a page are sent
 * once a minute at most, and at most MAX_ERRORS_PER_PAGE in all, so an error loop
 * cannot flood the relay.
 */

import { fileType, normaliseRoute } from "@/lib/analytics";
import { type TelemetryRelay, telemetryRelay } from "@/lib/telemetry-relay";

export type ClientErrorSource =
  | "render"
  | "window_error"
  | "unhandled_rejection";

const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
const DIGEST = /^[A-Za-z0-9]{1,32}$/;
const MAX_ERRORS_PER_PAGE = 20;
const REPEAT_AFTER_MS = 60_000;

/** The error's class name (e.g. TypeError), never its message. */
export function errorType(error: unknown): string {
  const name =
    error instanceof Error
      ? error.name || error.constructor?.name
      : error === null || error === undefined
        ? "NoError"
        : typeof error === "object"
          ? (error as { constructor?: { name?: string } }).constructor?.name
          : "NonError";
  return typeof name === "string" && ERROR_TYPE.test(name) ? name : "Error";
}

export interface BrowserFailures {
  clientError(error: unknown, source: ClientErrorSource, digest?: string): void;
  transferFailed(input: {
    code: string;
    status?: number;
    file: Blob;
    attempt: number;
  }): void;
}

export function createBrowserFailures(
  relay: Pick<TelemetryRelay, "emit">,
  now: () => number = Date.now,
  path: () => string = () =>
    typeof window === "undefined" ? "/" : window.location.pathname
): BrowserFailures {
  const lastSent = new Map<string, number>();
  let sent = 0;
  return {
    clientError(error, source, digest) {
      try {
        const type = errorType(error);
        const route = normaliseRoute(path());
        const digestKey = digest && DIGEST.test(digest) ? digest : "";
        const key = `${type}|${source}|${route}|${digestKey}`;
        const at = now();
        const previous = lastSent.get(key);
        if (previous !== undefined && at - previous < REPEAT_AFTER_MS) return;
        if (sent >= MAX_ERRORS_PER_PAGE) return;
        lastSent.set(key, at);
        sent += 1;
        relay.emit({
          name: "ui.error",
          attributes: {
            "ui.error_type": type,
            "ui.error_source": source,
            "page.route": route,
            "next.error.digest":
              digest && DIGEST.test(digest) ? digest : undefined,
          },
        });
      } catch {
        // Reporting an error must never cause another.
      }
    },
    transferFailed({ code, status, file, attempt }) {
      try {
        relay.emit({
          name: "upload.transfer_failed",
          attributes: {
            "hmcts.error.code": code,
            "http.response.status_code": status,
            "file.type": fileType(file.type),
            "file.size_bytes": file.size,
            "upload.retry_attempt": attempt,
            "upload.source": file instanceof File ? "upload" : "recording",
          },
        });
      } catch {
        // Telemetry never breaks the upload flow.
      }
    },
  };
}

export const browserFailures = createBrowserFailures(telemetryRelay);

let handlersInstalled = false;

/** window.onerror and unhandled rejections, once per page. */
export function installClientErrorHandlers(
  failures: BrowserFailures = browserFailures
): void {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;
  window.addEventListener("error", (event) =>
    failures.clientError(event.error, "window_error")
  );
  window.addEventListener("unhandledrejection", (event) =>
    failures.clientError(event.reason, "unhandled_rejection")
  );
}
