/**
 * Work that must finish before the tab switches jurisdiction (DIAAT-332).
 *
 * Switching reloads the tab in the other jurisdiction. A page holding unsaved
 * work (the record page's live draft) registers a handler that saves it; if a
 * handler throws, the switch does not happen, so nothing is lost.
 *
 * The tab takes the new jurisdiction only once it has reloaded (from the
 * `?switched-jurisdiction=` it reloads with): until then its requests name the old
 * one, so a late save cannot land in the new jurisdiction, and a reload the
 * browser does not complete leaves the tab as it was.
 */

/** The query parameter a switch reloads the tab with. Accepted only with the
 * one-time marker the switch leaves in this tab, so a link cannot move a tab. */
export const SWITCH_PARAM = "switched-jurisdiction";
const SWITCH_MARKER_KEY = "benchnotes-switching-to";

/** Which step a switch stopped at: saving the tab's work, the switch itself, the
 * tab being busy (a submission, upload or save in progress), work on it that is
 * never saved (notes) and would be lost, or changes not yet saved (a form). */
export class JurisdictionSwitchError extends Error {
  constructor(
    readonly step: "save" | "switch" | "busy" | "unsaved" | "unsaved_changes",
    options?: { cause?: unknown }
  ) {
    super(`Jurisdiction switch stopped at: ${step}`, options);
  }
}

let leaving = false;

/** The tab's work is saved and it is reloading for a switch: a page need not
 * ask the user to confirm leaving. */
export function isLeavingForJurisdictionSwitch(): boolean {
  return leaving;
}

/** The tab did not leave after all (the browser did not complete the reload). */
export function stayInJurisdiction(): void {
  leaving = false;
}

/** Reload the tab in `code`, its work already saved. */
export function reloadInJurisdiction(code: string): void {
  leaving = true;
  try {
    window.sessionStorage.setItem(SWITCH_MARKER_KEY, code);
  } catch {
    // Storage blocked: the reloaded tab uses the remembered choice, which is `code`.
  }
  window.location.assign(`/?${SWITCH_PARAM}=${encodeURIComponent(code)}`);
  window.setTimeout(stayInJurisdiction, 3000);
}

/** On load: the jurisdiction a switch reloaded this tab with, taken off the URL.
 * Null unless this tab's own switch left the matching marker. */
export function takeSwitchedJurisdiction(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(SWITCH_PARAM);
  if (code === null) return null;
  url.searchParams.delete(SWITCH_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  let marker: string | null = null;
  try {
    marker = window.sessionStorage.getItem(SWITCH_MARKER_KEY);
    window.sessionStorage.removeItem(SWITCH_MARKER_KEY);
  } catch {
    return null;
  }
  return marker === code ? code : null;
}

type BeforeSwitch = () => Promise<void>;

const handlers = new Set<BeforeSwitch>();

/** Register `handler` until the returned function is called (an effect's cleanup). */
export function onBeforeJurisdictionSwitch(handler: BeforeSwitch): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Run every handler; rejects with the first failure. */
export async function prepareForJurisdictionSwitch(): Promise<void> {
  for (const handler of [...handlers]) {
    await handler();
  }
}
