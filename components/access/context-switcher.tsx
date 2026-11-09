"use client";

import { Building2, Check, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { describeAssignment } from "@/components/access/choose-context";
import { StageNote } from "@/components/access/stage-note";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  assignmentKey,
  contextOf,
  type JurisdictionRef,
  jurisdictionsOf,
  sameContext,
} from "@/lib/access/types";
import { JurisdictionSwitchError } from "@/lib/jurisdiction-switch";
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

/**
 * Where and as what the user is working, for a user with a role (DIAAT-390).
 * With more than one pair it switches between them; for any user it can leave a
 * jurisdiction (which drops their roles there) and sign out. The tab's work is
 * saved first; if it cannot be, the tab stays where it is.
 */
export function ContextSwitcher({ className }: { className?: string }) {
  const { active, assignments, switchContext, leaveJurisdiction } = useAccess();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<JurisdictionRef | null>(null);

  if (assignments.length === 0 || !active) return null;

  const here = describeAssignment(active);
  const label = `${here.where}: ${here.as}`;
  const current = contextOf(active);

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

  const others = assignments.filter(
    (assignment) => !sameContext(contextOf(assignment), current)
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={className}
            disabled={busy}
            aria-label={`Working in ${here.where} as ${here.as.toLowerCase()}. Switch or leave`}
          >
            <Building2 className="mr-1 size-5" />
            <span className="text-base">{busy ? "Switching..." : label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Working as</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <Check className="mr-2 size-4" aria-hidden="true" />
            {label}
            <StageNote stage={active.jurisdiction?.stage} />
            <span className="sr-only"> (current)</span>
          </DropdownMenuItem>
          {others.map((assignment) => {
            const { where, as } = describeAssignment(assignment);
            return (
              <DropdownMenuItem
                key={assignmentKey(assignment)}
                onSelect={() => run(() => switchContext(assignment))}
              >
                <span className="mr-2 size-4" aria-hidden="true" />
                {where}: {as}
                <StageNote stage={assignment.jurisdiction?.stage} />
              </DropdownMenuItem>
            );
          })}
          {jurisdictionsOf(assignments).length > 0 && <DropdownMenuSeparator />}
          {jurisdictionsOf(assignments).map((jurisdiction) => (
            <DropdownMenuItem
              key={jurisdiction.code}
              onSelect={() => setLeaving(jurisdiction)}
            >
              <LogOut className="mr-2 size-4" aria-hidden="true" />
              Leave {jurisdiction.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
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
    </>
  );
}
