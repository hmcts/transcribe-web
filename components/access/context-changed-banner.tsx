"use client";

import { Button } from "@/components/ui/button";

/**
 * Another tab changed the context (or a role was removed) since this tab
 * loaded, so the API refused one of its calls with 409 `context_changed`
 * (DIAAT-373). This tab's page state belongs to the old context and must not
 * save into the new one: it asks to reload rather than reloading by itself,
 * which could throw away what the user is typing or dictating.
 */
export function ContextChangedBanner() {
  // The tab keeps its old context until the document really reloads: the recorder's
  // "leave this page?" prompt can be cancelled, and a tab that has dropped its context
  // headers would then save into whatever context the other tab chose. The reloaded
  // page adopts the session's context (AccessProvider.load clears it on startup).
  const reload = () => window.location.reload();
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-border bg-background p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Where or as what you work was changed in another tab, so this tab is
          out of date and its changes are not being saved. Reload to continue in
          the new one.
        </p>
        <Button onClick={reload}>Reload this tab</Button>
      </div>
    </div>
  );
}
