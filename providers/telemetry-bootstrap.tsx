"use client";

import { useEffect } from "react";
import { startBrowserTelemetry } from "@/lib/dictation-session";

/** Starts browser telemetry delivery on every page, not just the record page. */
export default function TelemetryBootstrap() {
  useEffect(() => startBrowserTelemetry(), []);
  return null;
}
