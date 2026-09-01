/* eslint-disable react/button-has-type */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import BackupRecovery from "@/components/audio/upload/backup-recovery";
import BackupUploader from "@/components/audio/upload/backup-uploader";
import MeetingsList from "@/components/meetings-list";
import { Button } from "@/components/ui/button";
import StartNewRecordingButton from "@/components/ui/start-new-recording-button";
import useMediaQuery from "@/hooks/use-media-query";
import { track } from "@/lib/analytics";
import type { AudioBackup } from "@/lib/indexeddb-backup";
import { getFullNameFromEmail } from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import { useUserSettings } from "@/providers/user-settings";

function ContactSupportButton() {
  return (
    <Button asChild variant="default">
      <Link
        href="mailto:JudicialTranscribe@justice.gov.uk"
        aria-label="Contact us via email"
      >
        Contact us
      </Link>
    </Button>
  );
}

function WelcomePage() {
  const { isLoading, transcriptsMetadata } = useTranscripts();

  const { user } = useUserSettings();
  const router = useRouter();

  const [retryingBackup, setRetryingBackup] =
    React.useState<AudioBackup | null>(null);
  const _isMobile = useMediaQuery("(max-width: 768px)");

  const displayName = user?.email ? getFullNameFromEmail(user.email) : "";
  const heading = displayName ? `Welcome back, ${displayName}` : "Welcome back";

  const startMeetingWithMode = (mode: "mic" | "screen" | "upload") => {
    track("start_new_recording_clicked", { mode });
    if (mode === "upload") {
      router.push("/upload");
      return;
    }
    // Navigate to record page with mode parameter
    router.push(`/record?mode=${mode}`);
  };

  const handleRetryUpload = async (backup: AudioBackup) => {
    setRetryingBackup(backup);
  };

  const handleCloseBackupUploader = () => {
    setRetryingBackup(null);
  };

  const handleBackupUploadSuccess = () => {
    setRetryingBackup(null);
    // Optionally refresh the backup list or show a success message
  };

  if (retryingBackup) {
    return (
      <BackupUploader
        backup={retryingBackup}
        onClose={handleCloseBackupUploader}
        onUploadSuccess={handleBackupUploadSuccess}
      />
    );
  }

  return (
    <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6">
      <div className="absolute left-1/2 right-1/2 top-0 -z-10 -ml-[50vw] -mr-[50vw] h-[28rem] bg-muted/60" />
      <section className="flex flex-col gap-4 pb-36 pt-24 text-foreground">
        <h1 className="text-5xl font-bold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground prose">
          Supporting judicial work through live transcription and enablement of
          judges to focus on proceedings and engage with the parties.
        </p>

        <div className="flex flex-col gap-4 mt-12 md:flex-row">
          <StartNewRecordingButton
            onClick={() => startMeetingWithMode("mic")}
            size="large"
            fullWidth={false}
            className="w-full md:w-auto"
          />
        </div>
      </section>

      {transcriptsMetadata.length > 0 && (
        <section className="-mt-16 rounded-xl border border-border bg-card p-4 shadow-xl">
          <MeetingsList isLoading={isLoading} meetings={transcriptsMetadata} />
        </section>
      )}

      <BackupRecovery onRetryUpload={handleRetryUpload} />

      <section
        className="mb-20 mt-16 rounded-lg border border-border bg-card p-6"
        aria-labelledby="support-heading"
      >
        <h2
          id="support-heading"
          className="mb-2 text-2xl font-bold text-card-foreground"
        >
          Technical Support
        </h2>
        <p className="mb-4 text-muted-foreground">
          For technical queries, bug reports, or feature requests, please
          contact us directly.
        </p>
        <ContactSupportButton />
      </section>
    </div>
  );
}

export default WelcomePage;
