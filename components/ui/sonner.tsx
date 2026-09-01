"use client";

import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      duration={10_000}
      closeButton
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:!bg-foreground group-[.toaster]:!text-background group-[.toaster]:!border-foreground/20 group-[.toaster]:shadow-lg group-[.toaster]:items-start group-[.toaster]:text-base",
          description: "group-[.toast]:!text-background/70",
          actionButton:
            "group-[.toast]:!bg-background group-[.toast]:!text-foreground",
          cancelButton:
            "group-[.toast]:!bg-background/20 group-[.toast]:!text-background",
          icon: "!h-[1em] !w-[1em] !pt-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
