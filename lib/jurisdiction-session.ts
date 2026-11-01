/**
 * The jurisdiction this tab works in (DIAAT-322).
 *
 * Kept in sessionStorage, which is per tab: each tab sends its own jurisdiction
 * in the `X-Jurisdiction` header, so switching in one tab cannot make another
 * tab save into a different jurisdiction. The API checks the user belongs to it.
 */

export const JURISDICTION_HEADER = "X-Jurisdiction";
/** The same, in the query of a URL the browser loads itself (an <audio> source),
 * which cannot carry a header. */
export const JURISDICTION_QUERY = "jurisdiction";
const STORAGE_KEY = "benchnotes-jurisdiction";

// Also kept in memory (this page load's), used once storage has failed: without
// it, requests would name no jurisdiction and the API would use the remembered
// choice, which a switch (here or in another tab) changes before its last save.
let inMemory: string | null = null;
let storageUsable = true;

export function getTabJurisdiction(): string | null {
  if (!storageUsable) return inMemory;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    storageUsable = false;
    return inMemory;
  }
}

export function setTabJurisdiction(code: string | null): void {
  inMemory = code;
  if (!storageUsable) return;
  try {
    if (code) window.sessionStorage.setItem(STORAGE_KEY, code);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not stored (blocked, or full while reads still work): memory from now on.
    storageUsable = false;
  }
}

/** The header naming this tab's jurisdiction, or none before it is known. */
export function jurisdictionHeaders(): Record<string, string> {
  const code = getTabJurisdiction();
  return code ? { [JURISDICTION_HEADER]: code } : {};
}
