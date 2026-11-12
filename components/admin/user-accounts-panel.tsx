"use client";

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pager } from "@/components/admin/pager";
import { RoleHistory } from "@/components/admin/role-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { errorMessage } from "@/lib/admin-request";
import {
  type AdminUser,
  deactivateUser,
  fetchAdminUsers,
  reactivateUser,
} from "@/lib/admin-users-api";
import { useAccess } from "@/providers/access";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

/**
 * Admin > User accounts (DIAAT-406, `accounts.manage`: the super administrator's).
 * Every account, whatever jurisdictions its roles are in: deactivate or reactivate
 * it (never your own; the API answers 403 `cannot_deactivate_self`), and read the
 * history of its role changes across all jurisdictions. Roles are given elsewhere:
 * jurisdiction administrators under Jurisdictions, the rest by those administrators.
 */
export function UserAccountsPanel() {
  const { me, can } = useAccess();
  const myId = me?.user.id;
  const showHistory = can("role_audit.read");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    items: AdminUser[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyOf, setHistoryOf] = useState<AdminUser | null>(null);
  // Only the latest request may set the list (a slow earlier one must not win).
  const latest = useRef(0);

  useEffect(() => {
    if (searchText === search) return;
    const timer = setTimeout(() => {
      setSearch(searchText);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search]);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminUsers({
        search,
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
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(user: AdminUser, active: boolean) {
    setBusy(true);
    try {
      await (active ? reactivateUser(user.id) : deactivateUser(user.id));
      toast.success(`${active ? "Reactivated" : "Deactivated"} ${user.email}`);
      setConfirming(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (historyOf) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHistoryOf(null)}
        >
          Back to user accounts
        </Button>
        <RoleHistory key={historyOf.id} user={historyOf} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">User accounts</h2>
        <p className="text-sm text-muted-foreground">
          Everyone who uses Bench Notes, in every jurisdiction. A deactivated
          person cannot use it at all until reactivated; their roles are kept.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="accounts-search">Search by email</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="accounts-search"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full max-w-72 pl-8"
            placeholder="Part of an email"
          />
        </div>
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
          <span className="sr-only">Loading user accounts</span>
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
                <TableHead>Status</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((user) => {
                const key = `deactivate:${user.id}`;
                const isMe = user.id === myId;
                return (
                  <TableRow key={`${user.id}:${user.email}`}>
                    <TableCell className="align-top">
                      <div className="font-medium">
                        {user.email}
                        {isMe && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      {user.name && (
                        <div className="text-xs text-muted-foreground">
                          {user.name}
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
                      {user.pending || isMe ? null : confirming === key ? (
                        <span className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={busy}
                            onClick={() => void setActive(user, false)}
                          >
                            Confirm deactivate
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirming(null)}
                          >
                            Keep
                          </Button>
                        </span>
                      ) : user.is_active ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={`Deactivate ${user.email}`}
                          onClick={() => setConfirming(key)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={`Reactivate ${user.email}`}
                          onClick={() => void setActive(user, true)}
                        >
                          Reactivate
                        </Button>
                      )}
                      {showHistory && !user.pending && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-1"
                          aria-label={`Role history of ${user.email}`}
                          onClick={() => setHistoryOf(user)}
                        >
                          Role history
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
    </div>
  );
}
