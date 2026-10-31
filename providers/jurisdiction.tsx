"use client";

import { usePathname } from "next/navigation";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import NoJurisdiction from "@/components/jurisdiction/no-jurisdiction";
import {
  fetchMyJurisdictions,
  type MyJurisdictions,
} from "@/lib/jurisdiction-api";
import {
  type JurisdictionContextValue,
  jurisdictionContextValue,
  NEUTRAL,
} from "@/lib/jurisdiction-context";
import { setTabJurisdiction } from "@/lib/jurisdiction-session";
import type { WordingKey } from "@/lib/jurisdiction-wording";

/**
 * The jurisdiction this tab works in (DIAAT-330), loaded before any material.
 *
 * Children render only once the user is working in a jurisdiction, so
 * everything below loads that jurisdiction's material. A user with none sees
 * how to ask for access, and nothing else. Pages that are not about anyone's
 * material (privacy, cookies, support, the access pages) render without one.
 */

const JurisdictionContext = createContext<JurisdictionContextValue>(NEUTRAL);

const PAGES_WITHOUT_MATERIAL = [
  "/coming-soon",
  "/unauthorised",
  "/privacy",
  "/cookies",
  "/support",
  // The admin area manages users and content by role, not by the admin's own
  // jurisdiction (DIAAT-328 will scope it).
  "/admin",
];

function needsJurisdiction(pathname: string | null): boolean {
  return !PAGES_WITHOUT_MATERIAL.some(
    (page) => pathname === page || pathname?.startsWith(`${page}/`)
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; data: MyJurisdictions };

export function JurisdictionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const data = await fetchMyJurisdictions();
      // The API answers for this tab's jurisdiction, or moves the tab on.
      setTabJurisdiction(
        data.status === "ready" ? (data.current?.code ?? null) : null
      );
      setState({ kind: "loaded", data });
    } catch {
      setState({ kind: "failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo(
    () =>
      state.kind === "loaded"
        ? jurisdictionContextValue(state.data.current, state.data.jurisdictions)
        : NEUTRAL,
    [state]
  );

  let content: React.ReactNode;
  if (!needsJurisdiction(pathname)) {
    content = children;
  } else if (state.kind === "loading") {
    content = <JurisdictionLoading />;
  } else if (state.kind === "failed") {
    content = <JurisdictionLoadFailed onRetry={load} />;
  } else if (state.data.status === "no_jurisdiction") {
    content = <NoJurisdiction />;
  } else if (state.data.status === "choose") {
    content = <ChooseJurisdictionPending />;
  } else {
    // Not keyed by jurisdiction: a tab's jurisdiction changes only by reloading
    // the page (DIAAT-332), so the app is never remounted in place.
    content = children;
  }

  return (
    <JurisdictionContext.Provider value={value}>
      {content}
    </JurisdictionContext.Provider>
  );
}

function JurisdictionLoading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center"
      aria-busy="true"
    >
      <p role="status" className="text-muted-foreground">
        Loading your jurisdiction...
      </p>
    </main>
  );
}

function JurisdictionLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Bench Notes could not load</h1>
      <p className="text-muted-foreground">
        Check your connection, then try again.
      </p>
      <button
        type="button"
        className="rounded-md border px-4 py-2"
        onClick={onRetry}
      >
        Try again
      </button>
    </main>
  );
}

function ChooseJurisdictionPending() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-4 text-center">
      <p>You belong to more than one jurisdiction.</p>
    </main>
  );
}

export function useJurisdiction(): JurisdictionContextValue {
  return useContext(JurisdictionContext);
}

/** The current jurisdiction's text for `key` (neutral outside a jurisdiction). */
export function useWording(): (key: WordingKey) => string {
  return useContext(JurisdictionContext).wording;
}
