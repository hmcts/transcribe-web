import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  mergeSegmentWithNext,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isSegmentId } from "@/lib/recording/segment-id";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId, index } = await params;
  if (!isSegmentId(index)) {
    return NextResponse.json({ error: "Invalid segment id" }, { status: 422 });
  }

  const body: unknown = await request.json().catch(() => null);
  const nextSegmentId =
    body && typeof body === "object" && "nextSegmentId" in body
      ? body.nextSegmentId
      : undefined;
  if (typeof nextSegmentId !== "string" || !isSegmentId(nextSegmentId)) {
    return NextResponse.json(
      { error: "nextSegmentId is required" },
      { status: 422 }
    );
  }

  const auth = await getBackendAuthContext(request);
  try {
    const job = await mergeSegmentWithNext(jobId, index, nextSegmentId, auth);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to combine segments", err);
    return NextResponse.json(
      { error: "Failed to combine segments" },
      { status: 502 }
    );
  }
}
