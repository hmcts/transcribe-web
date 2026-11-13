"use client";

import { toast } from "sonner";
import { AccessRequests } from "@/components/access/access-requests";
import type { MeResponse } from "@/lib/access/types";

/**
 * Shown, and nothing else, to a signed-in user with no role (DIAAT-384,
 * DIAAT-396): ask for a jurisdiction and Judge and/or Legal text manager in it,
 * then see "request pending" with the requests and their outcome. Pending ones
 * can be withdrawn. An administrator of that jurisdiction decides.
 */
export function NoAccess({
  me,
  checkAgain,
}: {
  me: MeResponse;
  /** Mint a fresh token now: a decision may have given the user access. */
  checkAgain: () => Promise<MeResponse | null>;
}) {
  const check = async () => {
    const next = await checkAgain();
    if (!next) toast.error("Could not check just now. Try again.");
    else if (next.status === "no_access") toast.message("Nothing has changed yet.");
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">
          You do not have access to Bench Notes yet
        </h1>
        <p className="text-lg text-muted-foreground">
          You have signed in, but you have not been added to a jurisdiction. Ask
          for access below. An administrator of that jurisdiction will decide.
        </p>
      </section>
      <AccessRequests initial={me.pending_requests} onCheckAgain={check} />
    </div>
  );
}
