import type { SessionContext } from "@/lib/access/types";

/**
 * The context (jurisdiction and role) this tab works in (DIAAT-322, DIAAT-373).
 *
 * The user's choice is remembered for the whole session, on the server. Each
 * tab also remembers, in sessionStorage (per tab), the context its page state
 * was loaded for and names it in `X-Jurisdiction` and `X-Role` on every call.
 * The API compares them with the session's: if another tab switched, it answers
 * 409 `context_changed` and this tab must reload, so a tab cannot save into a
 * jurisdiction or role it did not mean to.
 */

export const JURISDICTION_HEADER = "X-Jurisdiction";
export const ROLE_HEADER = "X-Role";
/** The same, in the query of a URL the browser loads itself (an <audio> source),
 * which cannot carry a header. */
export const JURISDICTION_QUERY = "jurisdiction";
export const ROLE_QUERY = "role";
/** What `X-Jurisdiction` carries for a global role (no jurisdiction). */
export const NO_JURISDICTION = "-";
const STORAGE_KEY = "benchnotes-context";

// Also kept in memory (this page load's), used once storage has failed: without
// it, requests would name no context and the API could not tell a stale tab.
let inMemory: SessionContext | null = null;
let storageUsable = true;

function parse(raw: string | null): SessionContext | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionContext>;
    if (typeof value.role !== "string" || !value.role) return null;
    if (value.jurisdiction !== null && typeof value.jurisdiction !== "string") {
      return null;
    }
    return { jurisdiction: value.jurisdiction ?? null, role: value.role };
  } catch {
    return null;
  }
}

export function getTabContext(): SessionContext | null {
  if (!storageUsable) return inMemory;
  try {
    return parse(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    storageUsable = false;
    return inMemory;
  }
}

export function setTabContext(context: SessionContext | null): void {
  inMemory = context;
  if (!storageUsable) return;
  try {
    if (context) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Not stored (blocked, or full while reads still work): memory from now on.
    storageUsable = false;
  }
}

/** The jurisdiction this tab works in, or null (none, a global role, or not yet known). */
export function getTabJurisdiction(): string | null {
  return getTabContext()?.jurisdiction ?? null;
}

/** The headers naming this tab's context, or none before it is known. */
export function jurisdictionHeaders(): Record<string, string> {
  const context = getTabContext();
  if (!context) return {};
  return {
    [JURISDICTION_HEADER]: context.jurisdiction ?? NO_JURISDICTION,
    [ROLE_HEADER]: context.role,
  };
}
