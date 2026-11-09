"use client";

import { Button } from "@/components/ui/button";

/** Previous / next for a paged list from the API: `page` counts from 1. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label="Pages"
      className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
    >
      <span>
        Page {page} of {pages} ({total} in all)
      </span>
      <span className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}

/** A native select styled like the app's inputs (labelled by its own <label>). */
export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
