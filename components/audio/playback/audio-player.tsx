/* eslint-disable jsx-a11y/media-has-caption */

"use client";

import { useEffect, useState } from "react";

interface AudioPlayerProps {
  audioBlob: Blob | null;
  audioUrl: string | null;
  restrictDownload: boolean;
}

function AudioPlayerComponent({
  audioBlob = null,
  audioUrl = null,
  restrictDownload = false,
}: AudioPlayerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      setObjectUrl(url);

      return () => {
        if (url) URL.revokeObjectURL(url);
      };
    }
    setObjectUrl(null);
    return undefined;
  }, [audioBlob]);

  const resolvedUrl = objectUrl || audioUrl;

  if (!resolvedUrl) return null;

  return (
    <div className="mb-4">
      <audio
        controls
        className="w-full rounded-md"
        preload="none"
        controlsList={restrictDownload ? "nodownload" : undefined}
      >
        <source src={resolvedUrl} type={audioBlob?.type} />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

export default AudioPlayerComponent;
