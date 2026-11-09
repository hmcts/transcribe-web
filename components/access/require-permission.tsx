"use client";

import Link from "next/link";
import type React from "react";
import { describeAssignment } from "@/components/access/choose-context";
import { Button } from "@/components/ui/button";
import { ROUTE_PERMISSIONS } from "@/lib/access/routes";
import type { Permission } from "@/lib/access/types";
import { useAccess } from "@/providers/access";

/** Shown at the address of a page the active role cannot use. */
export function NotAvailableInRole() {
  const { active } = useAccess();
  const where = active ? describeAssignment(active) : null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-24 sm:px-6">
      <h1 className="text-3xl font-bold">This is not available in your role</h1>
      <p className="text-muted-foreground">
        {where
          ? `You are working in ${where.where} as ${where.as.toLowerCase()}, and that does not include this page.`
          : "What you are working as does not include this page."}{" "}
        If you hold another role, switch to it from the top of the page.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </div>
  );
}

/** Children only if the active context grants any of `anyOf`; else "not available". */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: Permission[];
  children: React.ReactNode;
}) {
  const { can } = useAccess();
  return anyOf.some(can) ? children : <NotAvailableInRole />;
}

/** The same, for an area listed in lib/access/routes.ts. */
export function RequireRoute({
  prefix,
  children,
}: {
  prefix: string;
  children: React.ReactNode;
}) {
  const rule = ROUTE_PERMISSIONS.find((r) => r.prefix === prefix);
  if (!rule) return children;
  return <RequirePermission anyOf={rule.anyOf}>{children}</RequirePermission>;
}

/** Children only if the active context grants `permission` (a part of a page). */
export function Can({
  permission,
  children,
  otherwise = null,
}: {
  permission: Permission;
  children: React.ReactNode;
  otherwise?: React.ReactNode;
}) {
  return <>{useAccess().can(permission) ? children : otherwise}</>;
}
