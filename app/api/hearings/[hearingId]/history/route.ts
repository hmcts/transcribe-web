import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, getHearingHistory } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

interface RouteContext {
  params: Promise<{ hearingId: string }>;
}

function numberParam(value: string | null): number | undefined {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * A hearing's audit history (DIAAT-428): as /api/jobs/{id}/history, for the
 * hearing and every day of it, each row naming its day (`job_id`).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { hearingId } = await params;
  const auth = await getBackendAuthContext(request);
  const search = request.nextUrl.searchParams;
  try {
    const history = await getHearingHistory(
      hearingId,
      {
        page: numberParam(search.get("page")),
        pageSize: numberParam(search.get("page_size")),
      },
      auth
    );
    return NextResponse.json(history);
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    if (
      err instanceof BackendApiError &&
      (err.status === 403 || err.status === 404 || err.status === 422)
    ) {
      return NextResponse.json({ error: "Hearing not found" }, { status: 404 });
    }
    console.error("Failed to load hearing history", err);
    return NextResponse.json(
      { error: "Failed to load the history" },
      { status: 502 }
    );
  }
}
