"use client";

import { useRouter } from "next/navigation";
import AudioUploader from "@/components/audio/upload/audio-uploader";
import { DECISIONS_HREF } from "@/lib/navigation";

export default function UploadPage() {
  const router = useRouter();

  const handleClose = () => {
    router.push(DECISIONS_HREF);
  };

  return (
    <div className="w-full">
      <AudioUploader initialRecordingMode="upload" onClose={handleClose} />
    </div>
  );
}
