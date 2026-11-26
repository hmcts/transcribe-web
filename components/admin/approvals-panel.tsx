"use client";

import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import {
  decideRequest,
  fetchPendingRequests,
  type PendingAccessRequest,
} from "@/lib/admin-access-requests-api";
import { errorMessage } from "@/lib/admin-request";
import { OWN_REQUEST_NOTE } from "@/lib/access/refusal-messages";
import { roleLabel } from "@/lib/access/types";
import { cn } from "@/lib/utils";
import { useAccess } from "@/providers/access";

/**
 * Admin > Approvals (DIAAT-396, DIAAT-398): the requests waiting for the
 * caller's decision. The API returns the requests of the jurisdictions the caller
 * may approve, and refuses a decision for any other.
 *
 * The link in the notification email is `/admin?tab=approvals&request=<id>`: it
 * carries only the request's id and grants nothing. The queue opens, and that
 * request is highlighted if it is among the caller's pending ones; if it is not
 * (already decided, withdrawn, or for a jurisdiction the caller does not
 * approve), the panel says so, which does not tell the caller anything about it.
 */

function formatTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ApprovalsPanel({
  highlightRequestId,
}: {
  highlightRequestId?: string | null;
}) {
  const { me } = useAccess();
  const myId = me?.user.id;
  const [requests, setRequests] = useState<PendingAccessRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // What was decided on this screen, so a linked request that was just decided
  // here is not then reported as missing.
  const [decided, setDecided] = useState<Record<string, "approve" | "reject">>({});
  const highlighted = useRef<HTMLLIElement | null>(null);
  const typedReason = Object.values(reasons).some((r) => r.trim() !== "");
  useJurisdictionSwitchGuard({ busy: busy !== null, unsaved: typedReason });

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await fetchPendingRequests());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const found =
    !!highlightRequestId && !!requests?.some((r) => r.id === highlightRequestId);
  useEffect(() => {
    if (found) {
      highlighted.current?.scrollIntoView?.({ block: "center" });
    }
  }, [found]);

  async function decide(
    request: PendingAccessRequest,
    decision: "approve" | "reject"
  ) {
    setBusy(request.id);
    try {
      await decideRequest(request.id, decision, reasons[request.id] ?? "");
      toast.success(
        `${decision === "approve" ? "Approved" : "Rejected"} the request from ${request.requester.email}`
      );
      setDecided((d) => ({ ...d, [request.id]: decision }));
      setRequests((current) =>
        (current ?? []).filter((r) => r.id !== request.id)
      );
      setReasons(({ [request.id]: _gone, ...rest }) => rest);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Approvals</h2>
        <p className="text-sm text-muted-foreground">
          People asking for a role in a jurisdiction. Approving gives them exactly
          the roles asked for; it takes effect within a few minutes, when their
          session next refreshes. They can read your reason, if you give one.
        </p>
      </div>

      {highlightRequestId && decided[highlightRequestId] && (
        <p role="status" className="rounded-md border p-3 text-sm">
          You {decided[highlightRequestId] === "approve" ? "approved" : "rejected"}{" "}
          that request.
        </p>
      )}
      {highlightRequestId && requests && !found && !decided[highlightRequestId] && (
        <p role="status" className="rounded-md border p-3 text-sm">
          That request is not waiting for your decision. It may already have been
          decided or withdrawn, or it may be for a jurisdiction you do not
          approve for.
        </p>
      )}

      {error ? (
        <div role="alert" className="py-4 text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : requests === null ? (
        <div className="flex justify-center py-8" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading requests</span>
        </div>
      ) : requests.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No requests are waiting.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Requests waiting for a decision">
          {requests.map((request) => {
            const isHighlighted = request.id === highlightRequestId;
            // The API refuses (403 `own_request`) to let anyone decide their own
            // request, so it is shown with the reason instead of the buttons.
            const isOwn = !!myId && request.requester.id === myId;
            return (
              <li
                key={request.id}
                ref={isHighlighted ? highlighted : undefined}
                data-request-id={request.id}
                data-highlighted={isHighlighted ? "true" : undefined}
                aria-current={isHighlighted ? "true" : undefined}
                className={cn(
                  "space-y-3 rounded-md border p-4",
                  isHighlighted && "border-primary ring-2 ring-primary"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {request.requester.name || request.requester.email}
                    </p>
                    {request.requester.name && (
                      <p className="text-sm text-muted-foreground">
                        {request.requester.email}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Asked {formatTime(request.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <span>
                    Wants to work in <strong>{request.jurisdiction.name}</strong> as
                  </span>
                  {request.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {roleLabel(role)}
                    </Badge>
                  ))}
                </div>
                {isOwn ? (
                  <p
                    className="rounded-md bg-muted p-3 text-sm"
                    data-own-request="true"
                  >
                    {OWN_REQUEST_NOTE}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`reason-${request.id}`}>
                        Reason (optional)
                      </Label>
                      <Input
                        id={`reason-${request.id}`}
                        value={reasons[request.id] ?? ""}
                        onChange={(e) =>
                          setReasons((r) => ({ ...r, [request.id]: e.target.value }))
                        }
                        className="w-72"
                        maxLength={500}
                        disabled={busy !== null}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={`Approve the request from ${request.requester.email}`}
                      onClick={() => void decide(request, "approve")}
                    >
                      <Check className="mr-1 h-4 w-4" aria-hidden />
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      aria-label={`Reject the request from ${request.requester.email}`}
                      onClick={() => void decide(request, "reject")}
                    >
                      <X className="mr-1 h-4 w-4" aria-hidden />
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
