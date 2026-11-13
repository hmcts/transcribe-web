"use client";

import { Loader2, Plus, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RoleHolders } from "@/components/admin/role-holders";
import { SettingHistory } from "@/components/admin/setting-history";
import { SignOffFields } from "@/components/admin/sign-off";
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
import { describeRefusal } from "@/lib/access/refusal-messages";
import { fetchJurisdictionHistory, restoreJurisdiction } from "@/lib/history-api";
import { NO_SIGN_OFF, SIGN_OFF_MISSING, type SignOffDraft, signedOffText, signOffToSend } from "@/lib/sign-off";
import { useAccess } from "@/providers/access";

/**
 * Jurisdictions (DIAAT-356, DIAAT-394), shown by permission:
 *  - `jurisdictions.manage`: each jurisdiction's settings (name, template, hearing
 *    recordings, screen wording), for the ones the API lists for the caller;
 *  - `jurisdiction.create`: adding a jurisdiction;
 *  - `jurisdiction_admin.assign`: who administers each jurisdiction. That is a
 *    role assignment like any other (given by sign-in email, or to someone who has
 *    signed in, the super administrator included), not a setting of the jurisdiction.
 *    Only a super administrator holds it, and the tab is shown for the first two
 *    (DIAAT-403: a system administrator gives no jurisdiction role, so it has no
 *    Jurisdictions tab; DIAAT-406: a jurisdiction administrator manages its
 *    jurisdiction's users, templates and approvals, not its settings).
 *
 * DIAAT-345: a new jurisdiction is a draft only its administrators see. Moved to test,
 * its test group sees it too; live, everyone with a role there. It leaves draft only
 * when it is ready, and the editor lists what is missing. That needs an API that knows
 * stages: until it reports them the panel offers none of it.
 */

const message = (error: unknown, savingJurisdiction = false) =>
  describeRefusal(error, { savingJurisdiction });

export function JurisdictionsPanel() {
  const { can } = useAccess();
  const canManage = can("jurisdictions.manage");
  const canCreate = can("jurisdiction.create");
  const canAssign = can("jurisdiction_admin.assign");
  const [jurisdictions, setJurisdictions] = useState<AdminJurisdiction[]>([]);
  const [wordingKeys, setWordingKeys] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Bumped to reopen the editor from the server's copy, dropping unsaved edits.
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [creating, setCreating] = useState(false);
  // Going back to an earlier version (DIAAT-348): the editor reopens when it is done,
  // so another jurisdiction cannot be opened (and its edits lost) meanwhile.
  const [restoring, setRestoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, keys] = await Promise.all([
        fetchAdminJurisdictions(),
        canManage ? fetchWordingKeys() : Promise.resolve({}),
      ]);
      setJurisdictions(list);
      setWordingKeys(keys);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

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
            disabled={restoring}
            onClick={() => {
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
                    className="underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={restoring}
                    onClick={() => {
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
          restoring={restoring}
          onRestore={async (code, number, version) => {
            setRestoring(true);
            try {
              const restored = await restoreJurisdiction(code, number, version);
              toast.success(`${code} is back to version ${number}.`);
              // The API's copy, not a reload (which could fail and reopen the editor
              // with the content and version from before).
              setJurisdictions((all) =>
                all.map((j) => (j.code === restored.code ? restored : j))
              );
              setEditorGeneration((g) => g + 1);
            } finally {
              setRestoring(false);
            }
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
          intro="Administrators add users to the jurisdiction, give and remove its judge and legal text manager roles, approve access requests and manage its templates. They cannot change its settings or appoint other administrators. You can appoint yourself."
          noun="administrator"
          offerSelf
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
  restoring,
  onRestore,
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
  /** Going back to an earlier version is under way (DIAAT-348). */
  restoring: boolean;
  /** Go back to version `number` of `code`, then reopen from the API's copy; throws
   * if it is refused. */
  onRestore: (code: string, number: number, version: string) => Promise<void>;
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
  // The copy this form was opened from or last saved, not the list's latest: a change
  // made meanwhile (even one a refresh has since shown) is refused, not overwritten.
  // The editor stays open across saves, and the refresh after one may fail.
  const [stored, setStored] = useState(jurisdiction);
  const version = stored?.version ?? "";
  const [signOff, setSignOff] = useState<SignOffDraft>(NO_SIGN_OFF);
  const [signOffError, setSignOffError] = useState<string | null>(null);
  // Going live, not saving one already live: the service lead's sign-off (DIAAT-347).
  const needsSignOff =
    stagesSupported && stored !== null && stage === "live" && (stored.stage ?? "live") !== "live";
  const [template, setTemplate] = useState<string>(settings.template ?? "none");
  const [recordings, setRecordings] = useState(
    settings.features?.hearing_recordings ?? false
  );
  const [wording, setWording] = useState<Record<string, string>>(settings.wording ?? {});
  const [saving, setSaving] = useState(false);
  // While going back nothing can be edited: the editor then reopens from the API's copy.
  const busy = saving || restoring;

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
  useJurisdictionSwitchGuard({ busy, unsaved: form !== savedForm });

  // Saving creates or replaces: adding one with an existing code would overwrite it.
  const duplicate =
    !jurisdiction && existingCodes.includes(code.trim().toUpperCase());
  // A new jurisdiction is only ever added by someone who may create one.
  const nameLocked = jurisdiction !== null && !canRename;

  async function save() {
    if (duplicate) return;
    const signOffSent = needsSignOff ? signOffToSend(signOff) : undefined;
    if (signOffSent === null) {
      setSignOffError(SIGN_OFF_MISSING);
      return;
    }
    setSignOffError(null);
    setSaving(true);
    try {
      const saved = await saveJurisdiction(code, {
        name,
        // Only to an API that knows them: an older one would ignore them.
        ...(stagesSupported ? { display_name: displayName, service, stage } : {}),
        ...(signOffSent ? { sign_off: signOffSent } : {}),
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
      setStored(saved);
      // Each go-live is signed off afresh: leaving live clears the stored sign-off.
      setSignOff(NO_SIGN_OFF);
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
      <fieldset
        disabled={restoring}
        aria-busy={restoring}
        className="m-0 min-w-0 space-y-4 border-0 p-0"
      >
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
                  onValueChange={(v) => {
                    setStage(v as JurisdictionStage);
                    setSignOffError(null);
                  }}
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
                  {stored?.stage === "live" && stored.sign_off
                    ? `${signedOffText(stored.sign_off)}.`
                    : jurisdiction
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

        {needsSignOff && (
          <SignOffFields
            id="jurisdiction-sign-off"
            value={signOff}
            onChange={(value) => {
              setSignOff(value);
              setSignOffError(null);
            }}
            error={signOffError}
          />
        )}

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
      </fieldset>

      <Button
        onClick={() => void save()}
        disabled={busy || duplicate || !code.trim() || !name.trim()}
      >
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
        Save
      </Button>
      {jurisdiction && (
        <Button variant="ghost" className="ml-2" onClick={() => void onDiscard()} disabled={busy}>
          Discard changes
        </Button>
      )}

      {jurisdiction && (
        // DIAAT-348: going back reopens the editor from the API's copy.
        <SettingHistory
          id="jurisdiction-history"
          load={() => fetchJurisdictionHistory(jurisdiction.code)}
          version={version}
          wordingKeys={wordingKeys}
          locked={busy}
          unsaved={form !== savedForm}
          onRestore={(number) => onRestore(jurisdiction.code, number, version)}
        />
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
