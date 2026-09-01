/* eslint-disable no-nested-ternary */
import { Edit, FileText, Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import DownloadStyleCopyButton from "@/components/ui/copy-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MinuteVersion } from "@/lib/database";
import type { TemplateMetadata } from "@/src/api/generated";
import RatingDialog from "./rating-dialog";

interface MinutesEditorHeaderProps {
  selectedTemplate: TemplateMetadata | null;
  onTemplateChange: (name: string) => void;
  isGenerating: boolean;
  templatesLoading: boolean;
  templatesError: any;
  templates: TemplateMetadata[];
  currentVersion: MinuteVersion | null | undefined;
  isEditing: boolean;
  onEditClick: () => void;
  onSaveEdit: () => void;
  generateAIMinutes: (template: TemplateMetadata) => void;
  onCopy: () => void;
  rating: number | null;
  ratingComment: string | null;
  onRatingSubmit: (rating: number, comment: string | null) => void;
  isRatingDialogOpen: boolean;
  setIsRatingDialogOpen: (open: boolean) => void;
  onAIEdit: (instructions: string) => void;
  hasTranscriptionErrors: boolean;
}

export default function MinutesEditorHeader({
  selectedTemplate,
  onTemplateChange,
  isGenerating,
  templatesLoading,
  templatesError,
  templates,
  currentVersion,
  isEditing,
  onEditClick,
  onSaveEdit,
  generateAIMinutes,
  onCopy,
  rating,
  ratingComment,
  onRatingSubmit,
  isRatingDialogOpen,
  setIsRatingDialogOpen,
  onAIEdit,
  hasTranscriptionErrors,
}: MinutesEditorHeaderProps) {
  const [isAIEditInlineOpen, setIsAIEditInlineOpen] = useState(false);
  const [aiEditInstructions, setAIEditInstructions] = useState("");

  const handleSubmitAIEdit = () => {
    if (aiEditInstructions.trim()) {
      onAIEdit(aiEditInstructions);
      setIsAIEditInlineOpen(false);
      setAIEditInstructions("");
    }
  };

  const handleQuickSuggestionClick = (prompt: string) => {
    setAIEditInstructions(prompt);
  };

  const quickSuggestions = [
    {
      label: "Make more concise",
      prompt:
        "Update the summary to make it more concise and focused. Remove any repetition.",
    },
    {
      label: "Rewrite as an email",
      prompt: "Rewrite as email",
    },
    {
      label: "Add names and age",
      prompt:
        "Update the summary to include the names and ages of any people mentioned during the meeting especially children or dependents",
    },
    {
      label: "Change names",
      prompt:
        "Change the name of 'A' to 'B' and their gender is male or female",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative flex flex-col space-y-4 md:flex-row md:items-center md:space-x-4 md:space-y-0">
        <div className="relative z-10 md:w-[200px]">
          <Select
            value={selectedTemplate?.name}
            onValueChange={onTemplateChange}
            disabled={isGenerating || templatesLoading}
          >
            <SelectTrigger className="h-12 w-full justify-between px-4 text-left font-normal">
              <div className="flex items-center gap-2">
                <FileText className="size-4" />
                {templatesLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading...
                  </span>
                ) : selectedTemplate ? (
                  <span className="truncate">{selectedTemplate.name}</span>
                ) : (
                  <span>Select a template</span>
                )}
              </div>
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {templatesLoading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  <span>Loading templates...</span>
                </div>
              ) : templatesError ? (
                <div className="p-4 text-red-500 dark:text-red-400">
                  Error loading templates
                </div>
              ) : templates.length === 0 ? (
                <div className="p-4 text-neutral-500 dark:text-neutral-400">
                  No templates available
                </div>
              ) : (
                templates.map((template) => (
                  <SelectItem
                    key={template.name}
                    value={template.name}
                    className="py-2"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{template.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="relative z-10 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:w-auto md:gap-4">
          {isGenerating ? (
            <Button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-red-100 dark:bg-red-900/30 px-4 text-red-700 dark:text-red-400 shadow-sm hover:bg-red-200 dark:hover:bg-red-900/50">
              <Loader2 className="size-4 animate-spin" />
              <span>Generating...</span>
            </Button>
          ) : !currentVersion && selectedTemplate && !hasTranscriptionErrors ? (
            <Button
              onClick={() => generateAIMinutes(selectedTemplate)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#0F612D] dark:bg-[#0A4A22] px-4 text-white shadow-sm hover:bg-[#0A4A22] dark:hover:bg-[#083618]"
            >
              <Wand2 className="mr-2 size-4" />
              <span>Generate Summary</span>
            </Button>
          ) : (
            <>
              {isEditing ? (
                <Button
                  onClick={onSaveEdit}
                  className="flex h-12 w-full items-center justify-center rounded-md bg-blue-600 dark:bg-blue-700 px-4 text-white shadow-sm hover:bg-blue-700 dark:hover:bg-blue-800"
                >
                  <Save className="size-5 md:mr-2" />
                  <span className="hidden md:inline">Save</span>
                  <span className="md:hidden">💾</span>
                </Button>
              ) : (
                <Button
                  onClick={onEditClick}
                  className="flex h-12 w-full items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-700 px-4 text-white shadow-sm hover:bg-neutral-800 dark:hover:bg-neutral-600"
                  disabled={isGenerating || !currentVersion}
                >
                  <Edit className="size-5 md:mr-2" />
                  <span className="hidden md:inline">Manual Edit</span>
                </Button>
              )}

              {currentVersion && (
                <>
                  <Button
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-700 px-4 text-white shadow-sm hover:bg-neutral-800 dark:hover:bg-neutral-600"
                    disabled={isGenerating}
                    onClick={() => {
                      if (isEditing) {
                        onSaveEdit();
                      }
                      setIsAIEditInlineOpen(!isAIEditInlineOpen);
                    }}
                  >
                    <Sparkles className="mr-2 size-4" />
                    <span className="hidden md:inline">AI Edit</span>
                  </Button>

                  <DownloadStyleCopyButton
                    textToCopy={currentVersion.html_content}
                    posthogEventName="minutes_copied"
                    onCopy={onCopy}
                  />
                </>
              )}
            </>
          )}
        </div>

        <div className="static z-0 mt-2 flex w-full justify-end md:absolute md:right-4 md:top-1/2 md:mt-0 md:-translate-y-1/2">
          <RatingDialog
            rating={rating}
            comment={ratingComment}
            onSubmit={onRatingSubmit}
            isOpen={isRatingDialogOpen}
            onOpenChange={setIsRatingDialogOpen}
          />
        </div>
      </div>

      {isAIEditInlineOpen && currentVersion && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm">
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                What would you like to change?
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Tell AI exactly what to change in your summary
              </p>
            </div>

            <div className="space-y-4">
              <Textarea
                placeholder="Describe the changes you want to make"
                value={aiEditInstructions}
                onChange={(e) => setAIEditInstructions(e.target.value)}
                className="min-h-[80px] resize-none"
                aria-label="Describe the changes you want to make to the meeting summary"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSubmitAIEdit();
                  }
                }}
              />

              <div className="space-y-3">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Quick suggestions:
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickSuggestions.map((suggestion) => (
                    <Button
                      key={suggestion.label}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleQuickSuggestionClick(suggestion.prompt)
                      }
                      className="text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 border-neutral-200 dark:border-neutral-800"
                    >
                      + {suggestion.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAIEditInlineOpen(false);
                    setAIEditInstructions("");
                  }}
                  className="hover:bg-neutral-100 dark:hover:bg-neutral-800 border-neutral-200 dark:border-neutral-800"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitAIEdit}
                  disabled={!aiEditInstructions.trim()}
                  className="bg-blue-600 dark:bg-blue-700 text-white hover:bg-blue-700 dark:hover:bg-blue-800"
                >
                  <Sparkles className="mr-2 size-4" />
                  Update
                </Button>
              </div>

              <div className="text-center">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Press{" "}
                  <kbd className="rounded bg-neutral-800 dark:bg-neutral-700 px-1 py-0.5 text-xs text-white dark:text-neutral-200">
                    ⌘
                  </kbd>{" "}
                  +{" "}
                  <kbd className="rounded bg-neutral-800 dark:bg-neutral-700 px-1 py-0.5 text-xs text-white dark:text-neutral-200">
                    Enter
                  </kbd>{" "}
                  to update
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
