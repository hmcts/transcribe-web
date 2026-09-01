"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { getAdminAccessStatus } from "@/lib/admin-access";

type AdminGateState = "checking" | "authorised" | "forbidden" | "error";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AdminGateState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const accessStatus = await getAdminAccessStatus({
          allowLocalhostFallback: true,
        });

        if (cancelled) return;

        if (accessStatus === "unauthenticated") {
          const loginUrl = new URL("/.auth/login/aad", window.location.origin);
          loginUrl.searchParams.set(
            "post_login_redirect_uri",
            `${window.location.pathname}${window.location.search}`
          );
          window.location.href = loginUrl.toString();
          return;
        }

        if (accessStatus === "forbidden") {
          setState("forbidden");
          return;
        }

        if (accessStatus === "error") {
          setState("error");
          return;
        }

        setState("authorised");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Verifying admin access&hellip;
          </p>
        </div>
      </div>
    );
  }

  if (state === "forbidden" || state === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            {state === "forbidden"
              ? "You do not have admin privileges. Contact your administrator to request access."
              : "Unable to verify your admin status. Please try again later."}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
