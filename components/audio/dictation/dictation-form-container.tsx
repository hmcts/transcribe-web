import { Save } from "lucide-react";
import type { RefObject } from "react";
import DictationForm from "@/components/audio/dictation/dictation-form";
import type { DictationFormValues } from "@/components/audio/dictation/formData";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type FormErrors = Partial<Record<keyof DictationFormValues, string>>;

interface DictationFormContainerProps {
  formScrollContainerRef: RefObject<HTMLDivElement | null>;
  formData: DictationFormValues;
  formErrors: FormErrors;
  transcriptLength: number;
  isSubmitting: boolean;
  onFormStateChange: (values: DictationFormValues) => void;
  onSaveTranscript: () => void;
}

export default function DictationFormContainer({
  formScrollContainerRef,
  formData,
  formErrors,
  transcriptLength,
  isSubmitting,
  onFormStateChange,
  onSaveTranscript,
}: DictationFormContainerProps) {
  return (
    <>
      <div ref={formScrollContainerRef} className="flex-1 overflow-y-auto pr-1">
        <DictationForm
          onFormStateChange={onFormStateChange}
          externalErrors={formErrors}
          initialValues={formData}
        />
      </div>

      <Separator className="mx-auto" />

      <TooltipProvider delayDuration={0}>
        <Tooltip
          open={transcriptLength === 0 && !isSubmitting ? undefined : false}
        >
          <TooltipTrigger asChild>
            <div
              className={
                transcriptLength === 0 || isSubmitting
                  ? "cursor-not-allowed"
                  : ""
              }
            >
              <Button
                onClick={
                  transcriptLength === 0 || isSubmitting
                    ? undefined
                    : onSaveTranscript
                }
                disabled={transcriptLength === 0 || isSubmitting}
                variant="default"
                size="lg"
                className="w-full select-none disabled:pointer-events-none disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400"
              >
                <Save className="size-5" />
                {isSubmitting ? "Saving..." : "Submit hearing"}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs p-4">
            <p className="text-base">
              Complete the hearing details and stop the transcription recording
              to submit a hearing
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
