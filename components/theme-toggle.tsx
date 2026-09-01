"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function getThemeToggleAccessibility(resolvedTheme?: string) {
  const isDarkTheme = resolvedTheme === "dark";

  return {
    ariaLabel: `Switch to ${isDarkTheme ? "light" : "dark"} theme`,
    isDarkTheme,
  };
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-10 items-center justify-center rounded-md text-foreground [&_svg]:!size-5 [&_svg]:text-current"
      >
        <Sun aria-hidden="true" />
      </span>
    );
  }

  const { ariaLabel, isDarkTheme } = getThemeToggleAccessibility(resolvedTheme);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800 [&_svg]:!size-5 [&_svg]:text-current"
      onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
      aria-label={ariaLabel}
      aria-pressed={isDarkTheme}
      title={ariaLabel}
    >
      {isDarkTheme ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
