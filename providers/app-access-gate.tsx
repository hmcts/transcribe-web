"use client";

import type React from "react";
import AccessGate from "@/providers/access-gate";
import { useAccess } from "@/providers/access";

/**
 * The onboarding and "coming soon" check (AccessGate) is about using the app,
 * so it runs only for a context with `app.access`. A system-only user, who has
 * no jurisdiction and no `app.access`, goes straight to the pages they have.
 */
export function AppAccessGate({ children }: { children: React.ReactNode }) {
  const { can } = useAccess();
  return can("app.access") ? <AccessGate>{children}</AccessGate> : children;
}
