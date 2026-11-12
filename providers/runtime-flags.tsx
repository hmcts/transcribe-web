"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DICTATION_DISABLED, watchRefusals } from "@/lib/access/refusals";
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

  // The reads started so far. Only the latest may update the flags: an earlier read (the first
  // one, or one when the tab came back into view) can finish after the reload that followed a
  // save, and would put the old value back.
  const latestRead = useRef(0);

  const reload = useCallback(async () => {
    const read = ++latestRead.current;
    const next = await fetchRuntimeFlags();
    // A failed read keeps what was last known, then the deploy default.
    if (next && read === latestRead.current) setFlags(next);
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

  // The API refuses a dictation route with 403 `dictation_disabled` when an
  // administrator switched dictation off after this page loaded: read the flag
  // again, so the screens hide dictation instead of showing a failing one. Once
  // per few seconds, however many calls were refused.
  const lastReloadRef = useRef(0);
  useEffect(() => {
    if (!signedIn) return;
    return watchRefusals((code) => {
      if (code !== DICTATION_DISABLED) return;
      const now = Date.now();
      if (now - lastReloadRef.current < 3000) return;
      lastReloadRef.current = now;
      void reload();
    });
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
