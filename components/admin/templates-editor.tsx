"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingHistory } from "@/components/admin/setting-history";
import { SignOffFields } from "@/components/admin/sign-off";
import { TemplatePreview } from "@/components/admin/template-preview";
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
import { Textarea } from "@/components/ui/textarea";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { fetchTemplateHistory, restoreTemplate } from "@/lib/history-api";
import {
  NO_SIGN_OFF,
  SIGN_OFF_MISSING,
  type SignOffDraft,
  signedOffText,
  signOffToSend,
} from "@/lib/sign-off";
import {
  ANSWER_TYPES,
  type AdminTemplate,
  type AnswerRule,
  BENCHNOTES_SOURCES,
  type BenchNotesSource,
  deleteTemplate,
  FIELD_TYPES,
  fetchSharedTemplates,
  isAsked,
  fetchTemplates,
  LIST_TYPES,
  ownValue,
  type SharedTemplate,
  type StartedFrom,
  saveTemplate,
  startFromSharedTemplate,
  TEMPLATE_STAGES,
  type TemplateField,
  type TemplateFieldType,
  type TemplatePrefill,
  TemplateRefusedError,
  type TemplateStage,
  type TemplateValues,
  uploadTemplate,
} from "@/lib/templates-api";

/**
 * A jurisdiction's Word templates (DIAAT-344). Uploading one lists its fill-in boxes as
 * fields; the admin sets each field's label, type, whether it is required and its
 * options, and their order, but cannot add one. A template is saved only with every
 * box linked, and only then can it leave draft. Before that (DIAAT-346) the admin
 * previews it with sample details. DIAAT-347: it goes to the jurisdiction's test group
 * first, then to all its judges with the service lead's sign-off.
 *
 * DIAAT-336: a template can be shared as a base, and an admin of any jurisdiction can
 * start one of their own from a copy of it, then change it as their jurisdiction needs.
 * The copy is theirs: later changes to the shared one do not change it.
 */

const DOCX_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

function statusOf(template: AdminTemplate): string {
  if (template.problems.length > 0) return "Incomplete";
  return { draft: "Draft", test: "Test group", live: "Live" }[template.stage];
}

/** A change under way, or edits not saved: what the open field list reports to the list. */
interface EditorState {
  busy: boolean;
  unsaved: boolean;
}

const IDLE: EditorState = { busy: false, unsaved: false };

const byName = (a: AdminTemplate, b: AdminTemplate) =>
  a.name.localeCompare(b.name);

