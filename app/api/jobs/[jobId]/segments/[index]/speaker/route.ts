import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, renameSpeaker } from "@/lib/recording/api-client";
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

  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? body : {};
  const speaker = "speaker" in fields ? fields.speaker : undefined;
  const applyToAll = "applyToAll" in fields ? fields.applyToAll : undefined;
  if (typeof speaker !== "string" || speaker.trim().length === 0) {
    return NextResponse.json({ error: "speaker is required" }, { status: 422 });
  }

  const auth = await getBackendAuthContext(request);
  try {
    const job = await renameSpeaker(
      jobId,
      index,
      speaker,
      applyToAll === true,
      auth
    );
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to rename speaker", err);
    return NextResponse.json(
      { error: "Failed to rename speaker" },
      { status: 502 }
    );
  }
}
