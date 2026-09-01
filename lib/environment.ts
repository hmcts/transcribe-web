/**
 * Environment detection utilities.
 *
 * Centralised module so every part of the app (hooks, API clients,
 * server utilities) uses the same logic.
 *
 * `NODE_ENV` is the primary signal because:
 *  - `next dev`  → "development"
 *  - `next build && next start` → "production"
 *  - Vitest → "test"
 *  - Works on both server and client (Next.js inlines it at build time)
 *  - Dead-code branches are tree-shaken from production bundles
 */

/**
 * `true` when the app is running via `next dev` or inside the
 * development Docker container (`NODE_ENV=development`).
 */
import { getEnv } from "@/lib/env";
export function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function isEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export function isLocalhostRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isMacHardware(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = (
    userAgentData?.platform ||
    navigator.platform ||
    ""
  ).toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  return platform.includes("mac") || userAgent.includes("macintosh");
}

/**
 * Enables local prepopulation only when explicitly opted-in and running on
 * localhost from Mac hardware.
 */
export function shouldPrepopulateLocalDemoData(): boolean {
  return (
    isEnabled(getEnv("NEXT_PUBLIC_PREPOPULATE_LOCAL_TRANSCRIPT")) &&
    isLocalhostRuntime() &&
    isMacHardware()
  );
}
