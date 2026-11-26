import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, rollbackSegment } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isSegmentId } from "@/lib/recording/segment-id";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId, index } = await params;
  if (!isSegmentId(index)) {
    return NextResponse.json({ error: "Invalid segment id" }, { status: 422 });
  }

  const auth = await getBackendAuthContext(request);
  try {
    const job = await rollbackSegment(jobId, index, auth);
    return NextResponse.json({ job });
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to roll back segment", err);
    return NextResponse.json(
      { error: "Failed to roll back segment" },
      { status: 502 }
    );
  }
}
