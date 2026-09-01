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
