"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEV_PERSONAS, devLoginUrl } from "@/lib/dev-personas";
import { isDevLoginMode } from "@/lib/dev-login-mode";

/**
 * Local development only: sign in as another seeded persona. Renders nothing
 * unless isDevLoginMode(), so it is never in a deployed page.
 */
export function DevPersonaPicker({ className }: { className?: string }) {
  if (!isDevLoginMode()) return null;
  const returnTo =
    typeof window === "undefined" ? "/" : window.location.pathname || "/";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={className}
          aria-label="Development only: sign in as another persona"
          data-testid="dev-persona-picker"
        >
          <FlaskConical className="mr-1 size-5" />
          <span className="text-base">Persona</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Local development: sign in as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEV_PERSONAS.map((persona) => (
          <DropdownMenuItem key={persona.name} asChild>
            <a href={devLoginUrl(persona.name, returnTo)}>
              <span className="flex flex-col">
                <span className="font-medium">{persona.name}</span>
                <span className="text-xs text-muted-foreground">
                  {persona.description}
                </span>
              </span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
