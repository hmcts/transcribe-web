/**
 * Work that must finish before the tab switches context (DIAAT-332, DIAAT-373).
 *
 * Switching jurisdiction or role reloads the tab in the new context. A page
 * holding unsaved work (the record page's live draft) registers a handler that
 * saves it; if a handler throws, the switch does not happen, so nothing is lost.
 *
 * Once the API has accepted the switch, the session's context is the new one,
 * so a late request from this tab (still naming the old context in its headers)
 * is refused with 409 `context_changed` rather than landing in the new context.
 * The tab takes the new context when it reloads.
 */

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

/** Reload the tab at `path`, its work already saved. */
export function reloadAt(path: string): void {
  leaving = true;
  window.location.assign(path);
  window.setTimeout(stayInJurisdiction, 3000);
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

/** Stop any switch until `work` settles. Unlike a component's guard, this
 * outlives the component that started the request, which may unmount first. */
export async function holdJurisdictionSwitch<T>(work: Promise<T>): Promise<T> {
  const release = onBeforeJurisdictionSwitch(async () => {
    throw new JurisdictionSwitchError("busy");
  });
  try {
    return await work;
  } finally {
    release();
  }
}

/** Run every handler; rejects with the first failure. */
export async function prepareForJurisdictionSwitch(): Promise<void> {
  for (const handler of [...handlers]) {
    await handler();
  }
}
