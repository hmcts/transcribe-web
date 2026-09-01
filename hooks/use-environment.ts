import { useMemo } from "react";

import { isLocalDevelopment } from "@/lib/environment";

/**
 * Exposes environment information to React components.
 *
 * The values are derived once and memoised — they never change at
 * runtime, so there is no need for state or effects.
 *
 * @example
 * ```tsx
 * const { isLocal } = useEnvironment();
 *
 * {isLocal && <DebugPanel />}
 * ```
 */
export function useEnvironment() {
  return useMemo(
    () => ({
      /** `true` when running in local development (`NODE_ENV=development`). */
      isLocal: isLocalDevelopment(),
      /** The raw `NODE_ENV` value. */
      nodeEnv: process.env.NODE_ENV,
    }),
    []
  );
}
