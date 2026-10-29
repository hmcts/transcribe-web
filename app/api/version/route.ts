import { NextResponse } from "next/server";

import { appVersion } from "@/lib/app-version";

// Served as GET /api/version (Caddy's @next_api matcher).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ version: appVersion() });
}
