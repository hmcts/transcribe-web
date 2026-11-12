"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  hasTarget,
  NOBODY,
  type PickedUser,
  typedEmail,
  UserPicker,
} from "@/components/admin/user-picker";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SELF_ASSIGNMENT_NOTE } from "@/lib/access/refusal-messages";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { errorMessage } from "@/lib/admin-request";
import {
  type AdminUser,
  createAssignment,
  deleteAssignment,
  fetchUsersHolding,
} from "@/lib/admin-users-api";
import { useAccess } from "@/providers/access";

/**
 * The people who hold one role in one place (a jurisdiction, or none for a global
 * role), with a way to add and remove them. Used for a jurisdiction's
 * administrators (DIAAT-394) and for the super administrators (DIAAT-385). The
 * API decides who may do either (403 `assignment_not_allowed`); the screen is
 * shown by permission and says what the API answered.
 */
export function RoleHolders({
  role,
  jurisdiction,
  headingId,
  heading,
  intro,
  noun,
  offerSelf,
}: {
  role: string;
  /** The jurisdiction's code, or null for a global role. */
  jurisdiction: string | null;
  headingId: string;
  heading: string;
  intro: string;
  /** What one holder is called in messages: "administrator". */
  noun: string;
  /** Show "Add me": the caller giving the role to themselves. */
  offerSelf?: boolean;
}) {
  const { me, can } = useAccess();
  const [holders, setHolders] = useState<AdminUser[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<PickedUser>(NOBODY);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  useJurisdictionSwitchGuard({ busy, unsaved: who.email.trim() !== "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchUsersHolding(role, jurisdiction);
      setHolders(result.holders);
      setTruncated(result.truncated);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [role, jurisdiction]);

  useEffect(() => {
    setHolders(null);
    void load();
  }, [load]);

  // Nobody gives themselves a role except the holder of the permission to appoint
  // super administrators (API: 403 `assignment_not_allowed`), so that is not offered.
  const picksSelf =
    !!me &&
    (who.user
      ? who.user.id === me.user.id
      : typedEmail(who) === me.user.email.trim().toLowerCase());
  const selfBlocked = picksSelf && !can("jurisdiction_super_admin.assign");

  async function add(
    target: { user_id: string } | { email: string },
    name: string,
    self = false
  ) {
    setBusy(true);
    try {
      await createAssignment(target, jurisdiction, role);
      toast.success(`${name} is now ${a(noun)}`);
      setWho(NOBODY);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, { self }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(assignmentId: string, name: string) {
    setBusy(true);
    try {
      await deleteAssignment(assignmentId);
      toast.success(`${name} is no longer ${a(noun)}`);
      setConfirming(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const email = typedEmail(who);
    if (who.user) void add({ user_id: who.user.id }, who.user.email, picksSelf);
    else if (email) void add({ email }, email, picksSelf);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-md border p-4"
    >
      <h3 id={headingId} className="text-lg font-semibold">
        {heading}
      </h3>
      <p className="text-sm text-muted-foreground">{intro}</p>

      <form
        className="flex flex-wrap items-start gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (hasTarget(who) && !busy && !selfBlocked) submit();
        }}
      >
        <UserPicker
          id={`${headingId}-who`}
          value={who}
          onChange={setWho}
          disabled={busy}
        />
        <div className="flex gap-2 pt-6">
          <Button
            type="submit"
            disabled={busy || !hasTarget(who) || selfBlocked}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Add {noun}
          </Button>
          {offerSelf && me && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void add({ user_id: me.user.id }, "You", true)}
            >
              Add me
            </Button>
          )}
        </div>
      </form>
      {selfBlocked && (
        <p role="status" className="text-sm text-muted-foreground">
          {SELF_ASSIGNMENT_NOTE}
        </p>
      )}

      {error ? (
        <div role="alert" className="text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : holders === null ? (
        <div className="flex justify-center py-4" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading</span>
        </div>
      ) : holders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Signed in</TableHead>
              <TableHead className="w-48" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {holders.map((holder) => {
              const assignment = holder.assignments[0];
              const key = `holder:${assignment.id}`;
              return (
                <TableRow key={assignment.id}>
                  <TableCell className="font-medium">
                    {holder.email}
                    {holder.id === me?.user.id && (
                      <span className="ml-1 font-normal text-muted-foreground">(you)</span>
                    )}
                    {holder.name && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {holder.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{holder.pending ? "Not yet" : "Yes"}</TableCell>
                  <TableCell className="text-right">
                    {confirming === key ? (
                      <span className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void remove(assignment.id, holder.email)}
                        >
                          Confirm remove
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy}
                        aria-label={`Remove ${holder.email} as ${a(noun)}`}
                        onClick={() => setConfirming(key)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {truncated && (
        <p className="text-sm text-muted-foreground">
          This list may be incomplete: the user list is long, and only the first
          part was read.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        A change takes effect for the person within a few minutes, when their
        session next refreshes.
      </p>
    </section>
  );
}

function a(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}
