import type { Metadata } from "next";

/**
 * Route-group layout for the recording feature area.
 *
 * MERGE NOTE: the recording frontend's own root layout was not carried over —
 * dictation's is a strict superset (same Inter font and toaster, plus Header,
 * ThemeProvider, AccessGate, cookie banner and the provider stack). This layout
 * exists to keep the area's own metadata and to preserve route-group isolation,
 * which the merged-frontend decision requires so the two areas stay separable.
 *
 * Behaviour change worth knowing: recording pages now render inside dictation's
 * AccessGate, so they share one session and one authorization model. That is the
 * intent of C3, not an accident.
 */
export const metadata: Metadata = {
  title: "Recording transcription",
  description: "Upload a recording and retrieve an AI-generated transcript",
};

export default function RecordingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
