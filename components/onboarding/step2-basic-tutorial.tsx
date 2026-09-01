import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Step2BasicTutorial() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-3xl font-semibold sm:text-4xl">Basic Tutorial</h2>
        <p className="text-lg text-gray-600">
          Using Judicial Transcribe is simple
        </p>
      </div>

      {/* Video Placeholder */}
      <div className="rounded-lg bg-gray-100 p-8 text-center">
        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gray-200">
          <Play className="size-10 text-gray-500" />
        </div>
        <p className="mb-4 text-lg text-gray-600">Basic Tutorial Video</p>
        <Button variant="outline" disabled size="lg">
          <Play className="mr-2 size-4" />
          Play Video (Coming Soon)
        </Button>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        <div className="flex items-start space-x-4">
          <span className="text-lg font-semibold text-blue-600">1.</span>
          <span className="text-base">
            Click start new meeting and select in person or virtual meeting
          </span>
        </div>
        <div className="flex items-start space-x-4">
          <span className="text-lg font-semibold text-blue-600">2.</span>
          <span className="text-base">
            Give permission to use your microphone
          </span>
        </div>
        <div className="flex items-start space-x-4">
          <span className="text-lg font-semibold text-blue-600">3.</span>
          <span className="text-base">Click start recording</span>
        </div>
        <div className="flex items-start space-x-4">
          <span className="text-lg font-semibold text-blue-600">4.</span>
          <span className="text-base">Click stop recording</span>
        </div>
        <div className="flex items-start space-x-4">
          <span className="text-lg font-semibold text-blue-600">5.</span>
          <span className="text-base">
            We&apos;ll email you when your summary is ready for review
          </span>
        </div>
      </div>
    </div>
  );
}
