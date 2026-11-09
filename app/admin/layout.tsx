import type React from "react";
import { RequireRoute } from "@/components/access/require-permission";

/** The Admin area: for a role with `admin.access`. What each tab shows is
 * decided by its own permission (app/admin/page.tsx). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireRoute prefix="/admin">{children}</RequireRoute>;
}
