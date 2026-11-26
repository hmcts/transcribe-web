"use client";

import {
  type CSSProperties,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/recording/utils";

interface HoverPopoverProps {
  /** The element that opens the popover — typically the visible label/text. */
  trigger: React.ReactNode;
  /** Popover body content. */
  children: React.ReactNode;
  /** Accessible name for the trigger button (announced by screen readers). */
  ariaLabel: string;
  triggerClassName?: string;
  panelClassName?: string;
}

const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
const MIN_PANEL_HEIGHT_PX = 160;
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbablesIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE));
}

/**
 * A lightweight info popover that opens on hover *or* click — plain React
 * state rather than a UI library, since it only needs to render a small
 * metadata card next to its trigger.
 *
 * Visibility is derived from two independent inputs — `hovering` (mouse over
 * the trigger/panel) and `pinned` (toggled by activating the trigger) — so
 * the two interaction modes compose instead of fighting: hovering shows it,
 * moving away hides it again *unless* it has been pinned open. The trigger is
 * a real <button>, so keyboard users Tab to it and press Enter/Space to
 * toggle the pin (and Escape to close), getting the same information as mouse
 * users without needing hover.
 */
export function HoverPopover({
  trigger,
  children,
  ariaLabel,
  triggerClassName,
  panelClassName,
}: HoverPopoverProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>();
  const panelId = useId();

  const open = hovering || pinned;

  // The panel is portalled out of the table: its overflow-x-auto wrapper
  // clips anything positioned inside it, horizontally and vertically.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP_PX;
    const spaceAbove = rect.top - GAP_PX;
    const below = spaceBelow >= MIN_PANEL_HEIGHT_PX || spaceBelow >= spaceAbove;
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(
        rect.left,
        window.innerWidth - panel.offsetWidth - VIEWPORT_MARGIN_PX
      )
    );
    setPanelStyle({
      position: "fixed",
      left,
      ...(below
        ? { top: rect.bottom + GAP_PX }
        : { bottom: window.innerHeight - rect.top + GAP_PX }),
      maxHeight: Math.max(
        (below ? spaceBelow : spaceAbove) - VIEWPORT_MARGIN_PX,
        0
      ),
    });
  }, []);

  const close = () => {
    setPinned(false);
    setHovering(false);
  };

  // The panel sits at the end of the body, out of the tab order around its
  // trigger, so keyboard focus is carried into and back out of it by hand.
  const focusAfterTrigger = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const order = tabbablesIn(document).filter(
      (el) => !panelRef.current?.contains(el)
    );
    order[order.indexOf(trigger) + 1]?.focus();
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const items = panelRef.current ? tabbablesIn(panelRef.current) : [];
    if (e.key === "Escape") {
      close();
      triggerRef.current?.focus();
    } else if (e.key === "Tab" && e.shiftKey && e.target === items[0]) {
      e.preventDefault();
      triggerRef.current?.focus();
    } else if (e.key === "Tab" && !e.shiftKey && e.target === items.at(-1)) {
      e.preventDefault();
      close();
      focusAfterTrigger();
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex min-w-0"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "min-w-0 truncate text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
          triggerClassName
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={(e) => {
          // Stops row-level onClick handlers (e.g. navigating to the
          // transcript) from firing when the user is just checking metadata.
          e.stopPropagation();
          setPinned((wasPinned) => !wasPinned);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            close();
          } else if (e.key === "Tab" && !e.shiftKey && open) {
            const first = panelRef.current && tabbablesIn(panelRef.current)[0];
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (
            !containerRef.current?.contains(next) &&
            !panelRef.current?.contains(next)
          ) {
            setPinned(false);
          }
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            // Reuse the trigger's descriptive name so screen readers announce
            // what the dialog is about (e.g. "Transcription run details for …").
            aria-label={ariaLabel}
            className={cn(
              "z-50 w-64 overflow-y-auto rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md",
              panelClassName
            )}
            // Hidden until placed, so it never flashes at the page's corner.
            style={panelStyle ?? { position: "fixed", visibility: "hidden" }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            onKeyDown={onPanelKeyDown}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (
                !containerRef.current?.contains(next) &&
                !panelRef.current?.contains(next)
              ) {
                close();
              }
            }}
            // React bubbles portal events through the component tree, so a
            // click in the panel would otherwise still reach the row.
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
