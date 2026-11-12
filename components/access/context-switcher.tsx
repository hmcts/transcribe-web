"use client";

import { LogOut, UserRound, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { describeAssignment } from "@/components/access/choose-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type Assignment,
  type JurisdictionRef,
  jurisdictionsOf,
  roleLabel,
} from "@/lib/access/types";
import { stageNote } from "@/lib/jurisdiction-api";
import { JurisdictionSwitchError } from "@/lib/jurisdiction-switch";
import cn from "@/lib/utils";
import { useAccess } from "@/providers/access";

/** Why a switch stopped, in words, and what to do. */
export function switchFailedMessage(error: unknown, where: string): string {
  const step = error instanceof JurisdictionSwitchError ? error.step : "save";
  if (step === "busy") {
    return "Wait for what you are submitting, uploading or saving to finish, then switch.";
  }
  if (step === "unsaved_changes") {
    return "Save or discard your changes, then switch.";
  }
  if (step === "unsaved") {
    return "Your notes, and hearing details entered before you dictate, are not kept when you switch. Copy them out or remove them, then switch.";
  }
  if (step === "switch") {
    return `Your work is saved, but the change did not work, so you are still working in ${where}. Try again.`;
  }
  return `Your work could not be saved, so you are still working in ${where}. Try again.`;
}

/** The jurisdiction control's value for the global roles (no jurisdiction). */
export const ALL_JURISDICTIONS = "-";
export const ALL_JURISDICTIONS_LABEL = "All jurisdictions";

const whereKey = (assignment: Assignment) =>
  assignment.jurisdiction?.code ?? ALL_JURISDICTIONS;

/**
 * The jurisdictions the user holds any role in, in the order the API listed
 * them, then "All jurisdictions" if they hold a global role.
 */
export function jurisdictionChoices(
  assignments: Assignment[]
): { value: string; label: string }[] {
  const choices = jurisdictionsOf(assignments).map((j) => {
    const note = stageNote(j.stage);
    return { value: j.code, label: note ? `${j.name} (${note})` : j.name };
  });
  if (assignments.some((a) => a.jurisdiction === null)) {
    choices.push({ value: ALL_JURISDICTIONS, label: ALL_JURISDICTIONS_LABEL });
  }
  return choices;
}

/** The user's roles in one jurisdiction (or, for ALL_JURISDICTIONS, their global roles). */
export function rolesIn(
  assignments: Assignment[],
  where: string
): Assignment[] {
  return assignments.filter((a) => whereKey(a) === where);
}

const SELECT_CLASS =
  "h-10 min-w-0 rounded-md border border-input bg-background px-2 text-base text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * Where and as what the user is working, for a user with a role (DIAAT-390,
 * DIAAT-406): one control picks the jurisdiction, the other the role held in it.
 * Changing the jurisdiction switches to the same role there if the user holds it,
 * else to their first role there. The account menu asks for access elsewhere,
 * leaves a jurisdiction (which drops their roles there) or signs out. The tab's
 * work is saved before any switch; if it cannot be, the tab stays where it is.
 */
export function ContextSwitcher({
  className,
  stacked = false,
  onNavigate,
}: {
  className?: string;
  /** Visible labels, one control under the other (the narrow-screen menu). */
  stacked?: boolean;
  /** Called when a link in the account menu is followed (the narrow-screen menu closes). */
  onNavigate?: () => void;
}) {
  const { active, assignments, can, switchContext, leaveJurisdiction } =
    useAccess();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<JurisdictionRef | null>(null);

  if (assignments.length === 0 || !active) return null;

  const here = describeAssignment(active);
  const label = `${here.where}: ${here.as}`;
  const where = whereKey(active);
  const roles = rolesIn(assignments, where);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      // The tab is reloading: stays disabled, so a second change cannot race it.
    } catch (error) {
      toast.error(switchFailedMessage(error, label));
      setBusy(false);
    }
  };

  const chooseJurisdiction = (value: string) => {
    if (value === where) return;
    const there = rolesIn(assignments, value);
    const target = there.find((a) => a.role === active.role) ?? there[0];
    if (target) void run(() => switchContext(target));
  };

  const chooseRole = (value: string) => {
    if (value === active.role) return;
    const target = roles.find((a) => a.role === value);
    if (target) void run(() => switchContext(target));
  };

  const labelClass = stacked ? "text-sm font-medium" : "sr-only";

  return (
    <div
      role="group"
      aria-label="Where and as what you are working"
      aria-busy={busy || undefined}
      className={cn(
        stacked ? "flex flex-col gap-2" : "flex items-center gap-2",
        className
      )}
    >
      <label htmlFor={`${id}-jurisdiction`} className={labelClass}>
        Jurisdiction
      </label>
      <select
        id={`${id}-jurisdiction`}
        className={cn(SELECT_CLASS, !stacked && "max-w-[14rem]")}
        value={where}
        disabled={busy}
        onChange={(event) => chooseJurisdiction(event.target.value)}
      >
        {jurisdictionChoices(assignments).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-role`} className={labelClass}>
        Role
      </label>
      <select
        id={`${id}-role`}
        className={cn(SELECT_CLASS, !stacked && "max-w-[12rem]")}
        value={active.role}
        disabled={busy}
        onChange={(event) => chooseRole(event.target.value)}
      >
        {roles.map((assignment) => (
          <option key={assignment.role} value={assignment.role}>
            {roleLabel(assignment.role)}
          </option>
        ))}
      </select>
      {busy && (
        <span role="status" className="text-sm text-muted-foreground">
          Switching...
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={stacked ? "h-10 justify-start px-0" : "h-10 px-2"}
            disabled={busy}
            aria-label="Your access: ask for more, leave a jurisdiction or sign out"
          >
            <UserRound className="size-5" aria-hidden="true" />
            {stacked && <span className="ml-2 text-sm">Your access</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {can("access.request") && (
            <>
              <DropdownMenuItem asChild>
                <Link href="/request-access" onClick={onNavigate}>
                  <UserRoundPlus className="mr-2 size-4" aria-hidden="true" />
                  Request access
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {jurisdictionsOf(assignments).map((jurisdiction) => (
            <DropdownMenuItem
              key={jurisdiction.code}
              onSelect={() => setLeaving(jurisdiction)}
            >
              <LogOut className="mr-2 size-4" aria-hidden="true" />
              Leave {jurisdiction.name}
            </DropdownMenuItem>
          ))}
          {jurisdictionsOf(assignments).length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <a href="/auth/logout">Sign out</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {leaving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose every role you hold in {leaving?.name}. An
              administrator would have to add you again, or you would have to
              ask for access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = leaving;
                setLeaving(null);
                if (target) void run(() => leaveJurisdiction(target.code));
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
