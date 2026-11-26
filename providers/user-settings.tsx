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
import { getCurrentUser, updateCurrentUser } from "@/lib/database";
import { confirmTelemetryAccount } from "@/lib/telemetry-account";
import { telemetryRelay } from "@/lib/telemetry-relay";
import { useAccess } from "@/providers/access";
import type { User } from "@/src/api/generated"; // Adjust if needed

interface UserSettingsContextType {
  user: User | null;
  loading: boolean;
  updateUserSettings: (updates: Partial<User>) => Promise<User | null>;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(
  undefined
);

export function UserSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // DIAAT-373: `/users/me` needs `app.access`. A user who is known not to have it
  // (a system administrator with no roles, or someone with no access yet) has no
  // settings to load, and asking would only be refused with a 403. Until access is
  // known the call is made as before.
  const { me, can } = useAccess();
  const mayLoad = me === null || can("app.access");

  useEffect(() => {
    // Load user settings on mount. The same lookup tells the telemetry relay who
    // is signed in (lib/telemetry-relay.ts), numbered with the later lookups below
    // so a slow answer cannot replace a newer one.
    const check = telemetryRelay.startAccountCheck();
    if (!mayLoad) {
      // No lookup to make, so no account to report: the relay is told there is none
      // (it confirms nothing, so its telemetry stays held for an account).
      setUser(null);
      setLoading(false);
      telemetryRelay.finishAccountCheck(check, null);
      return;
    }
    getCurrentUser()
      .then((u) => {
        setUser(u);
        telemetryRelay.finishAccountCheck(check, u?.id ? String(u.id) : null);
      })
      .finally(() => setLoading(false));
  }, [mayLoad]);
  // Shown again: someone else may have signed in from another tab meanwhile. The
  // relay holds its telemetry (installRelayLifecycle) until this says who it is.
  useEffect(() => {
    const onShown = () => {
      if (document.visibilityState === "visible")
        void confirmTelemetryAccount();
    };
    document.addEventListener("visibilitychange", onShown);
    return () => document.removeEventListener("visibilitychange", onShown);
  }, []);

  const updateUserSettings = useCallback(async (updates: Partial<User>) => {
    setLoading(true);
    try {
      const updated = await updateCurrentUser(updates);
      setUser(updated);
      return updated;
    } finally {
      setLoading(false);
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      user,
      loading,
      updateUserSettings,
    }),
    [user, loading, updateUserSettings]
  );

  return (
    <UserSettingsContext.Provider value={contextValue}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (context === undefined) {
    throw new Error(
      "useUserSettings must be used within a UserSettingsProvider"
    );
  }
  return context;
}