export function TemplatesEditor({ code }: { code: string }) {
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(IDLE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // DIAAT-336: choosing a shared template to start from, and starting from it.
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  // Loads the shared templates again: after a failed start, the list may be stale.
  const [pickerKey, setPickerKey] = useState(0);
  const pickerId = useId();
  // Going back to an earlier version (DIAAT-348): the field list then reopens from the
  // API's copy, so nothing in it can be edited meanwhile.
  const [restoring, setRestoring] = useState(false);
  // Each template's sample details for its preview, by id: kept while its field list
  // reopens after a save, so a fix can be previewed again with the same details.
  const [samples, setSamples] = useState<Record<string, TemplateValues>>({});
  useJurisdictionSwitchGuard({
    busy: uploading || restoring || starting,
    unsaved: false,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = uploading || restoring || starting || editor.busy;

  const load = useCallback(async () => {
    try {
      setTemplates(await fetchTemplates(code));
      setLoadError(null);
    } catch (err) {
      // An API from before DIAAT-344 has no templates route.
      setLoadError(
        err instanceof TemplateRefusedError && err.status === 404
          ? "Templates need the latest version of the API."
          : message(err)
      );
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A template saved, given a new file or added: from the API's answer, not a
   * reload (which could fail and leave a stale version in the editor). */
  const applySaved = useCallback((saved: AdminTemplate) => {
    setTemplates((all) =>
      [...all.filter((t) => t.id !== saved.id), saved].sort(byName)
    );
    setSelected(saved.id);
  }, []);

  /** Leave the open field list: at once if nothing would be lost, else if the
   * admin agrees to discard their edits. */
  function mayLeaveEditor(): boolean {
    if (!editor.unsaved) return true;
    const name =
      templates.find((t) => t.id === selected)?.name ?? "this template";
    return window.confirm(`Discard your unsaved changes to ${name}?`);
  }

  function choose(id: string) {
    if (id === selected || !mayLeaveEditor()) return;
    setSelected(id);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const added = await uploadTemplate(code, file);
      toast.success(
        `Uploaded ${added.name}: check its fields, then make it available to judges.`
      );
      applySaved(added);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function startFrom(shared: SharedTemplate) {
    if (!mayLeaveEditor()) return;
    setStarting(true);
    try {
      const added = await startFromSharedTemplate(code, shared.id);
      toast.success(
        `Started ${added.name} from a copy of ${shared.name} (${shared.jurisdiction_name}): change it as ${code} needs, then make it available to judges.`
      );
      setPicking(false);
      applySaved(added);
    } catch (err) {
      toast.error(message(err));
      setPickerKey((key) => key + 1);
    } finally {
      setStarting(false);
    }
  }

  const current = templates.find((t) => t.id === selected) ?? null;

  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-labelledby="jurisdiction-templates"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="jurisdiction-templates" className="text-lg font-semibold">
          Templates of {code}
        </h3>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || busy}
            aria-expanded={picking}
            aria-controls={pickerId}
            onClick={() => setPicking((open) => !open)}
          >
            <Copy className="mr-1 h-4 w-4" aria-hidden />
            Start from a shared template
          </Button>
          <input
            ref={fileInput}
            id="template-upload"
            type="file"
            accept={DOCX_ACCEPT}
            aria-label="Word template to upload"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            size="sm"
            // Not before the list has loaded: its answer would replace the upload's.
            disabled={loading || busy}
            onClick={() => {
              if (mayLeaveEditor()) fileInput.current?.click();
            }}
          >
            {uploading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="mr-1 h-4 w-4" aria-hidden />
            )}
            Upload a Word template
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        A Word document (.docx) whose fill-in boxes are content controls. Each
        box becomes a field judges fill on the Hearing Details form.
      </p>
      {picking && (
        <SharedTemplatePicker
          key={pickerKey}
          id={pickerId}
          code={code}
          starting={starting}
          disabled={busy}
          onStart={(shared) => void startFrom(shared)}
          onClose={() => setPicking(false)}
        />
      )}

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading templates
        </p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow
                key={t.id}
                className={t.id === selected ? "bg-muted/60" : undefined}
              >
                <TableCell className="font-medium">
                  <button
                    type="button"
                    aria-current={t.id === selected ? "true" : undefined}
                    className="underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
                    disabled={busy}
                    onClick={() => choose(t.id)}
                  >
                    {t.name}
                  </button>
                  {t.service && (
                    <span className="block text-xs text-muted-foreground">
                      {t.service}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{t.file_name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      t.stage === "live" && t.problems.length === 0
                        ? "default"
                        : "secondary"
                    }
                  >
                    {statusOf(t)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {current && (
        <TemplateFieldsEditor
          key={`${current.id}:${current.version}`}
          code={code}
          template={current}
          locked={uploading || restoring || starting}
          onStateChange={setEditor}
          onSaved={applySaved}
          onDeleted={(id) => {
            setTemplates((all) => all.filter((t) => t.id !== id));
            setSamples(({ [id]: _, ...rest }) => rest);
            setSelected(null);
          }}
          samples={ownValue(samples, current.id) ?? {}}
          onSamplesChange={(values) =>
            setSamples((all) => ({ ...all, [current.id]: values }))
          }
        />
      )}
      {current && (
        // Outside the field list, which reopens after each save: it stays open, and
        // loads again for the new version (DIAAT-348).
        <SettingHistory
          key={current.id}
          id={`template-history-${current.id}`}
          load={() => fetchTemplateHistory(code, current.id)}
          version={current.version}
          locked={busy}
          unsaved={editor.unsaved}
          onRestore={async (number) => {
            setRestoring(true);
            try {
              const restored = await restoreTemplate(
                code,
                current.id,
                number,
                current.version
              );
              toast.success(`${restored.name} is back to version ${number}.`);
              applySaved(restored);
            } finally {
              setRestoring(false);
            }
          }}
        />
      )}
    </section>
  );
}

function TemplateFieldsEditor({
  code,
  template,
  locked,
  onStateChange,
  onSaved,
  onDeleted,
  samples,
  onSamplesChange,
}: {
  code: string;
  template: AdminTemplate;
  /** Another template is being uploaded or started from a shared one (it opens when
   * done), or this one is going back to an earlier version (it reopens): nothing here
   * can be changed meanwhile. */
  locked: boolean;
  /** Busy or unsaved: the list stops other changes while busy, and asks before
   * dropping unsaved edits. */
  onStateChange: (state: EditorState) => void;
  /** The API's copy after a save or a new file: the editor reopens from it. */
  onSaved: (saved: AdminTemplate) => void;
  onDeleted: (id: string) => void;
  /** The sample details of its preview (DIAAT-346). */
  samples: TemplateValues;
  onSamplesChange: (values: TemplateValues) => void;
}) {
  const [name, setName] = useState(template.name);
  const [service, setService] = useState(template.service ?? "");
  const [stage, setStage] = useState<TemplateStage>(template.stage);
  // Absent from an API from before DIAAT-336: not offered then.
  const canShare = template.shared_as_base !== undefined;
  const [shared, setShared] = useState(template.shared_as_base ?? false);
  const [signOff, setSignOff] = useState<SignOffDraft>(NO_SIGN_OFF);
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const ids = useId();
  // Going live, not saving one already live: the service lead's sign-off (DIAAT-347).
  const needsSignOff = stage === "live" && template.stage !== "live";
  const [fields, setFields] = useState<TemplateField[]>(template.fields);
  // Each list's options as typed, one per line, by tag.
  const [optionText, setOptionText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      template.fields.map((f) => [f.tag, f.options.join("\n")])
    )
  );
  const [refused, setRefused] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const linked = new Set(fields.map((f) => f.tag));
  // DIAAT-412: the questions whose answers a rule's text can print.
  const answerable = fields.flatMap((f) =>
    isAsked(f.type) ? [{ tag: f.tag, label: f.label || f.tag }] : []
  );
  const unlinked = template.boxes.filter((b) => !linked.has(b.key));
  const form = JSON.stringify({
    name,
    service,
    stage,
    shared,
    fields,
    optionText,
  });
  const [savedForm] = useState(form);
  const unsaved = form !== savedForm;
  useJurisdictionSwitchGuard({ busy, unsaved });
  // Leaving the admin area (a link, Back, closing the tab) would drop the edits.
  useLeaveGuard(
    unsaved || busy,
    `Leave this page? Your unsaved changes to ${template.name} will be lost.`,
    { beforeUnload: true }
  );
  useEffect(() => {
    onStateChange({ busy, unsaved });
  }, [busy, unsaved, onStateChange]);
  // Closed (another template, or deleted): nothing of it is busy or unsaved.
  useEffect(() => () => onStateChange(IDLE), [onStateChange]);

  function update(tag: string, change: Partial<TemplateField>) {
    setFields((all) =>
      all.map((f) => (f.tag === tag ? { ...f, ...change } : f))
    );
  }

  function move(index: number, by: -1 | 1) {
    setFields((all) => {
      const next = [...all];
      const [field] = next.splice(index, 1);
      next.splice(index + by, 0, field);
      return next;
    });
  }

  function linkBox(key: string) {
    const box = template.boxes.find((b) => b.key === key);
    if (!box) return;
    const type: TemplateFieldType =
      box.kind === "dropdown"
        ? "dropdown"
        : box.kind === "date"
          ? "date"
          : "text";
    setFields((all) => [
      ...all,
      {
        tag: box.key,
        label: box.label,
        type,
        required: true,
        options: box.options,
        source: null,
      },
    ]);
    setOptionText((all) => ({ ...all, [box.key]: box.options.join("\n") }));
  }

  async function save() {
    const sign_off = needsSignOff ? signOffToSend(signOff) : undefined;
    if (sign_off === null) {
      setSignOffError(SIGN_OFF_MISSING);
      return;
    }
    setSignOffError(null);
    setBusy(true);
    try {
      const saved = await saveTemplate(code, template.id, {
        name,
        service: service.trim() || null,
        stage,
        sign_off,
        ...(canShare && { shared_as_base: shared }),
        version: template.version,
        fields: fields.map((f) => ({
          ...f,
          options: LIST_TYPES.includes(f.type)
            ? (ownValue(optionText, f.tag) ?? "")
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
          source: f.type === "benchnotes" ? f.source : null,
          prefill: f.type === "text" ? f.prefill : undefined,
          rules:
            f.type === "benchnotes" && f.source === "answer_text"
              ? (f.rules ?? [])
              : undefined,
        })),
      });
      setRefused(null);
      toast.success(`Saved ${saved.name}`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof TemplateRefusedError && err.problems.length > 0) {
        setRefused(err.problems);
        toast.error("The template cannot be saved yet: see what is missing.");
      } else {
        toast.error(message(err));
      }
    } finally {
      setBusy(false);
    }
  }

  // Unsaved edits: the button asked before the file was chosen.
  async function replaceFile(file: File) {
    setBusy(true);
    try {
      const replaced = await uploadTemplate(code, file, {
        id: template.id,
        version: template.version,
      });
      toast.success(
        replaced.problems.length > 0
          ? `Uploaded ${file.name}. Link its new boxes before judges can use it again.`
          : `Uploaded ${file.name}`
      );
      onSaved(replaced);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteTemplate(code, template.id);
      toast.success(`Deleted ${template.name}`);
      onDeleted(template.id);
    } catch (err) {
      toast.error(message(err));
      setBusy(false);
    }
  }

  const problems = refused ?? template.problems;

  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-labelledby="template-fields-heading"
    >
      <h4 id="template-fields-heading" className="font-semibold">
        Fields of {template.name}
      </h4>
      {template.started_from && (
        <p className="text-sm text-muted-foreground">
          {startedFromText(template.started_from)}
        </p>
      )}
      {/* Nothing can be edited while a save, a new file or a delete is under way
          (the editor then reopens from the server's copy, which would drop it), or
          while another template is uploaded (it opens instead). */}
      <fieldset
        disabled={busy || locked}
        aria-busy={busy || locked}
        className="m-0 min-w-0 space-y-4 border-0 p-0"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="template-name">Name judges choose it by</Label>
            <Input
              id="template-name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="template-service">Service (where it applies)</Label>
            <Input
              id="template-service"
              value={service}
              maxLength={200}
              onChange={(e) => setService(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-stage`}>Who can choose it</Label>
          <Select
            value={stage}
            onValueChange={(v) => {
              setStage(v as TemplateStage);
              setSignOffError(null);
            }}
          >
            <SelectTrigger
              id={`${ids}-stage`}
              aria-describedby={`${ids}-stage-hint`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${ids}-stage-hint`} className="text-xs text-muted-foreground">
            {template.stage === "live" && template.sign_off
              ? `${signedOffText(template.sign_off)}.`
              : "Its test group: the users marked as testers there, and its administrators."}
          </p>
        </div>
        {canShare && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${ids}-shared`}
                checked={shared}
                aria-describedby={`${ids}-shared-hint`}
                onCheckedChange={(value) => setShared(value === true)}
              />
              <Label htmlFor={`${ids}-shared`}>
                Share as a base template for other jurisdictions
              </Label>
            </div>
            <p
              id={`${ids}-shared-hint`}
              className="text-xs text-muted-foreground"
            >
              Administrators of any jurisdiction can start a template of their
              own from a copy of it. Changes saved here later do not change
              their copies.
            </p>
          </div>
        )}
        {needsSignOff && (
          <SignOffFields
            id={`${ids}-sign-off`}
            value={signOff}
            onChange={(value) => {
              setSignOff(value);
              setSignOffError(null);
            }}
            error={signOffError}
          />
        )}

        {problems.length > 0 && (
          <div
            role="region"
            aria-labelledby="template-problems"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
          >
            <p id="template-problems" className="font-medium">
              Before it can be saved:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field label</TableHead>
              <TableHead>Field type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Configuration</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Order</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f, index) => {
              const box = template.boxes.find((b) => b.key === f.tag);
              const asked = isAsked(f.type);
              return (
                <TableRow key={f.tag}>
                  <TableCell className="align-top">
                    <Input
                      aria-label={`Label of box ${f.tag}`}
                      value={f.label}
                      maxLength={200}
                      onChange={(e) => update(f.tag, { label: e.target.value })}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Box {f.tag}
                      {box && box.count > 1 ? `, ${box.count} places` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <Select
                      value={f.type}
                      onValueChange={(v) =>
                        update(f.tag, { type: v as TemplateFieldType })
                      }
                    >
                      <SelectTrigger aria-label={`Type of ${f.label || f.tag}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="align-top">
                    {asked ? (
                      <Select
                        value={f.required ? "required" : "optional"}
                        onValueChange={(v) =>
                          update(f.tag, { required: v === "required" })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Is ${f.label || f.tag} required`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="required">Required</SelectItem>
                          <SelectItem value="optional">Optional</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Not asked
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <FieldConfiguration
                      field={f}
                      options={ownValue(optionText, f.tag) ?? ""}
                      onOptions={(text) =>
                        setOptionText((all) => ({ ...all, [f.tag]: text }))
                      }
                      onSource={(source) =>
                        update(f.tag, {
                          source,
                          // DIAAT-411: a first rule to fill in.
                          ...(source === "answer_text" &&
                            !f.rules?.length && { rules: [NEW_RULE] }),
                        })
                      }
                      questions={fields.flatMap((o) =>
                        o.tag !== f.tag && ANSWER_TYPES.includes(o.type)
                          ? [
                              {
                                tag: o.tag,
                                label: o.label || o.tag,
                                answers:
                                  o.type === "yes_no"
                                    ? YES_NO_ANSWERS
                                    : (ownValue(optionText, o.tag) ?? "")
                                        .split("\n")
                                        .map((line) => line.trim())
                                        .filter(Boolean)
                                        .map((line) => ({
                                          value: line,
                                          label: line,
                                        })),
                              },
                            ]
                          : []
                      )}
                      onRules={(rules) => update(f.tag, { rules })}
                      answerable={answerable}
                      onEmptyText={(text) =>
                        update(f.tag, { empty_text: text || null })
                      }
                      onPrefill={(prefill) =>
                        update(f.tag, { prefill: prefill ?? undefined })
                      }
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        aria-label={`Move ${f.label || f.tag} up`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === fields.length - 1}
                        aria-label={`Move ${f.label || f.tag} down`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {unlinked.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Boxes with no field yet</p>
            <ul className="space-y-1">
              {unlinked.map((b) => (
                <li key={b.key} className="flex items-center gap-2 text-sm">
                  <span>
                    {b.label} (box {b.key})
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => linkBox(b.key)}
                  >
                    Link a field
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            <Save className="mr-1 h-4 w-4" aria-hidden />
            Save
          </Button>
          <input
            ref={fileInput}
            id={`template-replace-${template.id}`}
            type="file"
            accept={DOCX_ACCEPT}
            aria-label="New file for this template"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void replaceFile(file);
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              // The new file reopens the editor from the server: edits not saved
              // would be dropped.
              if (
                unsaved &&
                !window.confirm(
                  `Uploading a new file discards your unsaved changes to ${template.name}. Continue?`
                )
              )
                return;
              fileInput.current?.click();
            }}
          >
            <Upload className="mr-1 h-4 w-4" aria-hidden />
            Upload a new file
          </Button>
          {confirmDelete ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              Confirm delete
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" aria-hidden />
              Delete template
            </Button>
          )}
        </div>
      </fieldset>

      <TemplatePreview
        code={code}
        template={template}
        unsaved={unsaved}
        locked={busy || locked}
        values={samples}
        onValuesChange={onSamplesChange}
      />
    </section>
  );
}

function startedFromText(from: StartedFrom): string {
  const at = new Date(from.copied_at);
  const on = Number.isNaN(at.getTime())
    ? ""
    : ` on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  return `Started from a copy of ${from.name} (${from.jurisdiction_name})${on}. Changes to that template do not change this one.`;
}

/** The templates shared as a base, to start one from (DIAAT-336). */
function SharedTemplatePicker({
  id,
  code,
  starting,
  disabled,
  onStart,
  onClose,
}: {
  id: string;
  code: string;
  starting: boolean;
  disabled: boolean;
  onStart: (shared: SharedTemplate) => void;
  onClose: () => void;
}) {
  const [shared, setShared] = useState<SharedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const ids = useId();

  useEffect(() => {
    let cancelled = false;
    fetchSharedTemplates(code).then(
      (list) => {
        if (cancelled) return;
        setShared(list);
        setChosen(list[0]?.id ?? "");
      },
      (err) => {
        if (!cancelled) setError(message(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  const choice = shared?.find((t) => t.id === chosen) ?? null;

  return (
    <div
      id={id}
      role="region"
      aria-labelledby={`${ids}-heading`}
      className="space-y-3 rounded-md border bg-muted/30 p-3"
    >
      <p id={`${ids}-heading`} className="text-sm font-medium">
        Start from a shared template
      </p>
      <p className="text-sm text-muted-foreground">
        A copy of its file and fields becomes a draft template of {code}, for
        you to change as {code} needs. Later changes to the shared template do
        not change your copy.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : shared === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading shared templates
        </p>
      ) : shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jurisdiction shares a template yet.
        </p>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`${ids}-choice`}>Shared template</Label>
          <Select value={chosen} onValueChange={setChosen}>
            <SelectTrigger id={`${ids}-choice`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shared.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} ({t.jurisdiction_name}), {t.field_count}{" "}
                  {t.field_count === 1 ? "field" : "fields"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || choice === null}
          onClick={() => {
            if (choice) onStart(choice);
          }}
        >
          {starting && (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
          )}
          Start from it
        </Button>
        <Button size="sm" variant="ghost" disabled={starting} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A question a box's text can depend on (DIAAT-411), and its answers as saved. */
interface Question {
  tag: string;
  label: string;
  answers: { value: string; label: string }[];
}

const YES_NO_ANSWERS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const NEW_RULE: AnswerRule = { field: "", answer: "", text: "" };
// The API's limit on a rule's text.
const RULE_TEXT_LIMIT = 10000;

function FieldConfiguration({
  field,
  options,
  onOptions,
  onSource,
  onEmptyText,
  onPrefill,
  questions,
  onRules,
  answerable,
}: {
  field: TemplateField;
  options: string;
  onOptions: (text: string) => void;
  onSource: (source: BenchNotesSource) => void;
  onEmptyText: (text: string) => void;
  onPrefill: (prefill: TemplatePrefill | null) => void;
  questions: Question[];
  onRules: (rules: AnswerRule[]) => void;
  /** The questions the judge answers, whose answers a rule's text can print. */
  answerable: { tag: string; label: string }[];
}) {
  const name = field.label || field.tag;
  // Not from the tag, which can hold spaces (an ID reference list would split it).
  const hintId = useId();
  if (LIST_TYPES.includes(field.type)) {
    return (
      <div className="space-y-1">
        <span className="text-sm">Configured list</span>
        <Textarea
          aria-label={`Options for ${name}`}
          aria-describedby={hintId}
          rows={Math.min(8, Math.max(3, options.split("\n").length))}
          value={options}
          onChange={(e) => onOptions(e.target.value)}
        />
        <span id={hintId} className="block text-xs text-muted-foreground">
          One option per line, in order.
        </span>
      </div>
    );
  }
  if (field.type === "legal_issues") {
    return (
      <span className="text-sm">
        Existing Legal Issues / Legal Framework capability
      </span>
    );
  }
  if (field.type === "benchnotes") {
    return (
      <div className="space-y-2">
        <Select
          value={field.source ?? undefined}
          onValueChange={(v) => onSource(v as BenchNotesSource)}
        >
          <SelectTrigger aria-label={`What BenchNotes fills ${name} with`}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {BENCHNOTES_SOURCES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.source === "legal_framework" && (
          <div className="space-y-1">
            <Label htmlFor={`${hintId}-empty`} className="text-xs">
              When no legal framework is chosen, print
            </Label>
            <Input
              id={`${hintId}-empty`}
              aria-describedby={hintId}
              maxLength={2000}
              value={field.empty_text ?? ""}
              onChange={(e) => onEmptyText(e.target.value)}
            />
            <span id={hintId} className="block text-xs text-muted-foreground">
              Prints the Legal Text Manager's text of each legal framework the
              judge chooses, in their order. Left blank, the line is removed
              when none is chosen.
            </span>
          </div>
        )}
        {field.source === "answer_text" && (
          <AnswerRules
            name={name}
            rules={field.rules ?? []}
            questions={questions}
            onRules={onRules}
            answerable={answerable}
          />
        )}
      </div>
    );
  }
  if (field.type === "dictated") {
    return (
      <span className="text-sm">
        A section the judge dictates, chosen by this field's label. Several
        boxes can each be one.
      </span>
    );
  }
  if (field.type === "text") {
    // DIAAT-340: as the IAC's form does for its first judge.
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${hintId}-judge`}
            checked={field.prefill === "judge_name"}
            aria-label={`Fill in the judge's name in ${name}`}
            aria-describedby={hintId}
            onCheckedChange={(value) =>
              onPrefill(value === true ? "judge_name" : null)
            }
          />
          <Label htmlFor={`${hintId}-judge`} className="font-normal">
            Fill in the judge's name
          </Label>
        </div>
        <span id={hintId} className="block text-xs text-muted-foreground">
          The form starts with the signed-in judge's name. They can change it.
        </span>
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">No list needed</span>;
}

/**
 * DIAAT-411: the rules of a box whose text depends on the judge's answers, as the
 * IAC's decision adds its rule 28 paragraphs. Each prints its text when its question
 * has its answer, in this order; with none applying, the box's line is removed.
 */
function AnswerRules({
  name,
  rules,
  questions,
  onRules,
  answerable,
}: {
  name: string;
  rules: AnswerRule[];
  questions: Question[];
  onRules: (rules: AnswerRule[]) => void;
  answerable: { tag: string; label: string }[];
}) {
  const hintId = useId();
  const texts = useRef<(HTMLTextAreaElement | null)[]>([]);
  // The text boxes given their starting cursor, which later renders must keep.
  const placed = useRef(new WeakSet<HTMLTextAreaElement>());
  // Where the cursor goes once an inserted answer is in the text: React's update
  // would otherwise put it at the end, and the next answer there.
  const caret = useRef<{ index: number; at: number } | null>(null);
  useEffect(() => {
    if (!caret.current) return;
    texts.current[caret.current.index]?.setSelectionRange(
      caret.current.at,
      caret.current.at
    );
    caret.current = null;
  });
  const change = (index: number, rule: Partial<AnswerRule>) =>
    onRules(rules.map((r, i) => (i === index ? { ...r, ...rule } : r)));
  // DIAAT-412: an answer goes where the admin's cursor is, else at the end.
  const insert = (index: number, tag: string) => {
    const text = rules[index].text;
    const box = texts.current[index];
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? start;
    const placeholder = `{{${tag}}}`;
    const next = `${text.slice(0, start)}${placeholder}${text.slice(end)}`;
    if (next.length > RULE_TEXT_LIMIT) {
      toast.error("The rule's text is too long to insert another answer.");
      return;
    }
    caret.current = { index, at: start + placeholder.length };
    change(index, { text: next });
  };
  return (
    <div className="space-y-3">
      <p id={hintId} className="text-xs text-muted-foreground">
        Prints each rule's text when the judge gives its answer, in this order.
        With none applying, the line is removed. Use **bold**, lists and
        [placeholders] for the judge to complete. An inserted answer prints as
        its own box would (a date as 12 February 2026, a yes/no question as Yes
        or No). Left empty, it prints nothing, nor the comma next to it.
      </p>
      {questions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Link a box to a dropdown, list or yes/no question for a rule to depend
          on.
        </p>
      )}
      {rules.map((rule, index) => {
        const label = `rule ${index + 1} of ${name}`;
        const question = questions.find((q) => q.tag === rule.field);
        return (
          // Rules have no identity of their own; editing one keeps its place.
          <fieldset key={index} className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              Rule {index + 1}
            </legend>
            <Select
              value={rule.field}
              onValueChange={(field) => change(index, { field, answer: "" })}
            >
              <SelectTrigger aria-label={`Question of ${label}`}>
                <SelectValue placeholder="When the question" />
              </SelectTrigger>
              <SelectContent>
                {questions.map((q) => (
                  <SelectItem key={q.tag} value={q.tag}>
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={rule.answer}
              onValueChange={(answer) => change(index, { answer })}
              disabled={!question}
            >
              <SelectTrigger aria-label={`Answer of ${label}`}>
                <SelectValue placeholder="has the answer" />
              </SelectTrigger>
              <SelectContent>
                {question?.answers.map((answer) => (
                  <SelectItem key={answer.value} value={answer.value}>
                    {answer.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              ref={(box) => {
                // Until the admin places the cursor, an answer goes at the end.
                if (box && !placed.current.has(box)) {
                  placed.current.add(box);
                  box.setSelectionRange(box.value.length, box.value.length);
                }
                texts.current[index] = box;
              }}
              aria-label={`Text of ${label}`}
              aria-describedby={hintId}
              rows={4}
              maxLength={RULE_TEXT_LIMIT}
              placeholder="print"
              value={rule.text}
              onChange={(e) => change(index, { text: e.target.value })}
            />
            {answerable.length > 0 && (
              <Select value="" onValueChange={(tag) => insert(index, tag)}>
                <SelectTrigger aria-label={`Insert an answer into ${label}`}>
                  <SelectValue placeholder="Insert an answer" />
                </SelectTrigger>
                <SelectContent>
                  {answerable.map((q) => (
                    <SelectItem key={q.tag} value={q.tag}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${label}`}
              onClick={() => onRules(rules.filter((_, i) => i !== index))}
            >
              <Trash2 className="mr-1 h-4 w-4" aria-hidden />
              Remove
            </Button>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRules([...rules, NEW_RULE])}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Add a rule
      </Button>
    </div>
  );
}
