// Page paths in the recording area. Its pages live under app/recording/ in
// the merged app ("/" is the dictation home page), so internal links and
// router pushes must carry the /recording prefix. Not affected by
// lib/recording/base-path.ts, which only prefixes calls to the area's own
// route handlers under /api/*.
export const RECORDING_HOME = "/recording";

export function jobPath(jobId: string): string {
  return `${RECORDING_HOME}/jobs/${jobId}`;
}
