"use client";

import { useEffect, useState } from "react";
import { apiPath } from "@/lib/recording/base-path";
import { recordingFetch } from "@/lib/recording/browser-fetch";

/**
 * The largest file the upload accepts (the web pod's MAX_UPLOAD_BYTES, served
 * by `GET /api/upload`), or null until it is known or if it cannot be read.
 *
 * A file over it is refused before it is sent: the browser keeps sending a body
 * after the server has answered 413, so a file over the limit used to be refused
 * only once all of it had been uploaded. Null means "do not check here": the
 * server still refuses a file that is too large, only later.
 */
export function useMaxUploadBytes(): number | null {
  const [maxBytes, setMaxBytes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fire and forget: every failure is handled inside, and a late answer is dropped.
    void (async () => {
      try {
        const response = await recordingFetch(apiPath("/api/upload"), {
          cache: "no-store",
        });
        if (!response.ok) return;
        const value = (await response.json())?.max_upload_bytes;
        if (!cancelled && Number.isSafeInteger(value) && value > 0) {
          setMaxBytes(value);
        }
      } catch {
        // Not known: the server's check stays the only one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return maxBytes;
}
