import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, correctSegment } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isSegmentId } from "@/lib/recording/segment-id";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { jobId, index } = await params;
  if (!isSegmentId(index)) {
    return NextResponse.json({ error: "Invalid segment id" }, { status: 422 });
  }

  const auth = await getBackendAuthContext(request);
  try {
    const { correctedText } = await request.json();
    if (
      typeof correctedText !== "string" ||
      correctedText.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "correctedText is required" },
        { status: 422 }
      );
    }
    const job = await correctSegment(jobId, index, correctedText, auth);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to correct segment", err);
    return NextResponse.json(
      { error: "Failed to save correction" },
      { status: 502 }
    );
  }
}
