"use client";

import { useEffect } from "react";
import { trackDictationPage } from "@/lib/dictation-session";

/**
 * The dictation-session lifecycle for a page that records without the record
 * page's own (OBS-4): its session ends when the page is left or hidden for good.
 */
export default function DictationPageTracker() {
  useEffect(() => trackDictationPage(), []);
  return null;
}
