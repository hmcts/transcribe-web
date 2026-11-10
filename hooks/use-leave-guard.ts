"use client";

import { useEffect, useRef } from "react";

/**
 * Ask before leaving the page while ``active`` (work nothing would restore, such as a
 * template's answers or unsaved template fields, DIAAT-344):
 *
 * - a link in the app (Home, Help, Admin...): caught before Next's <Link> handles it;
 * - Back and Forward: a guard history entry, as providers/transcripts.tsx does for a
 *   live recording, so the first Back stays on the page and asks;
 * - with ``beforeUnload``, closing or reloading the tab (the browser's own prompt).
 *
 * Switching jurisdiction is guarded separately (useJurisdictionSwitchGuard).
 */
export function useLeaveGuard(
  active: boolean,
  message: string,
  { beforeUnload = false }: { beforeUnload?: boolean } = {}
): void {
  const historyGuard = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (!historyGuard.current) {
      window.history.pushState(null, "", window.location.href);
      historyGuard.current = true;
    }
    const onLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      if (
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      )
        return;
      const to = new URL(link.href, window.location.href);
      // Another site loads a new page: beforeunload asks, where it is used.
      if (to.origin !== window.location.origin) return;
      if (
        to.pathname === window.location.pathname &&
        to.search === window.location.search
      )
        return; // this page (e.g. the skip link)
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onPopState = () => {
      if (window.confirm(message)) {
        historyGuard.current = false;
        window.removeEventListener("popstate", onPopState);
        window.history.back(); // past the guard entry
      } else {
        window.history.pushState(null, "", window.location.href);
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onLinkClick, true);
    window.addEventListener("popstate", onPopState);
    if (beforeUnload) window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onLinkClick, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, message, beforeUnload]);
}
