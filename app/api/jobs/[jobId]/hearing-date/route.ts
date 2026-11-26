import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, setHearingDate } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isHearingDate } from "@/lib/recording/hearing-date";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/** Changes the date of one day of a hearing (DIAAT-428). Body: `{"hearingDate": "YYYY-MM-DD"}`. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const hearingDate =
    body && typeof body === "object"
      ? (body as { hearingDate?: unknown }).hearingDate
      : undefined;
  if (typeof hearingDate !== "string" || !isHearingDate(hearingDate)) {
    return NextResponse.json(
      { error: "hearingDate must be a date, YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const auth = await getBackendAuthContext(request);
  try {
    const hearing = await setHearingDate(jobId, hearingDate, auth);
    return NextResponse.json({ hearing });
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    if (err instanceof BackendApiError) {
      if (err.status === 404 || err.status === 422) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (err.status === 403) {
        return NextResponse.json(
          { error: "The date cannot be changed at the moment." },
          { status: 403 }
        );
      }
    }
    console.error("Failed to change the hearing date", err);
    return NextResponse.json(
      { error: "The date could not be changed. Try again." },
      { status: 502 }
    );
  }
}
