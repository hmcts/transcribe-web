"use client";

import { usePathname } from "next/navigation";
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
import { ChooseContext } from "@/components/access/choose-context";
import { ContextChangedBanner } from "@/components/access/context-changed-banner";
import { ContextShell } from "@/components/access/context-shell";
import { Deactivated } from "@/components/access/deactivated";
import { DevLoginScreen } from "@/components/access/dev-login-screen";
import { NoAccess } from "@/components/access/no-access";
import {
  AccessApiError,
  fetchMe,
  postContext,
  postLeaveJurisdiction,
  postRefreshSession,
} from "@/lib/access/api";
import { accessValueFor } from "@/lib/access/permissions";
import {
  CONTEXT_CHANGED,
  CONTEXT_REQUIRED,
  USER_DEACTIVATED,
  watchRefusals,
} from "@/lib/access/refusals";
import { landingAfterSwitch } from "@/lib/access/routes";
import {
  type Assignment,
  contextOf,
  type MeResponse,
  type Permission,
} from "@/lib/access/types";
import { isDevLoginMode } from "@/lib/dev-login-mode";
import { isLocalDevelopment } from "@/lib/environment";
import { getTabContext, setTabContext } from "@/lib/jurisdiction-session";
import {
  JurisdictionSwitchError,
  prepareForJurisdictionSwitch,
  reloadAt,
} from "@/lib/jurisdiction-switch";

/**
 * Who the user is and what they may do (DIAAT-373), loaded from
 * `GET /api/me/permissions` before anything else.
 *
 * The UI is driven only by the permissions the API returns: components ask
 * `can("dictation.use")`, never which role the user holds. Children render once
 * the user is in a working context. Until then the user sees the screen for
 * their state: choose where and as what, no access yet (with the access request
 * form), or, in local development, the persona picker. Pages that are not about
 * anyone's material (privacy, cookies, support) render without one.
 */

export type AccessStatus =
  | "loading"
  | "failed"
  | "unauthenticated"
  | "deactivated"
  | "ready"
  | "choose"
  | "no_access";

export interface AccessValue {
  status: AccessStatus;
  me: MeResponse | null;
  /** Whether the active context grants `permission`. False until loaded. */
  can: (permission: Permission) => boolean;
  active: Assignment | null;
  assignments: Assignment[];
  /** Another tab switched context (or the role was removed) since this tab loaded. */
  stale: boolean;
  /** Fetch `me` again and use it, without reloading the page. */
  refresh: () => Promise<MeResponse | null>;
  /** Mint a fresh token now (for instance after a request is decided), then use `me`. */
  checkAgain: () => Promise<MeResponse | null>;
  /**
   * Work as `target` from now on, for the whole session. Saves this tab's work
   * first, then reloads the tab in the new context (or on the home page if the
   * page is not allowed there). Rejects with the step that stopped it
   * (JurisdictionSwitchError), leaving the tab as it was.
   */
  switchContext: (target: Assignment) => Promise<void>;
  /** Leave `code`: drops the user's roles there. Same saving and reloading. */
  leaveJurisdiction: (code: string) => Promise<void>;
}

const cannot = () => false;

export const NEUTRAL_ACCESS: AccessValue = {
  status: "loading",
  me: null,
  can: cannot,
  active: null,
  assignments: [],
  stale: false,
  refresh: async () => null,
  checkAgain: async () => null,
  switchContext: async () => undefined,
  leaveJurisdiction: async () => undefined,
};

const AccessContext = createContext<AccessValue>(NEUTRAL_ACCESS);

const PAGES_WITHOUT_MATERIAL = [
  "/coming-soon",
  "/unauthorised",
  "/privacy",
  "/cookies",
  "/support",
];

