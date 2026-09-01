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

  useEffect(() => {
    // Load user settings on mount
    getCurrentUser()
      .then((u) => setUser(u))
      .finally(() => setLoading(false));
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
