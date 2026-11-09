import {
  CONTEXT_CHANGED,
  refusalCodeIn,
  watchRefusals,
} from "@/lib/access/refusals";

/**
 * The API answers 409 `context_changed` when a tab's `X-Jurisdiction` and
 * `X-Role` differ from the session's context (another tab switched, or the
 * role was removed): the tab's page state is stale and must reload.
 *
 * The watcher on `fetch` is shared with the other refusals (lib/access/refusals.ts).
 */

export { CONTEXT_CHANGED };

/** Whether a refusal body is `context_changed`, from `{code}` or `{detail: {code}}`. */
export function contextChangedIn(body: unknown): boolean {
  return refusalCodeIn(body) === CONTEXT_CHANGED;
}

/**
 * Call `onChanged` when any same-origin or API response is a 409
 * `context_changed`. Returns the function that removes the watcher.
 */
export function watchContextChanged(onChanged: () => void): () => void {
  return watchRefusals((code, status) => {
    if (status === 409 && code === CONTEXT_CHANGED) onChanged();
  });
}
