import type React from "react";
import { RequireRoute } from "@/components/access/require-permission";
import { DictationSwitchedOff } from "@/components/flags/dictation-switched-off";

/** Only for a role whose permissions include this area (lib/access/routes.ts):
 * at the address, any other role sees "not available in your role". */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRoute prefix="/record">
      <DictationSwitchedOff />
      {children}
    </RequireRoute>
  );
}
