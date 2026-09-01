"use client";

import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import classNames from "classnames";
import { useCallback, useEffect } from "react";
import { Markdown } from "tiptap-markdown";

import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RotateLeft, RotateRight } from "./Icons";

interface AdminEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}

type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
  };
};

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as MarkdownStorage;
  return storage.markdown?.getMarkdown?.() ?? editor.getText();
}

export function AdminEditor({ value, onChange, className }: AdminEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      // html: true is required so tiptap-markdown can serialise the Underline
      // mark as <u>…</u>. Without it, getMarkdown() throws for any document
      // containing underline, which silently breaks onUpdate and freezes
      // form.content, causing all subsequent saves to send stale content.
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(getMarkdown(editor));
    },
  });

  useEffect(() => {
    if (editor) {
      const current = getMarkdown(editor);
      if (value !== current) {
        editor.commands.setContent(value);
      }
    }
  }, [editor, value]);

  const toggleHeading = useCallback(
    (level: 1 | 2 | 3) => {
      editor?.chain().focus().toggleHeading({ level }).run();
    },
    [editor]
  );

  const toggleBlockquote = useCallback(() => {
    editor?.chain().focus().toggleBlockquote().run();
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  const toggleCitation = useCallback(() => {
    editor?.chain().focus().toggleUnderline().run();
  }, [editor]);

  if (!editor) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={classNames("relative min-h-0", className)}>
        <div className="sticky top-0 z-10 bg-background">
        <div
          role="toolbar"
          aria-label="Text formatting toolbar"
          className="flex flex-wrap items-center gap-2 pb-2"
        >
          <div className="flex items-center gap-1">
            <ToolbarButton
              label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            >
              <RotateLeft size={20} />
            </ToolbarButton>
            <ToolbarButton
              label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            >
              <RotateRight size={20} />
            </ToolbarButton>
          </div>

          <ToolbarSeparator />

          <div className="flex items-center gap-1">
            <ToolbarButton
              label="Heading 1 (Bold)"
              onClick={() => toggleHeading(1)}
              active={editor.isActive("heading", { level: 1 })}
            >
              <span className="px-2.5 py-1 text-sm font-bold">Heading 1</span>
            </ToolbarButton>
            <ToolbarButton
              label="Heading 2 (Underline)"
              onClick={() => toggleHeading(2)}
              active={editor.isActive("heading", { level: 2 })}
            >
              <span className="px-2.5 py-1 text-sm font-semibold underline">
                Heading 2
              </span>
            </ToolbarButton>
            <ToolbarButton
              label="Heading 3 (Italics)"
              onClick={() => toggleHeading(3)}
              active={editor.isActive("heading", { level: 3 })}
            >
              <span className="px-2.5 py-1 text-sm font-semibold italic">
                Heading 3
              </span>
            </ToolbarButton>
          </div>

          <ToolbarSeparator />

          <div className="flex items-center gap-1">
            <ToolbarButton
              label="Ordered list (a, i)"
              onClick={toggleOrderedList}
              active={editor.isActive("orderedList")}
            >
              <span className="px-2.5 py-1 text-sm font-medium">
                Ordered list (a/i)
              </span>
            </ToolbarButton>
            <ToolbarButton
              label="Citation (underline)"
              onClick={toggleCitation}
              active={editor.isActive("underline")}
            >
              <span className="px-2.5 py-1 text-sm font-medium underline">
                Citation
              </span>
            </ToolbarButton>
            <ToolbarButton
              label="Quotation (Block quote)"
              onClick={toggleBlockquote}
              active={editor.isActive("blockquote")}
            >
              <span className="px-2.5 py-1 text-sm font-medium leading-none">
                Quotation
              </span>
            </ToolbarButton>
          </div>
        </div>

        <Separator />
        </div>

        <EditorContent
          editor={editor}
          className="editor-content min-h-[12rem] flex-1 overflow-y-auto cursor-text [&_ul]:pt-2 [&_ol]:pt-2"
          onClick={() => editor.chain().focus().run()}
        />
      </div>
    </TooltipProvider>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={classNames(
            "rounded-md p-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40",
            active && "bg-accent text-accent-foreground ring-2 ring-inset ring-primary/60"
          )}
          onClick={onClick}
          disabled={disabled}
          type="button"
          aria-label={label}
          aria-pressed={!!active}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <div className="h-4 w-px bg-border" aria-hidden="true" />;
}
