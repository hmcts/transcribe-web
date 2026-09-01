"use client";

import { Eye, Pencil } from "lucide-react";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  rows = 10,
  placeholder,
  className,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const newValue = `${value.substring(0, start)}  ${value.substring(end)}`;
        onChange(newValue);
        requestAnimationFrame(() => {
          target.selectionStart = start + 2;
          target.selectionEnd = start + 2;
        });
      }
    },
    [value, onChange]
  );

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className
      )}
    >
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <button
          type="button"
          onClick={() => setMode("write")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
            mode === "write"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Pencil className="h-3 w-3" />
          Write
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
            mode === "preview"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Markdown supported
        </span>
      </div>

      {mode === "write" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={rows}
          placeholder={placeholder}
          className="w-full resize-y bg-transparent px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none"
        />
      ) : (
        <div
          className={cn(
            "prose prose-sm dark:prose-invert max-w-none overflow-y-auto px-3 py-2",
            "prose-p:my-1 prose-headings:my-2 prose-blockquote:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5"
          )}
          style={{ minHeight: `${(rows ?? 10) * 1.5}rem` }}
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-muted-foreground italic">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
