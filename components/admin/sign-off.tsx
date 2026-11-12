"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignOffDraft } from "@/lib/sign-off";

/** The service lead's sign-off fields (DIAAT-347: lib/sign-off.ts). */
export function SignOffFields({
  id,
  value,
  onChange,
  error,
}: {
  /** Unique on the page: the fields' ids start with it. */
  id: string;
  value: SignOffDraft;
  onChange: (value: SignOffDraft) => void;
  /** Why the save was stopped, beside the fields. */
  error?: string | null;
}) {
  return (
    <fieldset
      className="space-y-3 rounded-md border p-3"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="px-1 text-sm font-medium">
        Service lead's sign-off
      </legend>
      <p className="text-sm text-muted-foreground">
        Switching it on for everyone needs the service lead's sign-off.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-name`}>Service lead who signed it off</Label>
        <Input
          id={`${id}-name`}
          value={value.serviceLead}
          maxLength={200}
          onChange={(e) => onChange({ ...value, serviceLead: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-confirmed`}
          checked={value.confirmed}
          onCheckedChange={(checked) =>
            onChange({ ...value, confirmed: checked === true })
          }
        />
        <Label htmlFor={`${id}-confirmed`} className="font-normal">
          The service lead has signed this off
        </Label>
      </div>
      {error && (
        <p
          id={`${id}-error`}
          className="text-sm font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
