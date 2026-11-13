import type React from "react";
import { RequireRoute } from "@/components/access/require-permission";
import { DictationSwitchedOff } from "@/components/flags/dictation-switched-off";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRoute prefix="/decisions">
      <DictationSwitchedOff />
      {children}
    </RequireRoute>
  );
}
