"use client";

import { useState } from "react";
import { StageNote } from "@/components/access/stage-note";
import { Button } from "@/components/ui/button";
import { type Assignment, assignmentKey, roleLabel } from "@/lib/access/types";

/** How a (jurisdiction, role) pair reads to the user. */
export function describeAssignment(assignment: Assignment): {
  where: string;
  as: string;
} {
  return {
    where: assignment.jurisdiction?.name ?? "All jurisdictions",
    as: roleLabel(assignment.role),
  };
}

/**
 * After sign-in, for a user with more than one jurisdiction and role who has not
 * chosen yet (DIAAT-390): where and as what they are working. There is no
 * default. They can switch later from the top of any page.
 */
export function ChooseContext({
  assignments,
  onChoose,
}: {
  assignments: Assignment[];
  onChoose: (assignment: Assignment) => Promise<void>;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const choose = async (assignment: Assignment) => {
    setChoosing(assignmentKey(assignment));
    setFailed(false);
    try {
      await onChoose(assignment);
      // The tab is reloading: the buttons stay disabled, so a second choice
      // cannot race it.
    } catch {
      setFailed(true);
      setChoosing(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col justify-center gap-6 py-8">
      <h1 className="text-3xl font-bold">Choose where and as what you are working</h1>
      <p className="text-lg text-muted-foreground">
        You can work in more than one place or role. Choose the one you are
        working in now. You can switch later from the top of any page.
      </p>
      {failed && (
        <p role="alert" className="text-destructive">
          That did not work. Check your connection and try again.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {assignments.map((assignment) => {
          const { where, as } = describeAssignment(assignment);
          const key = assignmentKey(assignment);
          return (
            <li key={key}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-2 py-4 text-lg"
                disabled={choosing !== null}
                onClick={() => choose(assignment)}
              >
                <span className="font-medium">{where}</span>{" "}
                <span className="text-muted-foreground">as {as.toLowerCase()}</span>
                <StageNote stage={assignment.jurisdiction?.stage} />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
