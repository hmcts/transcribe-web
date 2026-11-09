"use client";

import { Loader2, Plus, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RoleHolders } from "@/components/admin/role-holders";
import {
  type EditorState,
  IDLE,
  TemplatesEditor,
} from "@/components/admin/templates-editor";
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
  fetchAdminJurisdictions,
  fetchWordingKeys,
  STAGES,
  saveJurisdiction,
} from "@/lib/admin-jurisdictions-api";
import { type JurisdictionStage, stageNote } from "@/lib/jurisdiction-api";
import { JURISDICTION_ADMINISTRATOR } from "@/lib/access/assignable-roles";
import { fetchPublicJurisdictions } from "@/lib/access/api";
import { describeRefusal } from "@/lib/access/refusal-messages";
import { useAccess } from "@/providers/access";

/**
 * Jurisdictions (DIAAT-356, DIAAT-394), shown by permission:
 *  - `jurisdictions.manage`: each jurisdiction's settings (name, template, hearing
 *    recordings, screen wording), for the ones the API lists for the caller;
 *  - `jurisdiction.create`: adding a jurisdiction;
 *  - `jurisdiction_admin.assign`: who administers each jurisdiction. That is a
 *    role assignment like any other (given by sign-in email, or to someone who has
 *    signed in), not a setting of the jurisdiction.
 * Someone who holds only the last sees the jurisdictions' names (the public list)
 * and the administrators, and none of the settings.
 *
 * DIAAT-345: a new jurisdiction is a draft only its administrators see. Moved to test,
 * its test group sees it too; live, everyone with a role there. It leaves draft only
 * when it is ready, and the editor lists what is missing. That needs an API that knows
 * stages: until it reports them the panel offers none of it.
 * DIAAT-344: a jurisdiction's Word templates are edited under it (with
 * `templates.manage`), for whoever picks a jurisdiction here.
 */

const message = (error: unknown, savingJurisdiction = false) =>
  describeRefusal(error, { savingJurisdiction });

