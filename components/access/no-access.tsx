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
  type JurisdictionRef,
  type MeResponse,
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
 * Shown, and nothing else, to a signed-in user with no role (DIAAT-384,
 * DIAAT-396): ask for a jurisdiction and Judge and/or Legal text manager in it,
 * then see "request pending" with the requests and their outcome. Pending ones
 * can be withdrawn. An administrator of that jurisdiction decides.
 */
export function NoAccess({
  me,
  checkAgain,
}: {
  me: MeResponse;
  /** Mint a fresh token now: a decision may have given the user access. */
  checkAgain: () => Promise<MeResponse | null>;
}) {
  const [requests, setRequests] = useState<AccessRequest[]>(me.pending_requests);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionRef[] | null>(null);
  const [jurisdiction, setJurisdiction] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await fetchMyAccessRequests());
    } catch {
      // Keep what `me` listed.
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

  const toggleRole = (role: string, on: boolean) =>
    setRoles((held) => (on ? [...held, role] : held.filter((r) => r !== role)));

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setFailed(null);
    try {
      await createAccessRequest({ jurisdiction, roles });
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

  const withdraw = async (id: string) => {
    try {
      await withdrawAccessRequest(id);
      // Room for another request: an earlier "too many waiting" no longer stands.
      setFailed(null);
      await loadRequests();
    } catch (error) {
      toast.error(message(error, "The request could not be withdrawn."));
    }
  };

  const check = async () => {
    setChecking(true);
    const next = await checkAgain();
    setChecking(false);
    if (!next) toast.error("Could not check just now. Try again.");
    else if (next.status === "no_access") toast.message("Nothing has changed yet.");
    await loadRequests();
  };

  const nameOf = (request: AccessRequest) =>
    request.jurisdiction.name || request.jurisdiction.code;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">
          You do not have access to Bench Notes yet
        </h1>
        <p className="text-lg text-muted-foreground">
          You have signed in, but you have not been added to a jurisdiction. Ask
          for access below. An administrator of that jurisdiction will decide.
        </p>
      </section>

      {pending.length > 0 && (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
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
                    Asked on {when(request.created_at)}. Waiting for an administrator.
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
          <div>
            <Button variant="outline" onClick={check} disabled={checking}>
              {checking ? "Checking..." : "Check again"}
            </Button>
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section aria-labelledby="decided-heading" className="flex flex-col gap-3">
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
                  <p className="text-sm text-muted-foreground">{request.reason}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="request-heading" className="flex flex-col gap-4">
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
                    jurisdictions === null ? "Loading..." : "Choose a jurisdiction"
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
            {REQUESTABLE_ROLES.map((role) => (
              <div key={role.value} className="flex items-start gap-3">
                <Checkbox
                  id={`request-role-${role.value}`}
                  checked={roles.includes(role.value)}
                  onCheckedChange={(on) => toggleRole(role.value, on === true)}
                />
                <Label htmlFor={`request-role-${role.value}`} className="flex flex-col">
                  <span>{role.label}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {role.description}
                  </span>
                </Label>
              </div>
            ))}
          </fieldset>
          {failed && (
            <p role="alert" className="text-destructive">
              {failed}
            </p>
          )}
          <div>
            <Button type="submit" disabled={sending || !jurisdiction || roles.length === 0}>
              {sending ? "Sending..." : "Send request"}
            </Button>
          </div>
        </form>
      </section>

      {pending.length === 0 && (
        <div>
          <Button variant="ghost" onClick={check} disabled={checking}>
            {checking ? "Checking..." : "Check again"}
          </Button>
        </div>
      )}
    </div>
  );
}
