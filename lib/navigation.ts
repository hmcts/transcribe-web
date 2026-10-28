// The app has two feature areas with confusingly similar routes: /record is
// live dictation of a court decision, /recording is uploading a hearing
// recording for batch transcription. The header nav and the landing page both
// link to them under the same labels, so each name always leads to the same
// place.
export const DICTATION_BASE_PATH = "/record";
export const DICTATION_HREF = `${DICTATION_BASE_PATH}?mode=mic`;
export const HEARING_RECORDINGS_HREF = "/recording";

// Segment-aware prefix match: "/record" must not match "/recording".
export function isPathActive(pathname: string | null, base: string): boolean {
  if (!pathname) return false;
  return pathname === base || pathname.startsWith(`${base}/`);
}