function isPublicPage(pathname: string | null): boolean {
  return PAGES_WITHOUT_MATERIAL.some(
    (page) => pathname === page || pathname?.startsWith(`${page}/`)
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "unauthenticated" }
  | { kind: "deactivated" }
  | { kind: "loaded"; me: MeResponse };

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [stale, setStale] = useState(false);
  const meRef = useRef<MeResponse | null>(null);

  /** Adopt `me`: this tab now works in the context the session is in. */
  const adopt = useCallback((me: MeResponse) => {
    meRef.current = me;
    setTabContext(contextOf(me.active));
    setState({ kind: "loaded", me });
  }, []);

  const load = useCallback(async (): Promise<MeResponse | null> => {
    // Asking who this is must not name a context: the answer is what this tab
    // adopts, and a stale one from an earlier page load would only be refused.
    setTabContext(null);
    try {
      const me = await fetchMe();
      adopt(me);
      return me;
    } catch (error) {
      if (error instanceof AccessApiError && error.status === 401) {
        setState({ kind: "unauthenticated" });
      } else if (
        error instanceof AccessApiError &&
        error.code === USER_DEACTIVATED
      ) {
        setState({ kind: "deactivated" });
      } else {
        setState({ kind: "failed" });
      }
      return null;
    }
  }, [adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      adopt(me);
      return me;
    } catch (error) {
      if (error instanceof AccessApiError && error.code === USER_DEACTIVATED) {
        setState({ kind: "deactivated" });
      }
      return null;
    }
  }, [adopt]);

  // Refusals that are about who the user is, from any call in the tab (the
  // API's own codes: lib/access/refusals.ts).
  const lastRefreshRef = useRef(0);
  useEffect(
    () =>
      watchRefusals((code) => {
        if (code === CONTEXT_CHANGED) {
          // Another tab switched context: this tab's page state is stale.
          setStale(true);
        } else if (code === USER_DEACTIVATED) {
          setState({ kind: "deactivated" });
        } else if (code === CONTEXT_REQUIRED) {
          // The session has no context but this tab thinks it has (a role was
          // removed at a re-mint): ask who the user is now and show that
          // screen (choose, or no access). Not more than once in a few
          // seconds, and not when this tab already knows it has none.
          const now = Date.now();
          if (meRef.current?.active && now - lastRefreshRef.current > 3000) {
            lastRefreshRef.current = now;
            void refresh();
          }
        }
      }),
    [refresh]
  );

  const checkAgain = useCallback(async () => {
    try {
      const me = await postRefreshSession();
      adopt(me);
      return me;
    } catch {
      return null;
    }
  }, [adopt]);

  const reloadAfter = useCallback((me: MeResponse) => {
    const granted = new Set(me.permissions);
    const target = landingAfterSwitch(window.location.pathname, (p) =>
      granted.has(p)
    );
    // The tab keeps its old context until the document really reloads (the new page adopts the
    // session's: AccessProvider.load). The recorder's "leave this page?" prompt can be cancelled; a
    // tab that had already taken the new context would then autosave its old page's work into it.
    // Left as it is, such a tab is refused by the API (409 context_changed) and asks to reload.
    reloadAt(target);
  }, []);

  /** Save the tab's work, change the session's context with `change`, save any
   * work done meanwhile, then reload. On a failure the tab stays as it was. */
  const changeContext = useCallback(
    async (change: () => Promise<MeResponse>, undo: () => Promise<unknown>) => {
      try {
        await prepareForJurisdictionSwitch();
      } catch (error) {
        throw error instanceof JurisdictionSwitchError
          ? error
          : new JurisdictionSwitchError("save", { cause: error });
      }
      let me: MeResponse;
      try {
        me = await change();
      } catch (error) {
        throw new JurisdictionSwitchError("switch", { cause: error });
      }
      // Again, just before leaving: anything said or typed meanwhile.
      try {
        await prepareForJurisdictionSwitch();
      } catch (error) {
        // The tab stays, so the session goes back too: new tabs must not work
        // in the other context.
        await undo().catch(() => undefined);
        throw error instanceof JurisdictionSwitchError
          ? error
          : new JurisdictionSwitchError("save", { cause: error });
      }
      reloadAfter(me);
    },
    [reloadAfter]
  );

  const switchContext = useCallback(
    async (target: Assignment) => {
      const here = getTabContext();
      const wanted = contextOf(target);
      if (!wanted) return;
      await changeContext(
        () => postContext(wanted),
        async () => {
          if (here) await postContext(here);
        }
      );
    },
    [changeContext]
  );

  const leaveJurisdiction = useCallback(
    async (code: string) => {
      // Leaving cannot be undone from here: there is nothing to put back.
      await changeContext(() => postLeaveJurisdiction(code), async () => undefined);
    },
    [changeContext]
  );

  const me = state.kind === "loaded" ? state.me : null;
  const value = useMemo<AccessValue>(
    () => ({
      ...accessValueFor(me),
      status: state.kind === "loaded" ? state.me.status : state.kind,
      me,
      stale,
      refresh,
      checkAgain,
      switchContext,
      leaveJurisdiction,
    }),
    [state, me, stale, refresh, checkAgain, switchContext, leaveJurisdiction]
  );

  let content: React.ReactNode;
  if (state.kind === "loaded" && state.me.status === "ready") {
    content = children;
  } else if (isPublicPage(pathname)) {
    content = children;
  } else if (state.kind === "loading") {
    content = (
      <ContextShell>
        <Loading />
      </ContextShell>
    );
  } else if (state.kind === "deactivated") {
    content = (
      <ContextShell>
        <Deactivated />
      </ContextShell>
    );
  } else if (state.kind === "failed") {
    content = (
      <ContextShell>
        <LoadFailed onRetry={() => void load()} />
      </ContextShell>
    );
  } else if (state.kind === "unauthenticated") {
    content = (
      <ContextShell>
        {isDevLoginMode() ? (
          <DevLoginScreen />
        ) : (
          <SigningIn local={isLocalDevelopment()} onRetry={() => void load()} />
        )}
      </ContextShell>
    );
  } else if (state.me.status === "choose") {
    content = (
      <ContextShell>
        <ChooseContext
          assignments={state.me.assignments}
          onChoose={switchContext}
        />
      </ContextShell>
    );
  } else {
    content = (
      <ContextShell>
        <NoAccess me={state.me} checkAgain={checkAgain} />
      </ContextShell>
    );
  }

  return (
    <AccessContext.Provider value={value}>
      {content}
      {stale && <ContextChangedBanner />}
    </AccessContext.Provider>
  );
}

function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      aria-busy="true"
    >
      <p role="status" className="text-muted-foreground">
        Loading your access...
      </p>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
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
    </div>
  );
}

function SigningIn({
  local,
  onRetry,
}: {
  local: boolean;
  onRetry: () => void;
}) {
  if (!local) {
    // The shared client has already sent the browser to the sign-in page.
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p role="status" className="text-muted-foreground">
          Signing you in...
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">You are not signed in</h1>
      <p className="text-muted-foreground">
        The API did not accept this browser. Check that it is running.
      </p>
      <button
        type="button"
        className="rounded-md border px-4 py-2"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

/** Everything about the user's access and permissions. */
export function useAccess(): AccessValue {
  return useContext(AccessContext);
}

/** `can("dictation.use")`: whether the active context grants it. */
export function usePermissions(): Pick<AccessValue, "can"> {
  return { can: useContext(AccessContext).can };
}
