"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { useToc } from "@/hooks/use-toc";
import cn from "@/lib/utils";

interface TableOfContentsProps {
  contentId: string;
  variant?: "default" | "inline";
}

export function TableOfContents({
  contentId,
  variant = "default",
}: TableOfContentsProps) {
  const { headings, activeId } = useToc({
    contentId,
    targetSelectors: "h2, h3",
  });

  if (headings.length === 0) return null;
  const isInline = variant === "inline";

  return (
    <nav
      aria-label="Table of contents"
      className={cn(
        "flex flex-col gap-6",
        isInline && "rounded-lg border border-border bg-muted/20 p-4"
      )}
    >
      <div>
        <h2 className="mb-3 !text-sm font-semibold text-foreground">
          On this page
        </h2>
        <ul className={cn("text-base", isInline ? "space-y-2" : "space-y-1")}>
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className={cn(
                  "block py-1 leading-snug transition-colors hover:text-foreground",
                  heading.level === 3 && (isInline ? "pl-2" : "pl-3"),
                  activeId === heading.id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {!isInline && (
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors no-underline hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      )}
    </nav>
  );
}
