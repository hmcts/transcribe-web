"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isDictationEnabled } from "@/lib/environment";
import {
  fetchRuntimeFlags,
  type RuntimeFlags,
  resolveDictationEnabled,
} from "@/lib/flags/runtime-flags";
import { useAccess } from "@/providers/access";

/**
 * The runtime feature flags (DIAAT-392), read from `GET /api/flags` once the
 * user is known and again when the tab comes back into view, so a change made
 * in Admin reaches an open tab without a redeploy.
 *
 * Until they load, and if they cannot be read, the deploy-time value stands
 * (lib/environment.ts `isDictationEnabled`).
 */
interface RuntimeFlagsValue {
  dictationEnabled: boolean;
  /** Read the flags again now (after an administrator changes one). */
  reload: () => Promise<void>;
}

const RuntimeFlagsContext = createContext<RuntimeFlagsValue | null>(null);

export function RuntimeFlagsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { me } = useAccess();
  const signedIn = me !== null;
  const [flags, setFlags] = useState<RuntimeFlags | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchRuntimeFlags();
    // A failed read keeps what was last known, then the deploy default.
    if (next) setFlags(next);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [signedIn, reload]);

  const value = useMemo<RuntimeFlagsValue>(
    () => ({
      dictationEnabled: resolveDictationEnabled(flags, isDictationEnabled()),
      reload,
    }),
    [flags, reload]
  );

  return (
    <RuntimeFlagsContext.Provider value={value}>
      {children}
    </RuntimeFlagsContext.Provider>
  );
}

/** The flags, or the deploy-time default where there is no provider (tests, isolated renders). */
export function useRuntimeFlags(): RuntimeFlagsValue {
  const value = useContext(RuntimeFlagsContext);
  return (
    value ?? {
      dictationEnabled: isDictationEnabled(),
      reload: async () => undefined,
    }
  );
}

/** Whether dictation is switched on, by the runtime flag, else the deploy default. */
export function useDictationEnabled(): boolean {
  return useRuntimeFlags().dictationEnabled;
}
