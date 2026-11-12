"use client";

import { AccessRequests } from "@/components/access/access-requests";
import { useAccess } from "@/providers/access";

/**
 * DIAAT-406: a user who already holds roles asks for access to another
 * jurisdiction, or another role in one of theirs, from the header's account menu.
 * The same request as a user with no role makes; an administrator of that
 * jurisdiction decides.
 */
export default function RequestAccessPage() {
  const { me, assignments } = useAccess();
  return (
    <div className="container flex max-w-2xl flex-col gap-8 py-6 md:py-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Request access</h1>
        <p className="text-lg text-muted-foreground">
          Ask for a role in another jurisdiction, or another role in one you
          work in. An administrator of that jurisdiction will decide. You get
          the role within a few minutes of it being approved, and can then
          switch to it from the top of the page.
        </p>
      </section>
      <AccessRequests initial={me?.pending_requests ?? []} held={assignments} />
    </div>
  );
}
