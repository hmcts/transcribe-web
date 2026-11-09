import { adminRequest, jsonRequest } from "@/lib/admin-request";

/** System feature flags (authz contract, section 3; DIAAT-392; feature_flags.manage). */

export interface FeatureFlag {
  name: string;
  value: boolean;
  description: string;
  updated_at: string | null;
  updated_by: string | null;
}

/** `GET /api/admin/feature-flags`. */
export async function fetchFeatureFlags(): Promise<FeatureFlag[]> {
  const body = await adminRequest<{ flags: FeatureFlag[] }>(
    "/admin/feature-flags",
    { method: "GET", cache: "no-store" }
  );
  if (!body || !Array.isArray(body.flags)) {
    throw new Error("The flags from the API were not in the expected shape");
  }
  return body.flags;
}

/**
 * `PUT /api/admin/feature-flags/{name}`, then the flags as the API now has them
 * (read again rather than trusting the shape of the PUT's answer, so what is
 * shown is what is stored).
 */
export async function setFeatureFlag(
  name: string,
  value: boolean
): Promise<FeatureFlag[]> {
  await adminRequest<unknown>(
    `/admin/feature-flags/${encodeURIComponent(name)}`,
    jsonRequest("PUT", { value })
  );
  return fetchFeatureFlags();
}
