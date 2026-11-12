"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pager, SELECT_CLASS } from "@/components/admin/pager";
import {
  hasTarget,
  NOBODY,
  type PickedUser,
  typedEmail,
  UserPicker,
} from "@/components/admin/user-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { SELF_ASSIGNMENT_NOTE } from "@/lib/access/refusal-messages";
import { fetchAdminJurisdictions } from "@/lib/admin-jurisdictions-api";
import { errorMessage } from "@/lib/admin-request";
import {
  type AdminAssignment,
  type AdminUser,
  actorLabel,
  assignRoles,
  deactivateUser,
  deleteAssignment,
  describeRoleChange,
  fetchAdminRoles,
  fetchAdminUsers,
  fetchRoleHistory,
  reactivateUser,
  type RoleHistoryPage,
} from "@/lib/admin-users-api";
import {
  type JurisdictionRef,
  roleLabel,
} from "@/lib/access/types";
import { useAccess } from "@/providers/access";

/**
 * Admin > Users (DIAAT-385, DIAAT-391, DIAAT-394, DIAAT-374): the people the
 * caller may manage, with their roles in each jurisdiction, and the history of
 * role changes. Which roles can be given or taken away is whatever
 * `GET /api/admin/roles` says; the API refuses the rest, and the screen shows its
 * reason.
 */

const PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;

export const TAKES_EFFECT =
  "A change takes effect for the person within a few minutes, when their session next refreshes. People added by email get their roles when they first sign in.";

function whereLabel(jurisdiction: JurisdictionRef | null): string {
  return jurisdiction ? jurisdiction.code : "All jurisdictions";
}

/** The jurisdictions the caller can work with: the API's list when they may
 * manage jurisdictions, else (or until it loads) the active context's only,
 * never the others the user holds roles in (DIAAT-403). */
