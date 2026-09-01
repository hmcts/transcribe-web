"use client";

import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import classNames from "classnames";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { concatenateDialogueEntriesInTranscriptionJobs } from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import CitationPopoverContent from "./citation-popover";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  ListOrdered as OrderedListIcon,
  RotateLeft,
  RotateRight,
  List as UnorderedListIcon,
} from "./Icons";

function SimpleEditor({
  initialContent,
  onContentChange,
  isEditing,
  onCitationClick,
  onEditorClick,
  toolbarRightContent,
  editorId,
  editorAriaLabel,
  toolbarAriaLabel = "Text formatting toolbar",
}: {
  initialContent: string;
  onContentChange: (newContent: string) => void;
  isEditing: boolean;
  onCitationClick: (index: number) => void;
  onEditorClick?: () => void;
  toolbarRightContent?: ReactNode;
  editorId?: string;
  editorAriaLabel?: string;
  toolbarAriaLabel?: string;
}) {
  const [citationPopover, setCitationPopover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const { currentTranscription, transcriptionJobs } = useTranscripts();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const handleCitationClick = (index: number, rect: DOMRect) => {
    setCitationPopover({
      index,
      x: rect.left,
      y: rect.bottom,
    });
    setIsPopoverOpen(true);
    onCitationClick(index);
  };

  const CitationExtension = Extension.create({
    name: "citation",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("citation"),
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              const citationRegex = /\[(\d+)\]/g;

              state.doc.descendants((node, pos) => {
                if (node.isText) {
                  let match;
                  // eslint-disable-next-line no-cond-assign
                  while (
                    (match = citationRegex.exec(node.text ?? "")) !== null
                  ) {
                    const from = pos + match.index;
                    const to = from + match[0].length;
                    decorations.push(
                      Decoration.inline(from, to, {
                        class: "citation-link",
                        style:
                          "color: blue; cursor: pointer; text-decoration: underline;",
                      })
                    );
                  }
                }
              });

              return DecorationSet.create(state.doc, decorations);
            },
            handleDOMEvents: {
              click: (view, event) => {
                const pos = view.posAtDOM(event.target as Node, 0);
                if (pos === null) return false;

                const domNode = event.target as HTMLElement;

                if (domNode.classList.contains("citation-link")) {
                  const match = domNode.textContent?.match(/\[(\d+)\]/);
                  if (match) {
                    const index = Number.parseInt(match[1], 10);
                    const rect = domNode.getBoundingClientRect();
                    handleCitationClick(index, rect);
                    return true;
                  }
                }
                return false;
              },
            },
          },
        }),
      ];
    },
  });

  const editorObject = useEditor({
    extensions: [
      StarterKit,
      Document,
      Paragraph,
      Text,
      CitationExtension,
      HardBreak,
    ],
    editable: isEditing,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(editorId ? { id: editorId } : {}),
        ...(editorAriaLabel ? { "aria-label": editorAriaLabel } : {}),
        ...(isEditing
          ? {
              role: "textbox",
              "aria-multiline": "true",
              tabindex: "0",
            }
          : {}),
      },
    },
    onUpdate: ({ editor }) => {
      onContentChange(editor.getHTML());
    },
  }) as Editor;

  const toolbarButtonClass =
    "rounded-md p-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800";
  const toolbarToggleButtonClass =
    "rounded-md p-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:text-neutral-300 dark:hover:bg-neutral-800";
  const toolbarHeadingButtonClass =
    "rounded-md px-2.5 py-1.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:text-neutral-300 dark:hover:bg-neutral-800";

  useEffect(() => {
    if (editorObject && initialContent !== editorObject.getHTML()) {
      editorObject.commands.setContent(initialContent);
    }
  }, [editorObject, initialContent]);

  const handleToolbarMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleUndo = useCallback(() => {
    editorObject.chain().undo().run();
  }, [editorObject]);

  const handleRedo = useCallback(() => {
    editorObject.chain().redo().run();
  }, [editorObject]);

  const toggleBold = useCallback(() => {
    editorObject.chain().toggleBold().run();
  }, [editorObject]);

  const toggleItalic = useCallback(() => {
    editorObject.chain().toggleItalic().run();
  }, [editorObject]);

  const toggleBulletList = useCallback(() => {
    editorObject.chain().toggleBulletList().run();
  }, [editorObject]);

  const toggleOrderedList = useCallback(() => {
    editorObject.chain().toggleOrderedList().run();
  }, [editorObject]);

  const toggleHeading = useCallback(() => {
    editorObject.chain().toggleHeading({ level: 3 }).run();
  }, [editorObject]);

  if (!editorObject) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative h-full min-h-0">
        <div className="relative flex h-full min-h-0 flex-col">
          {isEditing && (
            <div
              role="toolbar"
              aria-controls={editorId}
              aria-label={toolbarAriaLabel}
              className="flex flex-wrap items-center gap-2 bg-white pb-2 dark:bg-neutral-950"
            >
              {/* History Group */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={toolbarButtonClass}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={handleUndo}
                      disabled={!editorObject.can().undo()}
                      type="button"
                      aria-label="Undo"
                    >
                      <RotateLeft size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Undo</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={toolbarButtonClass}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={handleRedo}
                      disabled={!editorObject.can().redo()}
                      type="button"
                      aria-label="Redo"
                    >
                      <RotateRight size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Redo</TooltipContent>
                </Tooltip>
              </div>

              <div
                className="h-4 w-px bg-neutral-200 dark:bg-neutral-700"
                aria-hidden="true"
              />

              {/* Text Formatting Group */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={classNames(toolbarToggleButtonClass, {
                        "bg-neutral-100 text-primary ring-2 ring-inset ring-primary/60 dark:bg-neutral-800 dark:text-primary dark:ring-primary/50":
                          editorObject.isActive("bold"),
                      })}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={toggleBold}
                      type="button"
                      aria-label="Bold"
                      aria-pressed={editorObject.isActive("bold")}
                    >
                      <BoldIcon size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Bold</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={classNames(toolbarToggleButtonClass, {
                        "bg-neutral-100 text-primary ring-2 ring-inset ring-primary/60 dark:bg-neutral-800 dark:text-primary dark:ring-primary/50":
                          editorObject.isActive("italic"),
                      })}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={toggleItalic}
                      type="button"
                      aria-label="Italic"
                      aria-pressed={editorObject.isActive("italic")}
                    >
                      <ItalicIcon size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Italic</TooltipContent>
                </Tooltip>
              </div>

              <div
                className="h-4 w-px bg-neutral-200 dark:bg-neutral-700"
                aria-hidden="true"
              />

              {/* List Formatting Group */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={classNames(toolbarToggleButtonClass, {
                        "bg-neutral-100 text-primary ring-2 ring-inset ring-primary/60 dark:bg-neutral-800 dark:text-primary dark:ring-primary/50":
                          editorObject.isActive("bulletList"),
                      })}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={toggleBulletList}
                      type="button"
                      aria-label="Bullet List"
                      aria-pressed={editorObject.isActive("bulletList")}
                    >
                      <UnorderedListIcon size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Bullet List</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={classNames(toolbarToggleButtonClass, {
                        "bg-neutral-100 text-primary ring-2 ring-inset ring-primary/60 dark:bg-neutral-800 dark:text-primary dark:ring-primary/50":
                          editorObject.isActive("orderedList"),
                      })}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={toggleOrderedList}
                      type="button"
                      aria-label="Numbered List"
                      aria-pressed={editorObject.isActive("orderedList")}
                    >
                      <OrderedListIcon size={20} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Numbered List</TooltipContent>
                </Tooltip>
              </div>

              <div
                className="h-4 w-px bg-neutral-200 dark:bg-neutral-700"
                aria-hidden="true"
              />

              {/* Heading */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={classNames(toolbarHeadingButtonClass, {
                        "bg-neutral-100 text-primary ring-2 ring-inset ring-primary/60 dark:bg-neutral-800 dark:text-primary dark:ring-primary/50":
                          editorObject.isActive("heading", { level: 3 }),
                      })}
                      onMouseDown={handleToolbarMouseDown}
                      onClick={toggleHeading}
                      type="button"
                      aria-label="Heading"
                      aria-pressed={editorObject.isActive("heading", {
                        level: 3,
                      })}
                    >
                      Heading
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Add Heading</TooltipContent>
                </Tooltip>
              </div>

              {toolbarRightContent && (
                <div className="ml-auto">{toolbarRightContent}</div>
              )}
            </div>
          )}

          {isEditing && <Separator />}

          <EditorContent
            editor={editorObject}
            className={classNames(
              "editor-content min-h-0 flex-1 overflow-y-auto cursor-text [&_ul]:pt-2 [&_ol]:pt-2"
            )}
            onClick={() => {
              editorObject.chain().focus().run();
              onEditorClick?.();
            }}
          />

          {citationPopover && (
            <Popover
              open={isPopoverOpen}
              onOpenChange={(open) => {
                setIsPopoverOpen(open);
                if (!open) setCitationPopover(null);
              }}
            >
              <PopoverTrigger asChild>
                <div
                  style={{
                    position: "fixed",
                    left: citationPopover.x,
                    top: citationPopover.y,
                    width: 1,
                    height: 1,
                  }}
                />
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] max-w-[600px]">
                {currentTranscription && (
                  <CitationPopoverContent
                    dialogueEntries={concatenateDialogueEntriesInTranscriptionJobs(
                      transcriptionJobs
                    )}
                    selectedIndex={citationPopover.index}
                  />
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

SimpleEditor.defaultProps = {
  onEditorClick: undefined,
};

export default SimpleEditor;
