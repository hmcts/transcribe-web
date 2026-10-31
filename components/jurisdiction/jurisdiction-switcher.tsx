"use client";

import { Building2, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JurisdictionSwitchError } from "@/lib/jurisdiction-switch";
import { useJurisdiction } from "@/providers/jurisdiction";

/**
 * Switch jurisdiction, for a judge who sits in more than one (DIAAT-332). The
 * tab's work is saved first; if it cannot be, the tab stays where it is.
 */
function switchFailedMessage(error: unknown, currentName: string): string {
  const step = error instanceof JurisdictionSwitchError ? error.step : "save";
  if (step === "busy") {
    return "Wait for your submission to finish, then switch jurisdiction.";
  }
  if (step === "switch") {
    return `Your work is saved, but the switch did not work, so you are still working in ${currentName}. Try again.`;
  }
  return `Your work could not be saved, so you are still working in ${currentName}. Try again.`;
}

export function JurisdictionSwitcher({ className }: { className?: string }) {
  const { current, jurisdictions, switchTo } = useJurisdiction();
  const [switching, setSwitching] = useState(false);

  if (!current || jurisdictions.length < 2) return null;

  const switchToJurisdiction = async (code: string) => {
    setSwitching(true);
    try {
      await switchTo(code);
      // The tab is reloading: stays disabled, so a second switch cannot race it.
    } catch (error) {
      toast.error(switchFailedMessage(error, current.name));
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={className}
          disabled={switching}
          aria-label={`Jurisdiction: ${current.name}. Switch jurisdiction`}
        >
          <Building2 className="mr-1 size-5" />
          <span className="text-base">
            {switching ? "Switching..." : current.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch jurisdiction</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {jurisdictions.map((jurisdiction) =>
          jurisdiction.code === current.code ? (
            <DropdownMenuItem key={jurisdiction.code} disabled>
              <Check className="mr-2 size-4" aria-hidden="true" />
              {jurisdiction.name}
              <span className="sr-only"> (current)</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={jurisdiction.code}
              onSelect={() => switchToJurisdiction(jurisdiction.code)}
            >
              <span className="mr-2 size-4" aria-hidden="true" />
              {jurisdiction.name}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
