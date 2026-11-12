"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
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
  actorLabel,
  describeRoleChange,
  fetchRoleHistory,
  type RoleHistoryPage,
} from "@/lib/admin-users-api";
import { roleLabel } from "@/lib/access/types";

const HISTORY_PAGE_SIZE = 50;

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

/**
 * The role-change history the API shows the caller (`GET /api/admin/role-history`,
 * `role_audit.read`): a jurisdiction administrator's jurisdiction, a super
 * administrator's every jurisdiction. With `user`, only the changes made to that
 * person (DIAAT-406). Key it by the user so the page starts again for another.
 */
export function RoleHistory({
  user,
  onShowAll,
}: {
  user?: { id: string; email: string } | null;
  /** Offered with `user`: go back to everyone's history. */
  onShowAll?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RoleHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    fetchRoleHistory({
      user: user?.id,
      page,
      pageSize: HISTORY_PAGE_SIZE,
    })
      .then((result) => current && setData(result))
      .catch((err) => current && setError(errorMessage(err)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [page, user?.id]);

  return (
    <section aria-labelledby="role-history-heading" className="space-y-3">
      <h3 id="role-history-heading" className="text-lg font-semibold">
        {user ? `Role change history of ${user.email}` : "Role change history"}
      </h3>
      <p className="text-sm text-muted-foreground">
        Who gave or removed a role, deactivated someone or decided a request,
        newest first.
      </p>
      {user && onShowAll && (
        <Button type="button" variant="outline" size="sm" onClick={onShowAll}>
          Show everyone&apos;s history
        </Button>
      )}
      {error ? (
        <p role="alert" className="py-4 text-destructive">
          {error}
        </p>
      ) : !data ? (
        <div className="flex justify-center py-8" role="status">
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-hidden
          />
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
                  <TableCell>
                    {entry.role ? roleLabel(entry.role) : ""}
                  </TableCell>
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
