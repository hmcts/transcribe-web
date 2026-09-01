// DialogueManager.tsx
import "react-h5-audio-player/lib/styles.css";

import { useState } from "react";

import DialogueHeader from "@/components/minutes/dialogue-manager-header";
import MinutesEditor from "@/components/minutes/minutes-editor";
import SpeakerAndTranscriptEditor from "@/components/transcription/speaker-and-transcript-editor";
import { Card, CardContent } from "@/components/ui/card";
import {
  useWhatsNewModal,
  WhatsNewModal,
} from "@/components/ui/whats-new-modal";
import { track } from "@/lib/analytics";
import { useTranscripts } from "@/providers/transcripts";

function DialogueManager() {
  const [currentCitationIndex, setCurrentCitationIndex] = useState<
    number | null
  >(null);
  const [activeTab, setActiveTab] = useState("minutes");

  const { currentTranscription } = useTranscripts();
  const { showModal, handleDismiss } = useWhatsNewModal();

  const handleCitationClick = (index: number) => {
    setCurrentCitationIndex(index);
    track("citation_clicked", {
      citationIndex: index,
    });
  };

  return (
    <Card className="mx-auto min-h-screen w-full border-none pt-5">
      <DialogueHeader currentTranscription={currentTranscription} />
      <CardContent className=" p-1">
        <div className="w-full">
          {/* Custom Tab Buttons */}
          <div className="grid w-full grid-cols-2 rounded-lg bg-muted p-2">
            <button
              type="button"
              onClick={() => setActiveTab("minutes")}
              className={`rounded-md px-4 py-2.5 text-base font-semibold transition-all ${
                activeTab === "minutes"
                  ? "bg-background text-foreground shadow-md border-b-2 border-foreground"
                  : "text-muted-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-foreground border-b-2 border-transparent"
              }`}
              aria-pressed={activeTab === "minutes"}
            >
              Meeting Summary
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("transcript")}
              className={`rounded-md px-4 py-2.5 text-base font-semibold transition-all ${
                activeTab === "transcript"
                  ? "bg-background text-foreground shadow-md border-b-2 border-foreground"
                  : "text-muted-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-foreground border-b-2 border-transparent"
              }`}
              aria-pressed={activeTab === "transcript"}
            >
              Transcript
            </button>
          </div>

          <div className="mt-4">
            <div
              style={{ display: activeTab === "minutes" ? "block" : "none" }}
            >
              <MinutesEditor onCitationClick={handleCitationClick} />{" "}
            </div>

            <div
              style={{ display: activeTab === "transcript" ? "block" : "none" }}
            >
              <SpeakerAndTranscriptEditor
                currentCitationIndex={currentCitationIndex}
              />
            </div>
          </div>
        </div>
      </CardContent>

      {/* What's New Modal */}
      <WhatsNewModal isOpen={showModal} onClose={handleDismiss} />
    </Card>
  );
}

export default DialogueManager;