export function JurisdictionsPanel() {
  const { can } = useAccess();
  const canManage = can("jurisdictions.manage");
  const canCreate = can("jurisdiction.create");
  const canAssign = can("jurisdiction_admin.assign");
  // The admin list is behind manage (or create); without them, the names only.
  const adminList = canManage || canCreate;
  const [jurisdictions, setJurisdictions] = useState<AdminJurisdiction[]>([]);
  const [wordingKeys, setWordingKeys] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Bumped to reopen the editor from the server's copy, dropping unsaved edits.
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [creating, setCreating] = useState(false);
  // DIAAT-344: the open jurisdiction's templates. Leaving it (another row, or Add
  // jurisdiction) closes them: not while a change is under way, and only once the
  // admin agrees to drop unsaved edits.
  const [templatesState, setTemplatesState] = useState<EditorState>(IDLE);
  const mayLeaveTemplates = () =>
    !templatesState.unsaved ||
    window.confirm("Discard your unsaved changes to this jurisdiction's template?");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (adminList) {
        const [list, keys] = await Promise.all([
          fetchAdminJurisdictions(),
          canManage ? fetchWordingKeys() : Promise.resolve({}),
        ]);
        setJurisdictions(list);
        setWordingKeys(keys);
      } else {
        setJurisdictions(namesOnly(await fetchPublicJurisdictions()));
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, [adminList, canManage]);

  // After a change: the list only, in place, so nothing open is remounted and no
  // unsaved edit is lost.
  const refresh = useCallback(async () => {
    if (!adminList) return;
    try {
      setJurisdictions(await fetchAdminJurisdictions());
    } catch (err) {
      toast.error(message(err));
    }
  }, [adminList]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = jurisdictions.find((j) => j.code === selected) ?? null;
  // The API reports every jurisdiction's stage once it enforces stages.
  const stagesSupported =
    jurisdictions.length > 0 && jurisdictions.every((j) => j.stage !== undefined);

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
            {canManage
              ? "What each jurisdiction shows, and who administers it."
              : "Who administers each jurisdiction."}
          </p>
        </div>
        {canCreate && (
          <Button
            size="sm"
            disabled={templatesState.busy}
            onClick={() => {
              if (!mayLeaveTemplates()) return;
              setCreating(true);
              setSelected(null);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add jurisdiction
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              {canManage && <TableHead>Users</TableHead>}
              {canManage && <TableHead>Status</TableHead>}
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
                    className="underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
                    disabled={templatesState.busy && j.code !== selected}
                    onClick={() => {
                      if (j.code !== selected && !mayLeaveTemplates()) return;
                      setSelected(j.code);
                      setCreating(false);
                    }}
                  >
                    {j.code}
                  </button>
                </TableCell>
                <TableCell>
                  {(stagesSupported && j.display_name) || j.name}
                  {stagesSupported && j.service && (
                    <span className="block text-xs text-muted-foreground">{j.service}</span>
                  )}
                </TableCell>
                {canManage && <TableCell>{j.member_count}</TableCell>}
                {canManage && (
                  <TableCell className="space-x-1">
                    <Badge variant={j.enabled ? "default" : "secondary"}>
                      {j.enabled ? (stagesSupported && stageNote(j.stage)) || "Live" : "Disabled"}
                    </Badge>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (creating || current) && (
        <JurisdictionEditor
          key={`${creating ? "new" : current?.code}:${editorGeneration}`}
          jurisdiction={creating ? null : current}
          canRename={canCreate}
          existingCodes={jurisdictions.map((j) => j.code)}
          wordingKeys={wordingKeys}
          stagesSupported={stagesSupported}
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
      {canAssign && current && !creating && (
        <RoleHolders
          key={current.code}
          role={JURISDICTION_ADMINISTRATOR}
          jurisdiction={current.code}
          headingId="jurisdiction-administrators"
          heading={`Administrators of ${current.code}`}
          intro="Administrators add users to the jurisdiction, give and remove its roles for judges and legal text managers, approve requests and manage its settings. They cannot appoint or remove other administrators."
          noun="administrator"
        />
      )}
      {can("templates.manage") && current && !creating && (
        <TemplatesEditor
          key={`templates:${current.code}`}
          code={current.code}
          onStateChange={setTemplatesState}
        />
      )}
    </div>
  );
}

function JurisdictionEditor({
  jurisdiction,
  canRename,
  existingCodes,
  wordingKeys,
  stagesSupported,
  onSaved,
  onDiscard,
}: {
  jurisdiction: AdminJurisdiction | null;
  /** May change the name and the enabled switch of an existing jurisdiction
   * (`jurisdiction.create`; the API refuses it otherwise, 403 `permission_denied`). */
  canRename: boolean;
  existingCodes: string[];
  wordingKeys: Record<string, string>;
  /** False: an API before DIAAT-345, which would ignore the stage. */
  stagesSupported: boolean;
  onSaved: (code: string) => Promise<void>;
  /** Reopen from the server's copy (after a 409, say). */
  onDiscard: () => Promise<void>;
}) {
  const settings = jurisdiction?.settings ?? {};
  const [code, setCode] = useState(jurisdiction?.code ?? "");
  const [name, setName] = useState(jurisdiction?.name ?? "");
  const [displayName, setDisplayName] = useState(jurisdiction?.display_name ?? "");
  const [service, setService] = useState(jurisdiction?.service ?? "");
  // A new one is a draft; one from an API before stages is live.
  const [stage, setStage] = useState<JurisdictionStage>(
    jurisdiction ? (jurisdiction.stage ?? "live") : "draft"
  );
  const [enabled, setEnabled] = useState(jurisdiction?.enabled ?? true);
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
  const form = JSON.stringify({
    code,
    name,
    displayName,
    service,
    stage,
    enabled,
    template,
    recordings,
    wording,
  });
  const [savedForm, setSavedForm] = useState(form);
  useJurisdictionSwitchGuard({ busy: saving, unsaved: form !== savedForm });

  // Saving creates or replaces: adding one with an existing code would overwrite it.
  const duplicate =
    !jurisdiction && existingCodes.includes(code.trim().toUpperCase());
  // A new jurisdiction is only ever added by someone who may create one.
  const nameLocked = jurisdiction !== null && !canRename;

  async function save() {
    if (duplicate) return;
    setSaving(true);
    try {
      const saved = await saveJurisdiction(code, {
        name,
        // Only to an API that knows them: an older one would ignore them.
        ...(stagesSupported ? { display_name: displayName, service, stage } : {}),
        enabled,
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
      toast.error(message(err, true));
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
            disabled={nameLocked}
            aria-describedby={nameLocked ? "jurisdiction-locked" : undefined}
          />
        </div>
        {stagesSupported && (
          <>
            <div className="space-y-1">
              <Label htmlFor="jurisdiction-display-name">Display name</Label>
              <Input
                id="jurisdiction-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Employment Tribunals (ET)"
                maxLength={200}
                aria-describedby="jurisdiction-display-name-hint"
              />
              <p id="jurisdiction-display-name-hint" className="text-xs text-muted-foreground">
                What users see. Blank: the name.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="jurisdiction-service">Service (where it applies)</Label>
              <Input
                id="jurisdiction-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="England and Wales"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jurisdiction-stage">Who sees it</Label>
              <Select
                value={stage}
                onValueChange={(v) => setStage(v as JurisdictionStage)}
                disabled={!jurisdiction}
              >
                <SelectTrigger id="jurisdiction-stage" aria-describedby="jurisdiction-stage-hint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="jurisdiction-stage-hint" className="text-xs text-muted-foreground">
                {jurisdiction
                  ? "Draft: only its administrators. Test: its test group too. Live: everyone with a role there."
                  : "A new jurisdiction starts as a draft. Add its administrators, then switch it on."}
              </p>
            </div>
          </>
        )}
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
          <CheckboxField
            id="jurisdiction-enabled"
            label="Enabled"
            checked={enabled}
            onChange={setEnabled}
            disabled={nameLocked}
          />
          <CheckboxField
            id="jurisdiction-recordings"
            label="Uses hearing recordings"
            checked={recordings}
            onChange={setRecordings}
          />
        </div>
      </div>

      {!stagesSupported && !jurisdiction && (
        <p className="text-sm text-muted-foreground">
          It is live for its members as soon as it is enabled: setting one up as a draft
          needs the latest API.
        </p>
      )}

      {jurisdiction?.stage === "draft" && (jurisdiction.problems?.length ?? 0) > 0 && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
          aria-labelledby="jurisdiction-not-ready"
          role="region"
        >
          <p id="jurisdiction-not-ready" className="font-medium">
            Before it can be switched on for testers or everyone:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {jurisdiction.problems?.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {nameLocked && (
        <p id="jurisdiction-locked" className="text-sm text-muted-foreground">
          Only a super administrator can rename a jurisdiction or switch it on or
          off. Its template, hearing recordings and screen wording are yours to
          change.
        </p>
      )}

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
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

/** The public list's rows, as the table shows them when the settings are not the caller's. */
function namesOnly(list: { code: string; name: string }[]): AdminJurisdiction[] {
  return list.map((j) => ({
    ...j,
    enabled: true,
    settings: {},
    member_count: 0,
    version: "",
  }));
}
