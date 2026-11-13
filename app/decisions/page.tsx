"use client";

import { useRouter } from "next/navigation";
import React from "react";
import BackupRecovery from "@/components/audio/upload/backup-recovery";
import BackupUploader from "@/components/audio/upload/backup-uploader";
import MeetingsList from "@/components/meetings-list";
import StartNewRecordingButton from "@/components/ui/start-new-recording-button";
import { track } from "@/lib/analytics";
import type { AudioBackup } from "@/lib/indexeddb-backup";
import { DICTATION_HREF } from "@/lib/navigation";
import { useDictationEnabled } from "@/providers/runtime-flags";
import { useTranscripts } from "@/providers/transcripts";

export default function DecisionsPage() {
  const { isLoading, transcriptsMetadata } = useTranscripts();
  const router = useRouter();
  // With dictation switched off the API refuses the list and re-uploads.
  const dictationEnabled = useDictationEnabled();
  const [retryingBackup, setRetryingBackup] =
    React.useState<AudioBackup | null>(null);

  if (retryingBackup) {
    return (
      <BackupUploader
        backup={retryingBackup}
        onClose={() => setRetryingBackup(null)}
        onUploadSuccess={() => setRetryingBackup(null)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <h1 className="text-xl font-bold text-foreground">Decisions</h1>
        </div>
      </header>

      {dictationEnabled && (
        <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
          <section>
            <StartNewRecordingButton
              onClick={() => {
                track("start_new_recording_clicked", { mode: "mic" });
                router.push(DICTATION_HREF);
              }}
              size="large"
              fullWidth={false}
              className="w-full md:w-auto"
            />
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-xl">
            <MeetingsList
              isLoading={isLoading}
              meetings={transcriptsMetadata}
            />
          </section>

          <BackupRecovery onRetryUpload={setRetryingBackup} />
        </div>
      )}
    </main>
  );
}
