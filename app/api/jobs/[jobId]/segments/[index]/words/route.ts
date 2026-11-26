import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, correctWordRange } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isSegmentId } from "@/lib/recording/segment-id";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

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
  const startWordIndex =
    "startWordIndex" in fields ? fields.startWordIndex : undefined;
  const endWordIndex =
    "endWordIndex" in fields ? fields.endWordIndex : undefined;
  const correctedText =
    "correctedText" in fields ? fields.correctedText : undefined;
  if (
    typeof startWordIndex !== "number" ||
    typeof endWordIndex !== "number" ||
    !Number.isInteger(startWordIndex) ||
    !Number.isInteger(endWordIndex) ||
    startWordIndex < 0 ||
    endWordIndex < 0 ||
    typeof correctedText !== "string" ||
    correctedText.trim().length === 0
  ) {
    return NextResponse.json(
      {
        error: "startWordIndex, endWordIndex and correctedText are required",
      },
      { status: 422 }
    );
  }

  const auth = await getBackendAuthContext(request);
  try {
    const job = await correctWordRange(
      jobId,
      index,
      startWordIndex,
      endWordIndex,
      correctedText,
      auth
    );
    return NextResponse.json({ job });
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to correct word range", err);
    return NextResponse.json(
      { error: "Failed to save correction" },
      { status: 502 }
    );
  }
}
