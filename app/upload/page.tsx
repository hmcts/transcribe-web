"use client";

import { useRouter } from "next/navigation";
import AudioUploader from "@/components/audio/upload/audio-uploader";

export default function UploadPage() {
  const router = useRouter();

  const handleClose = () => {
    router.push("/");
  };

  return (
    <div className="w-full">
      <AudioUploader initialRecordingMode="upload" onClose={handleClose} />
    </div>
  );
}
