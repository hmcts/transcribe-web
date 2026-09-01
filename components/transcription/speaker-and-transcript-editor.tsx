import AudioPlayerComponent from "@/components/audio/playback/audio-player";
import TranscriptEditor from "@/components/transcription/transcript-editor";
import { Card, CardContent } from "@/components/ui/card";
import { useTranscripts } from "@/providers/transcripts";

interface SpeakerAndTranscriptEditorProps {
  currentCitationIndex: number | null;
}

function SpeakerAndTranscriptEditor({
  currentCitationIndex,
}: SpeakerAndTranscriptEditorProps) {
  const { currentTranscription, audioBlob, audioPlaybackUrl } =
    useTranscripts();

  if (!currentTranscription) return null;

  return (
    <div className="space-y-4">
      {(audioBlob || audioPlaybackUrl) && (
        <AudioPlayerComponent
          audioBlob={audioBlob}
          audioUrl={audioPlaybackUrl}
          restrictDownload={false}
        />
      )}

      <Card>
        <div className="relative">
          <CardContent className="p-4">
            <TranscriptEditor currentCitationIndex={currentCitationIndex} />
          </CardContent>
        </div>
      </Card>
    </div>
  );
}

export default SpeakerAndTranscriptEditor;
