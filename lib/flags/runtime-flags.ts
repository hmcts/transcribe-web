import { apiClient } from "@/lib/api-client";

/**
 * Runtime feature flags (DIAAT-392). `GET /api/flags` answers any signed-in user,
 * with or without a working context, with the flags the screens need:
 * `{"dictation_enabled": bool}`. A system administrator changes them in Admin;
 * the change applies with no redeploy.
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
}

/** The body of `GET /api/flags` if it is the promised shape, else null. */
export function parseRuntimeFlags(body: unknown): RuntimeFlags | null {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { dictation_enabled?: unknown }).dictation_enabled ===
      "boolean"
  ) {
    return {
      dictation_enabled: (body as RuntimeFlags).dictation_enabled,
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
