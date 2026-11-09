/**
 * The API answers 409 `context_changed` when a tab's `X-Jurisdiction` and
 * `X-Role` differ from the session's context (another tab switched, or the
 * role was removed): the tab's page state is stale and must reload.
 *
 * Calls reach the API from many places (the shared client, live-draft saves,
 * downloads, uploads), so one watcher on `fetch` sees them all, rather than
 * every caller having to remember to look.
 */

export const CONTEXT_CHANGED = "context_changed";

/** The refusal's machine-readable code, from `{code}` or `{detail: {code}}`. */
export function contextChangedIn(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const top = (body as { code?: unknown }).code;
  const detail = (body as { detail?: unknown }).detail;
  const nested =
    detail && typeof detail === "object"
      ? (detail as { code?: unknown }).code
      : undefined;
  return top === CONTEXT_CHANGED || nested === CONTEXT_CHANGED;
}

/**
 * Call `onChanged` when any same-origin or API response is a 409
 * `context_changed`. Returns the function that removes the watcher.
 */
export function watchContextChanged(onChanged: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const original = window.fetch;
  const watching: typeof fetch = async (...args) => {
    const response = await original.apply(window, args);
    if (response.status === 409) {
      response
        .clone()
        .json()
        .then((body) => {
          if (contextChangedIn(body)) onChanged();
        })
        .catch(() => undefined);
    }
    return response;
  };
  window.fetch = watching;
  return () => {
    if (window.fetch === watching) window.fetch = original;
  };
}
