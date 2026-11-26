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
import { AccessApiError, fetchCurrentJurisdiction } from "@/lib/access/api";
import { jurisdictionsOf } from "@/lib/access/types";
import type { CurrentJurisdiction } from "@/lib/jurisdiction-api";
import {
  type JurisdictionContextValue,
  jurisdictionContextValue,
  NEUTRAL,
} from "@/lib/jurisdiction-context";
import type { WordingKey } from "@/lib/jurisdiction-wording";
import { useAccess } from "@/providers/access";

/**
 * The material of the jurisdiction this tab works in (DIAAT-330): its template,
 * features and wording, loaded before any page that is about material.
 *
 * Who the user is, which jurisdiction they work in and what they may do come
 * from the access provider (providers/access.tsx), which renders this only
 * once they are in a working context. A global role or a system-only user has
 * no jurisdiction: there is then no material to load. Pages that are not about
 * anyone's material (privacy, cookies, support, the access pages) render
 * without it.
 */

const JurisdictionContext = createContext<JurisdictionContextValue>(NEUTRAL);

const PAGES_WITHOUT_MATERIAL = [
  "/coming-soon",
  "/unauthorised",
  "/privacy",
  "/cookies",
  "/support",
  // The admin area manages users and jurisdictions by permission, so it opens
  // with or without a jurisdiction. Its legal wording tab is the exception
  // (DIAAT-342): it edits the tab's jurisdiction, so it waits for it itself.
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
  | { kind: "loaded"; current: CurrentJurisdiction | null };

export function JurisdictionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { active, assignments } = useAccess();
  const code = active?.jurisdiction?.code ?? null;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!code) {
      setState({ kind: "loaded", current: null });
      return;
    }
    setState({ kind: "loading" });
    try {
      const current = await fetchCurrentJurisdiction();
      setState({ kind: "loaded", current });
    } catch (error) {
      // An API without this endpoint (404) or refusing it (403: nothing of a
      // jurisdiction for this role) leaves the neutral defaults, not a dead app.
      if (
        error instanceof AccessApiError &&
        (error.status === 404 || error.status === 403)
      ) {
        setState({ kind: "loaded", current: null });
      } else {
        setState({ kind: "failed" });
      }
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo(() => {
    const jurisdictions = jurisdictionsOf(assignments);
    if (state.kind === "loaded") {
      return jurisdictionContextValue(state.current, jurisdictions);
    }
    // Failed: settled, with no material. Loading: not yet.
    return state.kind === "failed"
      ? jurisdictionContextValue(null, jurisdictions)
      : { ...NEUTRAL, jurisdictions };
  }, [state, assignments]);

  let content: React.ReactNode;
  if (!needsJurisdiction(pathname)) {
    content = children;
  } else if (state.kind === "loading") {
    content = <JurisdictionLoading />;
  } else if (state.kind === "failed") {
    content = <JurisdictionLoadFailed onRetry={load} />;
  } else {
    // Not keyed by jurisdiction: a tab's context changes only by reloading
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
      <h1 className="text-2xl font-semibold">BenchNotes could not load</h1>
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

export function useJurisdiction(): JurisdictionContextValue {
  return useContext(JurisdictionContext);
}

/** The current jurisdiction's text for `key` (neutral outside a jurisdiction). */
export function useWording(): (key: WordingKey) => string {
  return useContext(JurisdictionContext).wording;
}
