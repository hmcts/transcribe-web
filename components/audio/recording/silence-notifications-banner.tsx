"use client";

import { Moon } from "lucide-react";
import useIsMobile from "@/hooks/use-mobile";

/**
 * SilenceNotificationsBanner component
 *
 * A mobile-only banner that reminds users to enable Do Not Disturb mode
 * while recording to avoid interruptions from notifications.
 */
export default function SilenceNotificationsBanner() {
  const isMobile = useIsMobile();

  if (!isMobile) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="Reminder to enable Do Not Disturb mode"
      className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3"
      style={{
        borderColor: "#D8C8FF",
        backgroundColor: "#F4F1FF",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 rounded-full p-2"
          style={{ backgroundColor: "#CABDFF" }}
        >
          <Moon
            className="size-5"
            style={{ color: "#1F1247" }}
            aria-hidden="true"
          />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold" style={{ color: "#1F1247" }}>
            Silence notifications
          </h2>
          <p
            className="mt-0.5 text-sm text-[#362952]"
            style={{ color: "#362952" }}
          >
            Turn on Do Not Disturb while recording.
          </p>
        </div>
      </div>
    </div>
  );
}
