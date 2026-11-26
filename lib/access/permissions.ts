import type { Assignment, MeResponse, Permission } from "@/lib/access/types";

/** What components read off a `me`: `can`, the active pair and the assignments. */
export function accessValueFor(me: MeResponse | null): {
  can: (permission: Permission) => boolean;
  active: Assignment | null;
  assignments: Assignment[];
} {
  const granted = new Set(me?.permissions ?? []);
  return {
    can: (permission) => granted.has(permission),
    active: me?.active ?? null,
    assignments: me?.assignments ?? [],
  };
}
