/**
 * One watcher on `fetch` for the API's 403 and 409 refusals that are about who the
 * user is rather than about one screen (DIAAT-373). Calls reach the API from many
 * places (the shared client, live-draft saves, downloads, uploads), so a watcher
 * here sees them all, and the providers decide what each refusal means for the
 * whole app instead of every caller having to remember to look.
 *
 * | code               | status | meaning                                                    |
 * |--------------------|--------|------------------------------------------------------------|
 * | `context_changed`  | 409    | another tab switched context: this tab is stale             |
 * | `context_required` | 403    | the session has no context (a role was removed): choose one |
 * | `user_deactivated` | 403    | the account was deactivated since sign-in                   |
 * | `dictation_disabled` | 403  | dictation was switched off: read the flag again             |
 */

export const CONTEXT_CHANGED = "context_changed";
export const CONTEXT_REQUIRED = "context_required";
export const USER_DEACTIVATED = "user_deactivated";
export const DICTATION_DISABLED = "dictation_disabled";

/** The refusal's machine-readable code, from `{code}` or `{detail: {code}}`. */
export function refusalCodeIn(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const top = (body as { code?: unknown }).code;
  if (typeof top === "string" && top) return top;
  const detail = (body as { detail?: unknown }).detail;
  if (detail && typeof detail === "object") {
    const nested = (detail as { code?: unknown }).code;
    if (typeof nested === "string" && nested) return nested;
  }
  return undefined;
}

export type RefusalListener = (code: string, status: number) => void;

const listeners = new Set<RefusalListener>();
let installed: { original: typeof fetch; watching: typeof fetch } | null = null;

function notify(status: number, body: unknown): void {
  const code = refusalCodeIn(body);
  if (code) for (const listener of [...listeners]) listener(code, status);
}

/**
 * Tell the listeners about a refusal that did not come through `fetch`: an upload sent with
 * `XMLHttpRequest` (for its progress events) is invisible to the fetch watcher, so its failure
 * handler passes the finished request here. Only 403 and 409 with a `detail.code` count, as above.
 */
export function reportXhrRefusal(xhr: XMLHttpRequest): void {
  if (xhr.status !== 403 && xhr.status !== 409) return;
  try {
    notify(xhr.status, JSON.parse(xhr.responseText));
  } catch {
    // Not JSON (a storage service's XML error, say), or not readable as text: nothing to say.
  }
}

/**
 * An `<audio>` element loads its source natively, so a refusal of that request (409 `context_changed`
 * after another tab switched, 403 `user_deactivated`) never passes through `fetch` and the watcher below
 * cannot see it: the element only says it failed. Ask again with `fetch` for the first byte, so
 * the refusal, if that is what it was, reaches the listeners. The answer is not used otherwise.
 */
export async function probeForRefusal(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const response = await window.fetch(url, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
    });
    // Not read: only the status and code matter, and the watcher has read a copy of a refusal.
    await response.body?.cancel().catch(() => undefined);
  } catch {
    // The network is down: nothing to learn.
  }
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  const original = window.fetch;
  const watching: typeof fetch = async (...args) => {
    const response = await original.apply(window, args);
    if (response.status === 403 || response.status === 409) {
      const status = response.status;
      response
        .clone()
        .json()
        .then((body) => notify(status, body))
        .catch(() => undefined);
    }
    return response;
  };
  window.fetch = watching;
  installed = { original, watching };
}

function uninstall(): void {
  if (!installed || listeners.size > 0) return;
  // Someone wrapped fetch after us: leave their wrapper in place.
  if (window.fetch === installed.watching) window.fetch = installed.original;
  installed = null;
}

/**
 * Call `listener(code, status)` for every 403 or 409 response that carries a
 * `detail.code`. Returns the function that removes the listener; fetch is put back
 * when the last one goes.
 */
export function watchRefusals(listener: RefusalListener): () => void {
  if (typeof window === "undefined") return () => undefined;
  listeners.add(listener);
  install();
  return () => {
    listeners.delete(listener);
    uninstall();
  };
}
