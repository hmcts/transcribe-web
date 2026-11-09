"use client";

import { RoleHolders } from "@/components/admin/role-holders";
import { JURISDICTION_SUPER_ADMINISTRATOR } from "@/lib/access/assignable-roles";

/**
 * Admin > Super administrators (DIAAT-385, DIAAT-394; `jurisdiction_super_admin.assign`).
 * Who holds the global super administrator role, which applies to every
 * jurisdiction and is given to no jurisdiction in particular. The person using
 * this screen may add themselves: that is how each environment gets its first
 * one. Only the API's own role lists decide who can be shown here; nothing else
 * is ever listed.
 */
export function SuperAdministratorsPanel() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">Super administrators</h2>
      <RoleHolders
        role={JURISDICTION_SUPER_ADMINISTRATOR}
        jurisdiction={null}
        headingId="super-administrators"
        heading="Who can manage every jurisdiction"
        intro="Super administrators create jurisdictions, manage them all and appoint each jurisdiction's administrators. You can add yourself."
        noun="super administrator"
        offerSelf
      />
    </div>
  );
}
