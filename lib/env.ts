// These values get baked into the build
const preset: Partial<Record<string, string>> = {
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  NEXT_PUBLIC_POSTHOG_HOST:
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
  NEXT_PUBLIC_MAX_RECORDING_MINUTES:
    process.env.NEXT_PUBLIC_MAX_RECORDING_MINUTES || "125",
  NEXT_PUBLIC_PREPOPULATE_LOCAL_TRANSCRIPT:
    process.env.NEXT_PUBLIC_PREPOPULATE_LOCAL_TRANSCRIPT || "false",
  // Live dictation health and autosave (DIAAT-297, DIAAT-296). Next.js inlines
  // only literal process.env.NEXT_PUBLIC_* references into browser code, so
  // without these a value set in .env would not reach the browser outside
  // start.js (e.g. `next dev`). Unset means the caller's own default.
  NEXT_PUBLIC_NO_SPEECH_WARNING_SECONDS:
    process.env.NEXT_PUBLIC_NO_SPEECH_WARNING_SECONDS,
  NEXT_PUBLIC_SPEECH_COLLAPSE_THRESHOLD:
    process.env.NEXT_PUBLIC_SPEECH_COLLAPSE_THRESHOLD,
  NEXT_PUBLIC_SPEECH_COLLAPSE_WINDOW_SECONDS:
    process.env.NEXT_PUBLIC_SPEECH_COLLAPSE_WINDOW_SECONDS,
  NEXT_PUBLIC_AUTOSAVE_FAILURE_ALERT_THRESHOLD:
    process.env.NEXT_PUBLIC_AUTOSAVE_FAILURE_ALERT_THRESHOLD,
  NEXT_PUBLIC_LIVE_DRAFT_EXPIRY_WARNING_AFTER_HOURS:
    process.env.NEXT_PUBLIC_LIVE_DRAFT_EXPIRY_WARNING_AFTER_HOURS,
};

export function getEnv(key: `NEXT_PUBLIC_${string}`): string | undefined {
  if (
    typeof window !== "undefined" &&
    (window as any).__ENV?.[key] !== undefined
  ) {
    return (window as any).__ENV[key];
  } else if (process.env[key] !== undefined) {
    return process.env[key];
  } else if (preset[key] !== undefined) {
    return preset[key];
  } else {
    return undefined;
  }
}
