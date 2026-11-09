import type { Permission } from "@/lib/access/types";

/**
 * Which permission each area of the app needs. The one place that says it:
 * the route guards (components/access/require-permission.tsx) and the redirect
 * after a context switch both read this table. The API enforces the same
 * permissions on its routes; this only decides what the UI shows.
 */
export interface RoutePermission {
  /** The path and everything below it. */
  prefix: string;
  /** Any one of these opens the area. */
  anyOf: Permission[];
  /** Pages that make sense to stay on after a context switch (a list-level page). */
  staysAfterSwitch?: boolean;
}

export const ROUTE_PERMISSIONS: RoutePermission[] = [
  { prefix: "/record", anyOf: ["dictation.use"], staysAfterSwitch: true },
  { prefix: "/upload", anyOf: ["dictation.use"], staysAfterSwitch: true },
  { prefix: "/speech-demo", anyOf: ["dictation.use"] },
  { prefix: "/recording", anyOf: ["recording.own"], staysAfterSwitch: true },
  { prefix: "/admin", anyOf: ["admin.access"], staysAfterSwitch: true },
  {
    prefix: "/jurisdiction-wording",
    anyOf: ["jurisdiction.wording.edit"],
    staysAfterSwitch: true,
  },
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The rule for a path, or undefined if it is open to anyone who can see the app. */
export function ruleFor(pathname: string): RoutePermission | undefined {
  return ROUTE_PERMISSIONS.find((rule) => under(pathname, rule.prefix));
}

export function isPathAllowed(
  pathname: string,
  can: (permission: Permission) => boolean
): boolean {
  const rule = ruleFor(pathname);
  return !rule || rule.anyOf.some(can);
}

/**
 * Where to land after a switch: the same list-level page if the new context may
 * use it, else the home page. Pages about one item (a job, a draft) never carry
 * over, as that item belongs to the context that was left.
 */
export function landingAfterSwitch(
  pathname: string,
  can: (permission: Permission) => boolean
): string {
  const rule = ruleFor(pathname);
  const stays =
    rule?.staysAfterSwitch &&
    pathname === rule.prefix &&
    rule.anyOf.some(can);
  return stays ? pathname : "/";
}
