"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AudioUpload } from "@/components/recording/audio-upload/audio-upload";
import type { TranscriptionJob } from "@/lib/recording/types";
import { uploadRecording } from "@/lib/recording/upload-recording";

interface AddAudioPanelProps {
  hearingId: string;
  onAdded: (job: TranscriptionJob) => void;
  onBusyChange: (busy: boolean) => void;
}

/**
 * "Add audio to this hearing" (DIAAT-428): a recording of another day of the
 * hearing, transcribed on its own, sent through /api/upload like any upload.
 */
export function AddAudioPanel({
  hearingId,
  onAdded,
  onBusyChange,
}: AddAudioPanelProps) {
  const [uploading, setUploading] = useState(false);
  // A new key clears the chosen file once it has been added, so it is not
  // added twice by accident.
  const [added, setAdded] = useState(0);

  const add = async (file: File, hearingDate?: string) => {
    setUploading(true);
    onBusyChange(true);
    try {
      const job = await uploadRecording(file, { hearingId, hearingDate });
      toast.success(`"${file.name}" added to this hearing`);
      setAdded((n) => n + 1);
      onAdded(job);
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to submit audio file"
      );
    } finally {
      setUploading(false);
      onBusyChange(false);
    }
  };

  return (
    <section className="mt-8" aria-labelledby="add-audio-heading">
      <h2 id="add-audio-heading" className="mb-1 text-lg font-semibold">
        Add audio to this hearing
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        A recording of another day of this hearing. It is transcribed on its own
        and shown here as a day of the hearing.
      </p>
      <div className="max-w-xl">
        <AudioUpload
          key={added}
          onUpload={add}
          uploading={uploading}
          askHearingDate
          submitLabel="Add to this hearing"
        />
      </div>
    </section>
  );
}
