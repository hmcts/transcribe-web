import RecordingControl from "@/components/audio/recording/recording-control";
import SilenceNotificationsBanner from "@/components/audio/recording/silence-notifications-banner";

interface RecordingInProgressProps {
  mediaStream: MediaStream | null;
  onStopRecording: () => void;
  togglePauseResume: () => void;
  isPaused: boolean;
  recordingTime: number;
}

export function RecordingInProgress({
  mediaStream,
  onStopRecording,
  togglePauseResume,
  isPaused,
  recordingTime,
}: RecordingInProgressProps) {
  return (
    <>
      <div className="my-6 text-center">
        <h1 className="text-2xl font-semibold">In-Person Meeting Recorder</h1>
      </div>

      <SilenceNotificationsBanner />

      <div className="flex flex-col space-y-2">
        <RecordingControl
          stream={mediaStream}
          isRecording
          onStopRecording={onStopRecording}
          recorderControls={{
            togglePauseResume,
            isPaused,
            recordingTime,
          }}
          elapsedTime={recordingTime}
        />
      </div>
    </>
  );
}
