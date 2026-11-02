"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminJurisdiction, JurisdictionAdmin } from "@/lib/admin-api";
import {
  addJurisdictionAdmin,
  createJurisdiction,
  fetchAdminJurisdictions,
  fetchJurisdictionAdmins,
  removeJurisdictionAdmin,
} from "@/lib/admin-api";
import type { AdminUser } from "@/lib/admin-users-api";
import { fetchAdminUsers } from "@/lib/admin-users-api";

// Matches what the API accepts for a jurisdiction id.
const JURISDICTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_JURISDICTION_ID_LENGTH = 64;
const USER_SEARCH_LIMIT = 5;

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

// SystemAdministrator only: create jurisdictions and choose who administers them.
export function JurisdictionsPanel() {
  const [jurisdictions, setJurisdictions] = useState<AdminJurisdiction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJurisdictions = useCallback(async (selectId?: string) => {
    setError(null);
    try {
      const list = await fetchAdminJurisdictions();
      setJurisdictions(list);
      setSelectedId(
        (current) =>
          selectId ??
          (list.some((j) => j.id === current) ? current : (list[0]?.id ?? null))
      );
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to load jurisdictions"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJurisdictions();
  }, [loadJurisdictions]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Jurisdictions</h2>
        <p className="text-sm text-muted-foreground">
          Each jurisdiction has its own document wording, edited only by its
          administrators.
        </p>
      </div>

      <CreateJurisdictionForm onCreated={(id) => loadJurisdictions(id)} />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center text-destructive py-8">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => loadJurisdictions()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="manage-jurisdiction">Administrators of</Label>
          <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
            <SelectTrigger id="manage-jurisdiction" className="max-w-md">
              <SelectValue placeholder="Select a jurisdiction" />
            </SelectTrigger>
            <SelectContent>
              {jurisdictions.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedId && (
            // Keyed so one jurisdiction's administrators never show under another.
            <JurisdictionAdmins key={selectedId} jurisdictionId={selectedId} />
          )}
        </div>
      )}
    </div>
  );
}

function CreateJurisdictionForm({
  onCreated,
}: {
  onCreated: (id: string) => Promise<void>;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) {
      toast.error("ID and Name are required");
      return;
    }
    if (
      trimmedId.length > MAX_JURISDICTION_ID_LENGTH ||
      !JURISDICTION_ID_PATTERN.test(trimmedId)
    ) {
      toast.error(
        "ID may only use lowercase letters, numbers, hyphens and underscores"
      );
      return;
    }
    setCreating(true);
    try {
      const created = await createJurisdiction({
        id: trimmedId,
        name: trimmedName,
      });
      toast.success(`Created "${created.name}"`);
      setId("");
      setName("");
      await onCreated(created.id);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to create jurisdiction"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">New jurisdiction</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-jurisdiction-id">ID</Label>
          <p className="text-xs text-muted-foreground">
            Used in links, e.g. tax. Cannot be changed later.
          </p>
          <Input
            id="new-jurisdiction-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-jurisdiction-name">Name</Label>
          <p className="text-xs text-muted-foreground">
            Shown to judges, e.g. Tax Tribunal.
          </p>
          <Input
            id="new-jurisdiction-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <Button size="sm" onClick={handleCreate} disabled={creating}>
        {creating ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-1.5 h-4 w-4" />
        )}
        Create jurisdiction
      </Button>
    </div>
  );
}

function JurisdictionAdmins({ jurisdictionId }: { jurisdictionId: string }) {
  const [admins, setAdmins] = useState<JurisdictionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUser[] | null>(null);
  // A search or load that finishes after the panel has gone is dropped.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mutations on different users can overlap, so their refreshes can finish out
  // of order. Only the latest load may update the list, the error and the
  // loading state; bumping the counter also retires loads in flight when the
  // jurisdiction changes or the panel goes away.
  const loadGenerationRef = useRef(0);

  const loadAdmins = useCallback(async () => {
    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    const isCurrent = () =>
      mountedRef.current && generation === loadGenerationRef.current;
    setError(null);
    try {
      const list = await fetchJurisdictionAdmins(jurisdictionId);
      if (isCurrent()) setAdmins(list);
    } catch (err: unknown) {
      if (isCurrent()) {
        setError(errorMessage(err, "Failed to load administrators"));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [jurisdictionId]);

  useEffect(() => {
    loadAdmins();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadAdmins]);

  async function handleSearch() {
    if (!searchInput.trim()) return;
    setSearching(true);
    try {
      const data = await fetchAdminUsers(1, USER_SEARCH_LIMIT, searchInput);
      if (mountedRef.current) setResults(data.items);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to search users"));
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  }

  async function handleAssign(user: AdminUser) {
    setBusyUserId(user.id);
    try {
      await addJurisdictionAdmin(jurisdictionId, user.id);
      toast.success(`Assigned ${user.email}`);
      await loadAdmins();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to assign administrator"));
    } finally {
      if (mountedRef.current) setBusyUserId(null);
    }
  }

  async function handleRemove(admin: JurisdictionAdmin) {
    setBusyUserId(admin.user_id);
    try {
      await removeJurisdictionAdmin(jurisdictionId, admin.user_id);
      toast.success(`Removed ${admin.email}`);
      await loadAdmins();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to remove administrator"));
    } finally {
      if (mountedRef.current) setBusyUserId(null);
    }
  }

  const assignedIds = new Set(admins.map((a) => a.user_id));

  return (
    <div className="space-y-4 pt-2">
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center text-destructive py-4">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={loadAdmins}
          >
            Retry
          </Button>
        </div>
      ) : admins.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No administrators yet.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.user_id}>
                  <TableCell className="font-medium">{admin.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {admin.role}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40"
                      disabled={busyUserId === admin.user_id}
                      onClick={() => handleRemove(admin)}
                      aria-label={`Remove ${admin.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-2 rounded-md border p-4">
        <h3 className="font-medium">Add an administrator</h3>
        <p className="text-xs text-muted-foreground">
          The person must have signed in once and hold the Legal Text Manager
          role to reach the editor.
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by email..."
            aria-label="Search users by email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            className="max-w-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearch}
            disabled={searching}
          >
            Search
          </Button>
        </div>
        {results &&
          (results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {results.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="text-sm">
                    <span className="font-medium">{user.email}</span>{" "}
                    <span className="text-muted-foreground">({user.role})</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      assignedIds.has(user.id) || busyUserId === user.id
                    }
                    onClick={() => handleAssign(user)}
                  >
                    {assignedIds.has(user.id) ? "Assigned" : "Assign"}
                  </Button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}
