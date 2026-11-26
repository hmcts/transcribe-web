import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  deleteHearing,
  getHearing,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

interface RouteContext {
  params: Promise<{ hearingId: string }>;
}

const NOT_FOUND = { error: "Hearing not found" };

/** The hearing and every day of it, each with its transcript (DIAAT-428). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { hearingId } = await params;
  const auth = await getBackendAuthContext(request);
  try {
    const hearing = await getHearing(hearingId, auth);
    if (!hearing) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ hearing });
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    console.error("Failed to load hearing", err);
    return NextResponse.json(
      { error: "Failed to load transcription job" },
      { status: 502 }
    );
  }
}

/**
 * Deletes every day of the hearing, then the hearing. When a day could not be
 * deleted the API keeps it, with the hearing, and answers 502: the delete can
 * be repeated for what is left.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { hearingId } = await params;
  const auth = await getBackendAuthContext(request);
  try {
    await deleteHearing(hearingId, auth);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    if (
      err instanceof BackendApiError &&
      (err.status === 404 || err.status === 422)
    ) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    console.error("Failed to delete hearing", err);
    return NextResponse.json(
      {
        error:
          "Not every recording of this hearing could be deleted. Try again.",
      },
      { status: 502 }
    );
  }
}
