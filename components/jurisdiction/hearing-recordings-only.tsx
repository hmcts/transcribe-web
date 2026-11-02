"use client";

import Link from "next/link";
import type React from "react";
import { Button } from "@/components/ui/button";
import { useJurisdiction } from "@/providers/jurisdiction";

/**
 * The hearing recordings area, for jurisdictions that use it (DIAAT-330): a
 * bookmark or typed address does not reach it from any other. The API refuses
 * the area's requests from them too (DIAAT-334).
 */
export function HearingRecordingsOnly({ children }: { children: React.ReactNode }) {
  if (useJurisdiction().hasHearingRecordings) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-24 sm:px-6">
      <h1 className="text-3xl font-bold">This is not available in your jurisdiction</h1>
      <p className="text-muted-foreground">
        Hearing recordings are not part of Bench Notes for your jurisdiction.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </div>
  );
}
