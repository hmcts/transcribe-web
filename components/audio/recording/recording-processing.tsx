import { Loader2 } from "lucide-react";

export function RecordingProcessing() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center space-y-6 py-12">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-gradient-to-r from-blue-400 to-blue-500 opacity-20" />
        <div className="absolute inset-1 rounded-full bg-blue-100 dark:bg-blue-900/30" />
        <Loader2 className="relative z-10 size-14 animate-spin text-blue-500" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Uploading your meeting...
        </h2>
      </div>
    </div>
  );
}
