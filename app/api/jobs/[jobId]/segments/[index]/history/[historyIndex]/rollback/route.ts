import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  rollbackToHistoryEntry,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isSegmentId } from "@/lib/recording/segment-id";

interface RouteContext {
  params: Promise<{ jobId: string; index: string; historyIndex: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId, index, historyIndex } = await params;
  const targetHistoryIndex = Number(historyIndex);
  if (
    !isSegmentId(index) ||
    !Number.isInteger(targetHistoryIndex) ||
    targetHistoryIndex < 0
  ) {
    return NextResponse.json(
      { error: "Invalid segment id or history index" },
      { status: 422 }
    );
  }

  const auth = await getBackendAuthContext(request);
  try {
    const job = await rollbackToHistoryEntry(
      jobId,
      index,
      targetHistoryIndex,
      auth
    );
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to roll back to history entry", err);
    return NextResponse.json(
      { error: "Failed to roll back to history entry" },
      { status: 502 }
    );
  }
}
