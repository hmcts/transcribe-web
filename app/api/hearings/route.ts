import { type NextRequest, NextResponse } from "next/server";
import { listHearings } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

/** The user's hearings (DIAAT-428), one summary each with its days: no transcripts. */
export async function GET(request: NextRequest) {
  const auth = await getBackendAuthContext(request);
  try {
    const result = await listHearings(undefined, auth);
    return NextResponse.json(result);
  } catch (err) {
    const refusal = identityRefusalResponse(err);
    if (refusal) return refusal;
    console.error("Failed to list hearings", err);
    return NextResponse.json(
      { error: "Failed to load transcription jobs" },
      { status: 502 }
    );
  }
}