function useCallerJurisdictions(): JurisdictionRef[] {
  const { can, active } = useAccess();
  const manage = can("jurisdictions.manage");
  const [listed, setListed] = useState<JurisdictionRef[] | null>(null);
  useEffect(() => {
    if (!manage) return;
    let current = true;
    fetchAdminJurisdictions()
      .then((list) => {
        if (current) {
          setListed(list.map((j) => ({ code: j.code, name: j.name })));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [manage]);
  return listed ?? (active?.jurisdiction ? [active.jurisdiction] : []);
}

export function UsersPanel() {
  const { can } = useAccess();
  const [view, setView] = useState<"people" | "history">("people");
  const showHistory = can("role_audit.read");
  const jurisdictions = useCallerJurisdictions();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">{TAKES_EFFECT}</p>
        </div>
        {showHistory && (
          <div role="group" aria-label="Users view" className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={view === "people" ? "default" : "outline"}
              aria-pressed={view === "people"}
              onClick={() => setView("people")}
            >
              People
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "history" ? "default" : "outline"}
              aria-pressed={view === "history"}
              onClick={() => setView("history")}
            >
              Role history
            </Button>
          </div>
        )}
      </div>
      {view === "history" && showHistory ? (
        <RoleHistorySection jurisdictions={jurisdictions} />
      ) : (
        <PeopleSection jurisdictions={jurisdictions} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleSection({ jurisdictions }: { jurisdictions: JurisdictionRef[] }) {
  const { me } = useAccess();
  const myId = me?.user.id;
  const [roles, setRoles] = useState<string[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    items: AdminUser[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only the latest request may set the list (a slow earlier one must not win).
  const latest = useRef(0);

  useEffect(() => {
    // Only a changed search goes back to the first page.
    if (searchText === search) return;
    const timer = setTimeout(() => {
      setSearch(searchText);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search]);

  useEffect(() => {
    let current = true;
    fetchAdminRoles()
      .then((list) => current && setRoles(list))
      .catch((err) => current && setRolesError(errorMessage(err)));
    return () => {
      current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminUsers({
        search,
        jurisdiction: filter || null,
        page,
        pageSize: PAGE_SIZE,
      });
      if (mine !== latest.current) return;
      setData({ items: result.items, total: result.total });
    } catch (err) {
      if (mine !== latest.current) return;
      setError(errorMessage(err));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [search, filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setConfirming(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <AddRolesForm
        roles={roles}
        rolesError={rolesError}
        jurisdictions={jurisdictions}
        onAdded={load}
      />

      <section aria-labelledby="users-list-heading" className="space-y-3">
        <h3 id="users-list-heading" className="text-lg font-semibold">
          People
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="users-search">Search by email</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="users-search"
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-72 pl-8"
                placeholder="Part of an email"
              />
            </div>
          </div>
          {jurisdictions.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor="users-jurisdiction">Filter by jurisdiction</Label>
              <select
                id="users-jurisdiction"
                className={SELECT_CLASS}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All of mine</option>
                {jurisdictions.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error ? (
          <div role="alert" className="py-4 text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-8" role="status">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-hidden
            />
            <span className="sr-only">Loading users</span>
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {search ? "Nobody matches that search." : "No users yet."}
          </p>
        ) : (
          <>
            <Table aria-busy={loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((user) => (
                  <UserRow
                    key={`${user.id}:${user.email}`}
                    user={user}
                    isMe={user.id === myId}
                    assignable={roles ?? []}
                    confirming={confirming}
                    onConfirming={setConfirming}
                    busy={busy}
                    onRemove={(assignment) =>
                      run(
                        () => deleteAssignment(assignment.id),
                        `Removed ${roleLabel(assignment.role)} from ${user.email}`
                      )
                    }
                    onSetActive={(active) =>
                      run(
                        () =>
                          active
                            ? reactivateUser(user.id)
                            : deactivateUser(user.id),
                        `${active ? "Reactivated" : "Deactivated"} ${user.email}`
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPage={setPage}
              disabled={loading}
            />
          </>
        )}
      </section>
    </div>
  );
}

function UserRow({
  user,
  isMe,
  assignable,
  confirming,
  onConfirming,
  busy,
  onRemove,
  onSetActive,
}: {
  user: AdminUser;
  isMe: boolean;
  /** The roles the API says the caller may assign (and so remove). */
  assignable: string[];
  confirming: string | null;
  onConfirming: (key: string | null) => void;
  busy: boolean;
  onRemove: (assignment: AdminAssignment) => void;
  onSetActive: (active: boolean) => void;
}) {
  const deactivateKey = `deactivate:${user.id}`;
  const canDeactivate = user.assignments.every((a) =>
    assignable.includes(a.role)
  );
  const confirmingAssignment = user.assignments.find(
    (a) => `assignment:${a.id}` === confirming
  );
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium">
          {user.email}
          {isMe && <span className="ml-1 font-normal text-muted-foreground">(you)</span>}
        </div>
        {user.name && (
          <div className="text-xs text-muted-foreground">{user.name}</div>
        )}
      </TableCell>
      <TableCell className="align-top">
        {user.assignments.length === 0 ? (
          <span className="text-sm text-muted-foreground">No roles</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Roles of ${user.email}`}>
            {user.assignments.map((assignment) => {
              const text = `${roleLabel(assignment.role)} in ${whereLabel(assignment.jurisdiction)}`;
              const removable = assignable.includes(assignment.role);
              return (
                <li
                  key={assignment.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs"
                >
                  <span>{text}</span>
                  {removable && (
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-2"
                      aria-label={`Remove ${text} from ${user.email}`}
                      disabled={busy}
                      onClick={() => onConfirming(`assignment:${assignment.id}`)}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {confirmingAssignment && (
          <div
            role="alertdialog"
            aria-label="Confirm removing a role"
            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-sm"
          >
            <span>
              Remove {roleLabel(confirmingAssignment.role)} in{" "}
              {whereLabel(confirmingAssignment.jurisdiction)} from {user.email}?
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onRemove(confirmingAssignment)}
            >
              Remove role
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onConfirming(null)}
            >
              Keep
            </Button>
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        {user.pending ? (
          <Badge variant="outline">Not signed in yet</Badge>
        ) : user.is_active ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="destructive">Deactivated</Badge>
        )}
      </TableCell>
      <TableCell className="text-right align-top">
        {user.pending || isMe ? null : confirming === deactivateKey ? (
          <span className="inline-flex gap-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onSetActive(false)}
            >
              Confirm deactivate
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onConfirming(null)}
            >
              Keep
            </Button>
          </span>
        ) : user.is_active ? (
          // The API refuses (403 `assignment_not_allowed`) to deactivate anyone
          // who holds a role the caller may not assign, so the button is only
          // offered where every role shown is one of `GET /api/admin/roles`.
          canDeactivate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Deactivate ${user.email}`}
              onClick={() => onConfirming(deactivateKey)}
            >
              Deactivate
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Reactivate ${user.email}`}
            onClick={() => onSetActive(true)}
          >
            Reactivate
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Add a user, or add roles to one
// ---------------------------------------------------------------------------

function AddRolesForm({
  roles,
  rolesError,
  jurisdictions,
  onAdded,
}: {
  /** What the API says the caller may assign; null while it loads. */
  roles: string[] | null;
  rolesError: string | null;
  jurisdictions: JurisdictionRef[];
  onAdded: () => Promise<void>;
}) {
  const { active, me, can } = useAccess();
  const [who, setWho] = useState<PickedUser>(NOBODY);
  const [chosen, setChosen] = useState<string[]>([]);
  const [jurisdiction, setJurisdiction] = useState("");
  const [busy, setBusy] = useState(false);
  // An email typed but not added is a change a context switch would lose.
  useJurisdictionSwitchGuard({
    busy,
    unsaved: who.email.trim() !== "" || chosen.length > 0,
  });

  // Where to add to: the working jurisdiction if there is one, else the only
  // one on offer; a global role (no working jurisdiction) must choose.
  const wanted = jurisdiction || active?.jurisdiction?.code || "";
  const target =
    jurisdictions.find((j) => j.code === wanted)?.code ??
    (jurisdictions.length === 1 ? jurisdictions[0].code : "");

  // Nobody gives themselves a role, except the one who holds the permission to
  // appoint super administrators (the API: 403 `assignment_not_allowed`). The
  // person picked, or an email typed, being the caller is known here, so the
  // refusal is not provoked.
  const picksSelf =
    !!me &&
    (who.user
      ? who.user.id === me.user.id
      : typedEmail(who) === me.user.email.trim().toLowerCase());
  const selfBlocked = picksSelf && !can("jurisdiction_super_admin.assign");

  const ready =
    hasTarget(who) && chosen.length > 0 && target !== "" && !busy && !selfBlocked;

  function toggle(role: string, on: boolean) {
    setChosen((current) =>
      on ? [...current, role] : current.filter((r) => r !== role)
    );
  }

  async function submit() {
    setBusy(true);
    try {
      const email = typedEmail(who);
      const to = who.user ? { user_id: who.user.id } : email ? { email } : null;
      if (!to) return;
      const result = await assignRoles(to, target, chosen, picksSelf);
      const name = who.user?.email ?? email;
      if (result.added.length > 0) {
        toast.success(
          `Added ${name} to ${target} as ${result.added.map(roleLabel).join(", ").toLowerCase()}`
        );
      }
      for (const failure of result.failed) {
        toast.error(`${roleLabel(failure.role)} was not added: ${failure.message}`);
      }
      if (result.failed.length === 0) {
        setWho(NOBODY);
        setChosen([]);
      } else {
        // Keep what was refused ticked, so it can be seen and corrected.
        setChosen(result.failed.map((f) => f.role));
      }
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="add-user-heading"
      className="space-y-4 rounded-md border p-4"
    >
      <h3 id="add-user-heading" className="text-lg font-semibold">
        Add a user or give roles
      </h3>
      {rolesError ? (
        <p role="alert" className="text-sm text-destructive">
          {rolesError}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void submit();
          }}
        >
          <div className="flex flex-col items-start gap-4">
            <UserPicker id="add-user" value={who} onChange={setWho} disabled={busy} />
            <div className="flex flex-col gap-1">
              <Label htmlFor="add-jurisdiction">Jurisdiction</Label>
              <select
                id="add-jurisdiction"
                className={SELECT_CLASS}
                value={target}
                disabled={busy}
                onChange={(e) => setJurisdiction(e.target.value)}
              >
                {target === "" && <option value="">Choose one</option>}
                {jurisdictions.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Roles</legend>
            {roles === null ? (
              <p className="text-sm text-muted-foreground">Loading the roles you can give...</p>
            ) : roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You cannot give any roles here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {roles.map((role) => (
                  <div key={role} className="flex items-center gap-2">
                    <Checkbox
                      id={`add-role-${role}`}
                      checked={chosen.includes(role)}
                      disabled={busy}
                      onCheckedChange={(on) => toggle(role, on === true)}
                    />
                    <Label htmlFor={`add-role-${role}`}>{roleLabel(role)}</Label>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          {selfBlocked && (
            <p role="status" className="text-sm text-muted-foreground">
              {SELF_ASSIGNMENT_NOTE}
            </p>
          )}
          <Button type="submit" disabled={!ready}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Role-change history
// ---------------------------------------------------------------------------

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

function RoleHistorySection({
  jurisdictions,
}: {
  jurisdictions: JurisdictionRef[];
}) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RoleHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    fetchRoleHistory({
      jurisdiction: filter || null,
      page,
      pageSize: HISTORY_PAGE_SIZE,
    })
      .then((result) => current && setData(result))
      .catch((err) => current && setError(errorMessage(err)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [filter, page]);

  return (
    <section aria-labelledby="role-history-heading" className="space-y-3">
      <h3 id="role-history-heading" className="text-lg font-semibold">
        Role change history
      </h3>
      <p className="text-sm text-muted-foreground">
        Who gave or removed a role, deactivated someone or decided a request,
        newest first.
      </p>
      {jurisdictions.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor="history-jurisdiction">Filter by jurisdiction</Label>
          <select
            id="history-jurisdiction"
            className={SELECT_CLASS}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All of mine</option>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error ? (
        <p role="alert" className="py-4 text-destructive">
          {error}
        </p>
      ) : !data ? (
        <div className="flex justify-center py-8" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading the history</span>
        </div>
      ) : data.items.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No role changes have been recorded.
        </p>
      ) : (
        <>
          <Table aria-busy={loading}>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Done by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatTime(entry.timestamp)}
                  </TableCell>
                  <TableCell>{describeRoleChange(entry.change)}</TableCell>
                  <TableCell>{entry.target?.email ?? ""}</TableCell>
                  <TableCell>{entry.role ? roleLabel(entry.role) : ""}</TableCell>
                  <TableCell>{entry.jurisdiction ?? ""}</TableCell>
                  <TableCell>
                    {actorLabel(entry)}
                    {entry.actor_context && (
                      <span className="block text-xs text-muted-foreground">
                        as {roleLabel(entry.actor_context.role).toLowerCase()}
                        {entry.actor_context.jurisdiction
                          ? ` in ${entry.actor_context.jurisdiction}`
                          : ""}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={page}
            pageSize={HISTORY_PAGE_SIZE}
            total={data.total}
            onPage={setPage}
            disabled={loading}
          />
        </>
      )}
    </section>
  );
}
