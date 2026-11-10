"use client";

import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
  type AdminTemplate,
  BENCHNOTES_SOURCES,
  type BenchNotesSource,
  deleteTemplate,
  FIELD_TYPES,
  fetchTemplates,
  LIST_TYPES,
  ownValue,
  saveTemplate,
  type TemplateField,
  type TemplateFieldType,
  TemplateRefusedError,
  uploadTemplate,
} from "@/lib/templates-api";

/**
 * A jurisdiction's Word templates (DIAAT-344). Uploading one lists its fill-in boxes as
 * fields; the admin sets each field's label, type, whether it is required and its
 * options, and their order, but cannot add one. A template is saved only with every
 * box linked, and only then can judges choose it.
 */

const DOCX_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

function statusOf(template: AdminTemplate): string {
  if (template.problems.length > 0) return "Incomplete";
  return template.enabled ? "Available to judges" : "Off";
}

/** What the open field list reports: a change under way, or edits not saved. */
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
  useJurisdictionSwitchGuard({ busy: uploading, unsaved: false });
  const fileInput = useRef<HTMLInputElement>(null);

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
        <div>
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
            disabled={uploading || editor.busy}
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
                    disabled={uploading || editor.busy}
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
                      t.enabled && t.problems.length === 0
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
          onStateChange={setEditor}
          onSaved={applySaved}
          onDeleted={(id) => {
            setTemplates((all) => all.filter((t) => t.id !== id));
            setSelected(null);
          }}
        />
      )}
    </section>
  );
}

function TemplateFieldsEditor({
  code,
  template,
  onStateChange,
  onSaved,
  onDeleted,
}: {
  code: string;
  template: AdminTemplate;
  /** Busy or unsaved: the list stops other changes while busy, and asks before
   * dropping unsaved edits. */
  onStateChange: (state: EditorState) => void;
  /** The API's copy after a save or a new file: the editor reopens from it. */
  onSaved: (saved: AdminTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  const [service, setService] = useState(template.service ?? "");
  const [enabled, setEnabled] = useState(template.enabled);
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
  const unlinked = template.boxes.filter((b) => !linked.has(b.key));
  const form = JSON.stringify({ name, service, enabled, fields, optionText });
  const [savedForm] = useState(form);
  const unsaved = form !== savedForm;
  useJurisdictionSwitchGuard({ busy, unsaved });
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
    setBusy(true);
    try {
      const saved = await saveTemplate(code, template.id, {
        name,
        service: service.trim() || null,
        enabled,
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
      {/* Nothing can be edited while a save, a new file or a delete is under way:
          the editor then reopens from the server's copy, which would drop it. */}
      <fieldset
        disabled={busy}
        aria-busy={busy}
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="template-enabled"
            checked={enabled}
            onCheckedChange={(value) => setEnabled(value === true)}
          />
          <Label htmlFor="template-enabled">Available to judges</Label>
        </div>

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
              const asked = f.type !== "benchnotes" && f.type !== "dictated";
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
                      onSource={(source) => update(f.tag, { source })}
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
            onClick={() => fileInput.current?.click()}
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
    </section>
  );
}

function FieldConfiguration({
  field,
  options,
  onOptions,
  onSource,
}: {
  field: TemplateField;
  options: string;
  onOptions: (text: string) => void;
  onSource: (source: BenchNotesSource) => void;
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
    );
  }
  if (field.type === "dictated") {
    return <span className="text-sm">The judge's dictated judgment</span>;
  }
  return <span className="text-sm text-muted-foreground">No list needed</span>;
}
