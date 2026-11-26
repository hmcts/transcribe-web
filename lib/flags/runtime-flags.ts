import { apiClient } from "@/lib/api-client";

/**
 * Runtime feature flags (DIAAT-392). `GET /api/flags` answers any signed-in user,
 * with or without a working context, with the flags the screens need:
 * `{"dictation_enabled": bool, "max_recording_seconds": int}`. A system
 * administrator changes the flags in Admin; the change applies with no redeploy.
 *
 * DIAAT-408: `max_recording_seconds` is the longest recording the API accepts
 * now (4 hours, or its MAX_AUDIO_DURATION_SECONDS while both recording flags
 * are on), for the upload page's hint. An API from before it sends none: the
 * page then says 4 hours, as it always did.
 *
 * DIAAT-428: `multi_day_hearings` says whether a Judge can add recordings of
 * further days to a hearing, delete one day and change a day's date. An API
 * from before it sends none: off.
 *
 * The deploy-time value (`NEXT_PUBLIC_DICTATION_ENABLED`, see
 * `isDictationEnabled` in lib/environment.ts) stays as the default: it is what
 * the app uses until the flags have loaded, and whenever they cannot be read
 * (the API unreachable, a refusal, an answer that is not the promised shape).
 * The flag is for switching dictation off or on, and failing to read it never
 * changes what the deployment said.
 */
export interface RuntimeFlags {
  dictation_enabled: boolean;
  max_recording_seconds?: number;
  multi_day_hearings?: boolean;
}

/** The body of `GET /api/flags` if it is the promised shape, else null. */
export function parseRuntimeFlags(body: unknown): RuntimeFlags | null {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { dictation_enabled?: unknown }).dictation_enabled ===
      "boolean"
  ) {
    const seconds = (body as { max_recording_seconds?: unknown })
      .max_recording_seconds;
    const multiDay = (body as { multi_day_hearings?: unknown })
      .multi_day_hearings;
    return {
      dictation_enabled: (body as RuntimeFlags).dictation_enabled,
      ...(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? { max_recording_seconds: seconds }
        : {}),
      ...(typeof multiDay === "boolean"
        ? { multi_day_hearings: multiDay }
        : {}),
    };
  }
  return null;
}

/** The flags from the API, or null when they cannot be read. */
export async function fetchRuntimeFlags(): Promise<RuntimeFlags | null> {
  const response = await apiClient.request<unknown>("/flags", {
    method: "GET",
    cache: "no-store",
  });
  if (response.error) return null;
  return parseRuntimeFlags(response.data);
}

/** The flag if it was read, else the deploy-time default. */
export function resolveDictationEnabled(
  flags: RuntimeFlags | null | undefined,
  deployDefault: boolean
): boolean {
  return flags ? flags.dictation_enabled : deployDefault;
}

/** What the upload page says when the API has not told it (an older API, flags not loaded yet). */
export const DEFAULT_MAX_RECORDING_SECONDS = 4 * 60 * 60;

/** The longest recording, in seconds, as the API said, else 4 hours. */
export function resolveMaxRecordingSeconds(
  flags: RuntimeFlags | null | undefined
): number {
  return flags?.max_recording_seconds ?? DEFAULT_MAX_RECORDING_SECONDS;
}

/** A length of recording for the user: "4 hours", "8 hours", "3 hours 30 minutes". */
export function describeRecordingLimit(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes || !hours)
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ");
}
