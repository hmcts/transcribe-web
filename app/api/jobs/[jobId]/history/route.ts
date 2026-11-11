import { type NextRequest, NextResponse } from "next/server";
import {
  CONTEXT_CHANGED,
  CONTEXT_REQUIRED,
  USER_DEACTIVATED,
} from "@/lib/access/refusals";
import { BackendApiError, getJobHistory } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

const IDENTITY_REFUSALS = new Set([
  CONTEXT_CHANGED,
  CONTEXT_REQUIRED,
  USER_DEACTIVATED,
]);

function isIdentityRefusal(err: BackendApiError): boolean {
  return (
    err.status === 401 ||
    (err.code !== undefined && IDENTITY_REFUSALS.has(err.code))
  );
}

function numberParam(value: string | null): number | undefined {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * A recording's audit history (DIAAT-395), for the Judge who owns it: who did
 * what to it, when, and how it ended. The API checks `recording.audit.read` and
 * ownership; for anyone else it answers as for a recording they cannot see, and
 * this passes that status on.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const auth = await getBackendAuthContext(request);
  const search = request.nextUrl.searchParams;
  try {
    const history = await getJobHistory(
      jobId,
      {
        page: numberParam(search.get("page")),
        pageSize: numberParam(search.get("page_size")),
      },
      auth
    );
    return NextResponse.json(history);
  } catch (err) {
    // Refusals about who the user is, not about this recording: passed on with their
    // status and code, so the browser's refusal watcher can show the stale-tab or account
    // notice (a 409 `context_changed`, a 403 `context_required` or `user_deactivated`, a 401).
    if (err instanceof BackendApiError && isIdentityRefusal(err)) {
      return NextResponse.json(
        { detail: { code: err.code, message: "Your access has changed." } },
        { status: err.status }
      );
    }
    // Anything else the API refuses (403) or cannot find (404) is, to this user, a
    // recording that is not there.
    if (
      err instanceof BackendApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("Failed to load job history", err);
    return NextResponse.json(
      { error: "Failed to load the history" },
      { status: 502 }
    );
  }
}
