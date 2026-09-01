import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AudioProcessingStatus =
  | "idle"
  | "recording"
  | { state: "uploading"; progress: number }
  | "transcribing";

interface ProcessingLoaderProps {
  status: AudioProcessingStatus;
  onStopPolling: () => void;
}

export default function ProcessingLoader({
  status,
  onStopPolling,
}: ProcessingLoaderProps) {
  if (typeof status === "object" && status.state === "uploading") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center space-y-6 py-12">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 opacity-20 motion-safe:animate-ping" />
          <div className="absolute inset-1 rounded-full bg-blue-100 dark:bg-blue-900/30" />
          <Loader2
            className="relative z-10 size-14 text-blue-500 motion-safe:animate-spin"
            aria-label="Loading"
          />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Uploading your meeting...
          </h3>
          <p
            className="mt-2 text-sm text-gray-600 dark:text-gray-300"
            aria-live="polite"
            aria-atomic="true"
          >
            Progress: {status.progress}%
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${status.progress}%` }}
              role="progressbar"
              aria-valuenow={status.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Upload progress: ${status.progress}%`}
            />
          </div>
        </div>
      </div>
    );
  }

  const handleReturnHome = () => {
    onStopPolling();
    window.location.href = "/";
  };

  return (
    <div className="mx-auto max-w-md py-12 text-center">
      {/* Green Checkmark Icon */}
      <div className="mb-6 flex justify-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#34C759] md:size-20">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Upload successful"
            className="md:scale-125"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <h1 className="mb-2 text-2xl font-semibold text-black dark:text-white md:text-3xl">
        Upload Complete
      </h1>

      {/* Subtitle */}
      <p className="mb-3 text-base text-gray-600 dark:text-gray-400 md:text-xl">
        Your meeting is safely saved.
      </p>

      {/* Email notification text */}
      <p className="mb-8 text-sm text-gray-600 dark:text-gray-400 md:text-base">
        We&apos;ll send you an email once your meeting is ready.
      </p>

      {/* Buttons - Responsive Layout */}
      <div className="flex flex-row items-center justify-center gap-3">
        <Button
          onClick={handleReturnHome}
          variant="outline"
          className="min-h-[44px] w-auto px-6 py-2 font-medium shadow-sm transition-all duration-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-safe:hover:scale-105 motion-safe:active:scale-95 md:text-lg"
        >
          Return to Home
        </Button>
        {/* <StartNewMeetingButton
          onClick={handleNewTranscription}
          className="min-h-[44px] w-auto px-6 py-2 shadow-md transition-all duration-200 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 motion-safe:hover:scale-105 motion-safe:active:scale-95 md:text-lg"
          fullWidth={false}
          showIcon={false}
        /> */}
      </div>
    </div>
  );
}
