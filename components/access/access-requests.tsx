"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import {
  createAccessRequest,
  fetchMyAccessRequests,
  fetchPublicJurisdictions,
  withdrawAccessRequest,
} from "@/lib/access/api";
import { describeRefusal } from "@/lib/access/refusal-messages";
import { REQUESTABLE_ROLES } from "@/lib/access/requestable-roles";
import {
  type AccessRequest,
  type Assignment,
  type JurisdictionRef,
  roleLabel,
} from "@/lib/access/types";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const STATUS_TEXT: Record<AccessRequest["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

const message = (error: unknown, fallback: string) =>
  describeRefusal(error, {}, fallback);

/**
 * The user's access requests and the form to make one (DIAAT-384, DIAAT-396,
 * DIAAT-406): a jurisdiction and Judge and/or Legal text manager in it. Pending
 * requests can be withdrawn. An administrator of that jurisdiction decides. For a
 * user who already holds roles (`held`), the roles they hold in the chosen
 * jurisdiction are not offered again (the API would answer 409 `already_assigned`).
 */
export function AccessRequests({
  initial,
  held = [],
  onCheckAgain,
}: {
  initial: AccessRequest[];
  held?: Assignment[];
  /** Offer "Check again": mint a fresh token now, as a decision may have given access. */
  onCheckAgain?: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<AccessRequest[]>(initial);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionRef[] | null>(
    null
  );
  const [jurisdiction, setJurisdiction] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const drafted = jurisdiction !== "" || roles.length > 0;
  // A context switch reloads the tab: not while a request is being sent or
  // withdrawn, nor over a form filled in but not sent.
  useJurisdictionSwitchGuard({
    busy: sending || withdrawing,
    unsaved: drafted,
  });

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await fetchMyAccessRequests());
    } catch {
      // Keep what we had.
    }
  }, []);

  useEffect(() => {
    void loadRequests();
    fetchPublicJurisdictions()
      .then(setJurisdictions)
      .catch(() => setJurisdictions([]));
  }, [loadRequests]);

  const pending = requests.filter((request) => request.status === "pending");
  const decided = requests.filter((request) => request.status !== "pending");
  const heldHere = (role: string) =>
    held.some((a) => a.jurisdiction?.code === jurisdiction && a.role === role);
  const wanted = roles.filter((role) => !heldHere(role));

  const toggleRole = (role: string, on: boolean) =>
    setRoles((chosen) =>
      on ? [...chosen, role] : chosen.filter((r) => r !== role)
    );

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setFailed(null);
    try {
      await createAccessRequest({ jurisdiction, roles: wanted });
      setRoles([]);
      setJurisdiction("");
      await loadRequests();
      toast.success("Request sent");
    } catch (error) {
      setFailed(message(error, "The request could not be sent. Try again."));
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    setJurisdiction("");
    setRoles([]);
    setFailed(null);
  };

  const withdraw = async (id: string) => {
    setWithdrawing(true);
    try {
      await withdrawAccessRequest(id);
      // Room for another request: an earlier "too many waiting" no longer stands.
      setFailed(null);
      await loadRequests();
    } catch (error) {
      toast.error(message(error, "The request could not be withdrawn."));
    } finally {
      setWithdrawing(false);
    }
  };

  const check = async () => {
    if (!onCheckAgain) return;
    setChecking(true);
    await onCheckAgain();
    setChecking(false);
    await loadRequests();
  };

  const nameOf = (request: AccessRequest) =>
    request.jurisdiction.name || request.jurisdiction.code;

  const checkAgainButton = (variant: "outline" | "ghost") =>
    onCheckAgain && (
      <div>
        <Button variant={variant} onClick={check} disabled={checking}>
          {checking ? "Checking..." : "Check again"}
        </Button>
      </div>
    );

  return (
    <>
      {pending.length > 0 && (
        <section
          aria-labelledby="pending-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="pending-heading" className="text-2xl font-semibold">
            Request pending
          </h2>
          <ul className="flex flex-col gap-3">
            {pending.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-4 rounded-md border px-4 py-3"
              >
                <div>
                  <p className="font-medium">
                    {nameOf(request)}: {request.roles.map(roleLabel).join(", ")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Asked on {when(request.created_at)}. Waiting for an
                    administrator.
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`Withdraw request for ${nameOf(request)}`}
                  onClick={() => withdraw(request.id)}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
          {checkAgainButton("outline")}
        </section>
      )}

      {decided.length > 0 && (
        <section
          aria-labelledby="decided-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="decided-heading" className="text-2xl font-semibold">
            Earlier requests
          </h2>
          <ul className="flex flex-col gap-2">
            {decided.map((request) => (
              <li key={request.id} className="rounded-md border px-4 py-3">
                <p className="font-medium">
                  {nameOf(request)}: {request.roles.map(roleLabel).join(", ")}
                  {" - "}
                  {STATUS_TEXT[request.status]}
                </p>
                {request.reason && (
                  <p className="text-sm text-muted-foreground">
                    {request.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="request-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="request-heading" className="text-2xl font-semibold">
          Ask for access
        </h2>
        <form onSubmit={send} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="request-jurisdiction">Jurisdiction</Label>
            <Select value={jurisdiction} onValueChange={setJurisdiction}>
              <SelectTrigger id="request-jurisdiction" className="w-full">
                <SelectValue
                  placeholder={
                    jurisdictions === null
                      ? "Loading..."
                      : "Choose a jurisdiction"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(jurisdictions ?? []).map((j) => (
                  <SelectItem key={j.code} value={j.code}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">What you need</legend>
            {REQUESTABLE_ROLES.map((role) => {
              const already = heldHere(role.value);
              return (
                <div key={role.value} className="flex items-start gap-3">
                  <Checkbox
                    id={`request-role-${role.value}`}
                    checked={already || roles.includes(role.value)}
                    disabled={already}
                    onCheckedChange={(on) =>
                      toggleRole(role.value, on === true)
                    }
                  />
                  <Label
                    htmlFor={`request-role-${role.value}`}
                    className="flex flex-col"
                  >
                    <span>
                      {role.label}
                      {already && " (you have this role there)"}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {role.description}
                    </span>
                  </Label>
                </div>
              );
            })}
          </fieldset>
          {failed && (
            <p role="alert" className="text-destructive">
              {failed}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={sending || !jurisdiction || wanted.length === 0}
            >
              {sending ? "Sending..." : "Send request"}
            </Button>
            {drafted && (
              <Button
                type="button"
                variant="outline"
                disabled={sending}
                onClick={clear}
              >
                Clear
              </Button>
            )}
          </div>
        </form>
      </section>

      {pending.length === 0 && checkAgainButton("ghost")}
    </>
  );
}
