"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  type AdminJurisdiction,
  type AdminJurisdictionMember,
  addJurisdictionMember,
  fetchAdminJurisdictions,
  fetchJurisdictionMembers,
  fetchWordingKeys,
  MEMBER_ROLES,
  removeJurisdictionMember,
  saveJurisdiction,
} from "@/lib/admin-jurisdictions-api";

/**
 * Jurisdictions and their members (DIAAT-356), for SystemAdministrators: what
 * used to need a command on the server. A jurisdiction's wording, template and
 * hearing recordings are its settings; its members are added by sign-in email,
 * before or after they first sign in.
 */

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

export function JurisdictionsPanel() {
  const [jurisdictions, setJurisdictions] = useState<AdminJurisdiction[]>([]);
  const [wordingKeys, setWordingKeys] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Bumped to reopen the editor from the server's copy, dropping unsaved edits.
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, keys] = await Promise.all([fetchAdminJurisdictions(), fetchWordingKeys()]);
      setJurisdictions(list);
      setWordingKeys(keys);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // After a change: the list only, in place, so nothing open is remounted and no
  // unsaved edit is lost.
  const refresh = useCallback(async () => {
    try {
      setJurisdictions(await fetchAdminJurisdictions());
    } catch (err) {
      toast.error(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = jurisdictions.find((j) => j.code === selected) ?? null;

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading jurisdictions</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center text-destructive py-8">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Jurisdictions</h2>
          <p className="text-sm text-muted-foreground">
            Who works in each jurisdiction, and what it shows them.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add jurisdiction
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jurisdictions.map((j) => (
              <TableRow
                key={j.code}
                className={j.code === selected ? "bg-muted/60" : undefined}
              >
                <TableCell className="font-medium">
                  <button
                    type="button"
                    aria-current={j.code === selected ? "true" : undefined}
                    className="underline-offset-2 hover:underline"
                    onClick={() => {
                      setSelected(j.code);
                      setCreating(false);
                    }}
                  >
                    {j.code}
                  </button>
                </TableCell>
                <TableCell>{j.name}</TableCell>
                <TableCell>{j.member_count}</TableCell>
                <TableCell className="space-x-1">
                  <Badge variant={j.enabled ? "default" : "secondary"}>
                    {j.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {j.auto_enrol && <Badge variant="outline">New users join</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {(creating || current) && (
        <JurisdictionEditor
          key={`${creating ? "new" : current?.code}:${editorGeneration}`}
          jurisdiction={creating ? null : current}
          existingCodes={jurisdictions.map((j) => j.code)}
          wordingKeys={wordingKeys}
          onDiscard={async () => {
            await refresh();
            setEditorGeneration((g) => g + 1);
          }}
          onSaved={async (code) => {
            setCreating(false);
            setSelected(code);
            await refresh();
          }}
        />
      )}
      {current && !creating && (
        <MembersEditor key={current.code} code={current.code} onChanged={refresh} />
      )}
    </div>
  );
}

function JurisdictionEditor({
  jurisdiction,
  existingCodes,
  wordingKeys,
  onSaved,
  onDiscard,
}: {
  jurisdiction: AdminJurisdiction | null;
  existingCodes: string[];
  wordingKeys: Record<string, string>;
  onSaved: (code: string) => Promise<void>;
  /** Reopen from the server's copy (after a 409, say). */
  onDiscard: () => Promise<void>;
}) {
  const settings = jurisdiction?.settings ?? {};
  const [code, setCode] = useState(jurisdiction?.code ?? "");
  const [name, setName] = useState(jurisdiction?.name ?? "");
  const [enabled, setEnabled] = useState(jurisdiction?.enabled ?? true);
  const [autoEnrol, setAutoEnrol] = useState(jurisdiction?.auto_enrol ?? false);
  const [template, setTemplate] = useState<string>(settings.template ?? "none");
  const [recordings, setRecordings] = useState(
    settings.features?.hearing_recordings ?? false
  );
  const [wording, setWording] = useState<Record<string, string>>(settings.wording ?? {});
  const [saving, setSaving] = useState(false);
  // The version this form was opened from, not the list's latest: a change made
  // meanwhile (even one a refresh has since shown) is refused, not overwritten.
  const [version, setVersion] = useState(jurisdiction?.version ?? "");

  // DIAAT-332: a switch reloads the tab, losing changes not saved, or a save under way.
  const form = JSON.stringify({ code, name, enabled, autoEnrol, template, recordings, wording });
  const [savedForm, setSavedForm] = useState(form);
  useJurisdictionSwitchGuard({ busy: saving, unsaved: form !== savedForm });

  // Saving creates or replaces: adding one with an existing code would overwrite it.
  const duplicate =
    !jurisdiction && existingCodes.includes(code.trim().toUpperCase());

  async function save() {
    if (duplicate) return;
    setSaving(true);
    try {
      const saved = await saveJurisdiction(code, {
        name,
        enabled,
        auto_enrol: autoEnrol,
        settings: {
          // Only the keys this release knows (a stored one it no longer knows would
          // be refused); blank lines use the default wording.
          wording: Object.fromEntries(
            Object.entries(wording).filter(
              ([key, text]) => key in wordingKeys && text.trim()
            )
          ),
          template: template === "iac_decision" ? "iac_decision" : null,
          features: { hearing_recordings: recordings },
        },
        version,
      });
      setVersion(saved.version);
      setSavedForm(form);
      toast.success(`Saved ${saved.code}`);
      await onSaved(saved.code);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-md border p-4" aria-labelledby="jurisdiction-editor">
      <h3 id="jurisdiction-editor" className="text-lg font-semibold">
        {jurisdiction ? `Edit ${jurisdiction.code}` : "Add a jurisdiction"}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="jurisdiction-code">Code</Label>
          <Input
            id="jurisdiction-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!jurisdiction}
            placeholder="ET"
            maxLength={16}
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate ? "jurisdiction-code-taken" : undefined}
          />
          {duplicate && (
            <p id="jurisdiction-code-taken" className="text-sm text-destructive">
              {code.trim().toUpperCase()} already exists. Choose it in the list to edit it.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="jurisdiction-name">Name</Label>
          <Input
            id="jurisdiction-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Employment Tribunal"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="jurisdiction-template">Template</Label>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger id="jurisdiction-template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None: general section, copy the text out</SelectItem>
              <SelectItem value="iac_decision">IAC decision</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 pt-6">
          <CheckboxField id="jurisdiction-enabled" label="Enabled" checked={enabled} onChange={setEnabled} />
          <CheckboxField
            id="jurisdiction-recordings"
            label="Uses hearing recordings"
            checked={recordings}
            onChange={setRecordings}
          />
          <CheckboxField
            id="jurisdiction-auto-enrol"
            label="New users join it on first sign-in"
            checked={autoEnrol}
            onChange={setAutoEnrol}
          />
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Screen wording (blank: the default)
        </summary>
        <div className="mt-3 space-y-3">
          {Object.entries(wordingKeys).map(([key, description]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`wording-${key}`}>{description}</Label>
              <Input
                id={`wording-${key}`}
                value={wording[key] ?? ""}
                onChange={(e) => setWording((w) => ({ ...w, [key]: e.target.value }))}
                maxLength={500}
              />
            </div>
          ))}
        </div>
      </details>

      <Button
        onClick={() => void save()}
        disabled={saving || duplicate || !code.trim() || !name.trim()}
      >
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
        Save
      </Button>
      {jurisdiction && (
        <Button variant="ghost" className="ml-2" onClick={() => void onDiscard()} disabled={saving}>
          Discard changes
        </Button>
      )}
    </section>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function MembersEditor({ code, onChanged }: { code: string; onChanged: () => Promise<void> }) {
  const [members, setMembers] = useState<AdminJurisdictionMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminJurisdictionMember["role"]>("judge");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // An email typed but not added yet is a change a switch would lose.
  useJurisdictionSwitchGuard({ busy, unsaved: email.trim() !== "" });

  const load = useCallback(async () => {
    try {
      setMembers(await fetchJurisdictionMembers(code));
    } catch (err) {
      toast.error(message(err));
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    try {
      const existing = members.find((m) => m.email === email.trim().toLowerCase());
      const added = await addJurisdictionMember(code, email.trim(), role);
      toast.success(
        existing
          ? `${added.email} is now ${added.role === "admin" ? "an admin" : "a judge"} in ${code}`
          : added.pending
            ? `Added ${added.email}. They join ${code} when they first sign in.`
            : `Added ${added.email} to ${code}`
      );
      setEmail("");
      await load();
      await onChanged();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberEmail: string) {
    setBusy(true);
    try {
      await removeJurisdictionMember(code, memberEmail);
      toast.success(`Removed ${memberEmail} from ${code}`);
      setRemoving(null);
      await load();
      await onChanged();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-md border p-4" aria-labelledby="jurisdiction-members">
      <h3 id="jurisdiction-members" className="text-lg font-semibold">
        Members of {code}
      </h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="member-email">Sign-in email</Label>
          <Input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="first.last@justice.gov.uk"
            className="w-72"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="member-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AdminJurisdictionMember["role"])}>
            <SelectTrigger id="member-role" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r === "judge" ? "Judge" : "Admin"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={busy || !email.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add member
        </Button>
      </form>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Signed in</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.email}>
                <TableCell className="font-medium">{m.email}</TableCell>
                <TableCell>{m.role === "admin" ? "Admin" : "Judge"}</TableCell>
                <TableCell>
                  {m.pending ? <Badge variant="outline">Not yet</Badge> : "Yes"}
                </TableCell>
                <TableCell className="text-right">
                  {removing === m.email ? (
                    <Button variant="destructive" size="sm" onClick={() => void remove(m.email)}>
                      Confirm remove
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setRemoving(m.email)}
                      aria-label={`Remove ${m.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
