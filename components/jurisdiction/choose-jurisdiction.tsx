"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { JurisdictionSummary } from "@/lib/jurisdiction-api";

/**
 * After sign-in, for a judge who sits in more than one jurisdiction and has not
 * chosen one yet (DIAAT-332). They can switch later from the header.
 */
export default function ChooseJurisdiction({
  jurisdictions,
  onChoose,
}: {
  jurisdictions: JurisdictionSummary[];
  onChoose: (code: string) => Promise<void>;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const choose = async (code: string) => {
    setChoosing(code);
    setFailed(false);
    try {
      await onChoose(code);
    } catch {
      setFailed(true);
      setChoosing(null);
    }
  };

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 sm:px-6"
    >
      <h1 className="text-3xl font-bold">Choose your jurisdiction</h1>
      <p className="text-lg text-muted-foreground">
        You sit in more than one jurisdiction. Choose the one you are working in
        now. You can switch later from the top of any page.
      </p>
      {failed && (
        <p role="alert" className="text-destructive">
          That did not work. Check your connection and try again.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {jurisdictions.map((jurisdiction) => (
          <li key={jurisdiction.code}>
            <Button
              variant="outline"
              className="w-full justify-start py-6 text-lg"
              disabled={choosing !== null}
              onClick={() => choose(jurisdiction.code)}
            >
              {jurisdiction.name}
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}
