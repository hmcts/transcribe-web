/* eslint-disable no-plusplus */
/* eslint-disable no-promise-executor-return */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-nested-ternary */
import { FileText, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import useTemplates from "@/hooks/use-templates";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api-client";
import {
  getMinuteVersions,
  type MinuteVersion,
  saveMinuteVersion,
} from "@/lib/database";
import {
  findExistingMinuteVersionForTemplate,
  pollMinuteVersion,
  submitLangfuseScore,
} from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import type { TemplateMetadata } from "@/src/api/generated";
import SimpleEditor from "../editor/tiptap-editor";
import MinutesEditorHeader from "./minutes-editor-header";

interface MinutesEditorProps {
  onCitationClick: (index: number) => void;
}

function MinutesEditor({ onCitationClick }: MinutesEditorProps) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [currentVersion, setCurrentVersion] = useState<
    MinuteVersion | undefined
  >();
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateMetadata | null>(null);
  const [isRatingDialogOpen, setIsRatingDialogOpen] = useState(false);

  const { currentTranscription, transcriptionJobs } = useTranscripts();
  const {
    templates,
    isLoading: templatesLoading,
    error: templatesError,
  } = useTemplates();

  // Check if transcription has errors (failed processing)
  const hasTranscriptionErrors = transcriptionJobs.some(
    (job) => job.error_message !== null && job.error_message !== undefined
  );

  const handleSaveEdit = useCallback(async () => {
    if (!currentVersion?.id || !currentTranscription?.id) return;

    setIsEditing(false);

    try {
      const savedVersion = await saveMinuteVersion(currentTranscription.id, {
        ...currentVersion,
      });

      setCurrentVersion(savedVersion);

      track("minutes_manual_edit_saved", {
        version_id: currentVersion?.id,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? `Failed to save changes: ${error.message}`
          : "Failed to save changes. Please try again.";
      console.error(errorMessage);
      throw error;
    }
  }, [currentVersion, currentTranscription?.id]);

  const logMinuteGenerationError = useCallback((errorMessage: string) => {
    if (
      errorMessage.includes("No transcription jobs found") ||
      errorMessage.includes("No dialogue entries found") ||
      errorMessage.includes("Transcription has errors")
    ) {
      console.error(
        "Cannot generate minutes: Transcription failed or has no content"
      );
    } else {
      console.error(errorMessage);
    }
  }, []);

  const generateAIMinutes = useCallback(
    async (template: TemplateMetadata) => {
      if (!currentTranscription?.id) {
        throw new Error("No active transcription");
      }
      setIsGenerating(true);
      const startedAt = Date.now();
      try {
        track("generate_ai_minutes_started", {
          style: template.name,
        });

        const result = await apiClient.generateOrEditMinutes({
          transcription_id: currentTranscription.id,
          template,
          action_type: "generate",
        });
        if (result.error) {
          throw new Error(result.error);
        }

        const minute_version_id = result.data?.minute_version_id;
        if (!minute_version_id) {
          throw new Error("No minute_version_id returned from API");
        }

        const minuteVersion = await pollMinuteVersion(
          currentTranscription.id,
          minute_version_id
        );

        setCurrentVersion(minuteVersion);
        track("generate_ai_minutes_completed", {
          style: template.name,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to generate AI minutes. Please try again.";

        track("generate_ai_minutes_failed", {
          style: template.name,
          duration_ms: Date.now() - startedAt,
          error_type: error instanceof Error ? error.name : "unknown_error",
        });
        logMinuteGenerationError(errorMessage);
        throw error;
      } finally {
        setIsGenerating(false);
      }
    },
    [currentTranscription?.id, logMinuteGenerationError]
  );

  const handleAIEdit = useCallback(
    async (editInstructions: string) => {
      if (
        !currentVersion?.id ||
        !currentTranscription?.id ||
        !selectedTemplate
      ) {
        return;
      }
      handleSaveEdit();

      setIsGenerating(true);
      const startedAt = Date.now();
      try {
        track("ai_edit_started", {
          style: selectedTemplate.name,
        });

        const result = await apiClient.generateOrEditMinutes({
          transcription_id: currentTranscription.id,
          template: selectedTemplate,
          current_minute_version_id: currentVersion.id,
          edit_instructions: editInstructions,
          action_type: "edit",
        });

        if (result.error) {
          throw new Error(result.error);
        }

        const minute_version_id = result.data?.minute_version_id;
        if (!minute_version_id) {
          throw new Error("No minute_version_id returned from API");
        }

        const minuteVersion = await pollMinuteVersion(
          currentTranscription.id,
          minute_version_id
        );

        setCurrentVersion(minuteVersion);
        track("ai_edit_completed", {
          style: selectedTemplate.name,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to generate AI edit. Please try again.";

        track("ai_edit_failed", {
          style: selectedTemplate.name,
          duration_ms: Date.now() - startedAt,
          error_type: error instanceof Error ? error.name : "unknown_error",
        });
        logMinuteGenerationError(errorMessage);
        throw error;
      } finally {
        setIsGenerating(false);
      }
    },
    [
      currentTranscription?.id,
      currentVersion,
      selectedTemplate,
      handleSaveEdit,
      logMinuteGenerationError,
    ]
  );

  const handleTemplateChange = useCallback(
    async (name: string) => {
      const template = templates.find((t) => t.name === name);
      if (!template || !currentTranscription?.id) return;

      setSelectedTemplate(template);
      const minuteVersions = await getMinuteVersions(currentTranscription.id);
      const existingVersion = findExistingMinuteVersionForTemplate(
        minuteVersions,
        template.name
      );
      if (existingVersion?.id && !existingVersion.is_generating) {
        setCurrentVersion(existingVersion);
      } else if (existingVersion?.id && currentTranscription?.id) {
        setIsGenerating(true);

        const minuteVersion = await pollMinuteVersion(
          currentTranscription.id,
          existingVersion.id
        );
        setCurrentVersion(minuteVersion);
        setIsGenerating(false);
      } else {
        generateAIMinutes(template);
      }
    },
    [templates, currentTranscription?.id, generateAIMinutes]
  );

  useEffect(() => {
    const loadMinuteVersions = async () => {
      if (!currentTranscription?.id) {
        setCurrentVersion(undefined);
        if (templates.length > 0) {
          handleTemplateChange(templates[0].name);
        }
        return;
      }

      try {
        const versions = await getMinuteVersions(currentTranscription.id);
        if (versions.length > 0) {
          const completedVersions = versions.filter(
            (version) => !version.is_generating
          );

          // Prioritize CRISSA template if it exists
          const crissaVersion = completedVersions.find(
            (version) => version.template?.name === "Crissa"
          );

          const minuteVersion =
            crissaVersion ||
            completedVersions.sort((a, b) => {
              const dateA = new Date(a.created_datetime || "").getTime();
              const dateB = new Date(b.created_datetime || "").getTime();
              return dateB - dateA; // Sort in descending order (newest first)
            })[0] ||
            versions[versions.length - 1];

          // Only call handleTemplateChange if template exists
          if (minuteVersion.template?.name) {
            handleTemplateChange(minuteVersion.template.name);
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? `Failed to fetch minute versions: ${error.message}`
            : "Failed to fetch minute versions. Please try again.";
        console.error(errorMessage);
      }
    };

    loadMinuteVersions();
  }, [currentTranscription?.id, handleTemplateChange, templates]);

  const handleRatingSubmit = async (rating: number, comment: string | null) => {
    if (!currentVersion?.id || !currentTranscription?.id) return;

    try {
      const savedVersion = await saveMinuteVersion(currentTranscription.id, {
        ...currentVersion,
        star_rating: rating,
        star_rating_comment: comment,
      });
      setCurrentVersion(savedVersion);

      if (currentVersion.trace_id) {
        await submitLangfuseScore({
          traceId: currentVersion.trace_id,
          name: "user-feedback",
          value: rating,
          comment: comment ?? undefined,
        });
      }

      track("minutes_rating_submitted", {
        version_id: currentVersion?.id,
        rating,
        comment,
      });
    } catch (error) {
      console.error("Failed to save rating. Please try again.");
      throw error;
    }
  };

  const handleCopy = () => {
    if (!currentVersion?.star_rating) {
      setTimeout(() => {
        setIsRatingDialogOpen(true);
      }, 1000); // 1 second delay
    }
  };

  return (
    <Card className="relative mt-6 bg-white dark:bg-neutral-900 shadow-lg border-neutral-200 dark:border-neutral-700">
      <CardHeader className="bg-neutral-50 dark:bg-neutral-800 p-4">
        <MinutesEditorHeader
          selectedTemplate={selectedTemplate}
          onTemplateChange={handleTemplateChange}
          isGenerating={isGenerating}
          templatesLoading={templatesLoading}
          templatesError={templatesError}
          templates={templates}
          currentVersion={currentVersion}
          isEditing={isEditing}
          onEditClick={() => setIsEditing(true)}
          onSaveEdit={handleSaveEdit}
          generateAIMinutes={generateAIMinutes}
          onAIEdit={handleAIEdit}
          onCopy={handleCopy}
          rating={currentVersion?.star_rating ?? null}
          ratingComment={currentVersion?.star_rating_comment ?? ""}
          onRatingSubmit={handleRatingSubmit}
          isRatingDialogOpen={isRatingDialogOpen}
          setIsRatingDialogOpen={setIsRatingDialogOpen}
          hasTranscriptionErrors={hasTranscriptionErrors}
        />
      </CardHeader>

      <CardContent className="p-6">
        {!currentVersion && !isGenerating && (
          <div className="flex flex-col items-center justify-center space-y-6 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 p-12 text-center text-neutral-500 dark:text-neutral-400">
            <FileText className="size-16 text-neutral-400 dark:text-neutral-500" />
            <div className="flex w-full flex-col items-center">
              {hasTranscriptionErrors ? (
                <>
                  <p className="text-xl font-semibold text-red-700 dark:text-red-500">
                    Transcription Failed
                  </p>
                  <p className="mt-2 text-neutral-600 dark:text-neutral-400">
                    The audio transcription encountered errors. Please check the
                    Transcript tab for details, or upload a new recording.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                    No summary generated yet
                  </p>
                  <p className="mt-2 text-neutral-500 dark:text-neutral-400">
                    Select a template and generate summary to get started
                  </p>

                  {selectedTemplate && (
                    <Button
                      onClick={() => generateAIMinutes(selectedTemplate)}
                      className="mt-4 flex items-center justify-center gap-2 bg-[#0F612D] dark:bg-[#0A4A22] px-6 py-2 text-white hover:bg-[#0A4A22] dark:hover:bg-[#083618]"
                    >
                      <Wand2 className="size-5" />
                      <span>Generate with {selectedTemplate.name}</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {currentVersion && (
          <div className="ph-mask w-full overflow-visible">
            <SimpleEditor
              initialContent={currentVersion?.html_content ?? ""}
              isEditing={isEditing}
              onContentChange={(newContent) => {
                setCurrentVersion({
                  ...currentVersion,
                  html_content: newContent,
                });
              }}
              onCitationClick={onCitationClick}
              onEditorClick={() => {
                if (!isEditing && !isGenerating && currentVersion) {
                  setIsEditing(true);
                }
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MinutesEditor;
