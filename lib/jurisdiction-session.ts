/**
 * The jurisdiction this tab works in (DIAAT-322).
 *
 * Kept in sessionStorage, which is per tab: each tab sends its own jurisdiction
 * in the `X-Jurisdiction` header, so switching in one tab cannot make another
 * tab save into a different jurisdiction. The API checks the user belongs to it.
 */

export const JURISDICTION_HEADER = "X-Jurisdiction";
const STORAGE_KEY = "benchnotes-jurisdiction";

export function getTabJurisdiction(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setTabJurisdiction(code: string | null): void {
  try {
    if (code) window.sessionStorage.setItem(STORAGE_KEY, code);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: requests fall back to the user's remembered choice.
  }
}

/** The header naming this tab's jurisdiction, or none before it is known. */
export function jurisdictionHeaders(): Record<string, string> {
  const code = getTabJurisdiction();
  return code ? { [JURISDICTION_HEADER]: code } : {};
}
