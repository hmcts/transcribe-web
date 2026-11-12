"use client";

import {
  BookOpen,
  Building2,
  Flag,
  Gavel,
  Inbox,
  Info,
  Loader2,
  Plus,
  Save,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApprovalsPanel } from "@/components/admin/approvals-panel";
import { FeatureFlagsPanel } from "@/components/admin/feature-flags-panel";
import { JurisdictionsPanel } from "@/components/admin/jurisdictions-panel";
import { TemplatesEditor } from "@/components/admin/templates-editor";
import { SuperAdministratorsPanel } from "@/components/admin/super-administrators-panel";
import { UsersPanel } from "@/components/admin/users-panel";
import { AppSidebar, type Selection } from "@/components/app-sidebar";
import { AdminEditor } from "@/components/editor/admin-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { holdJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { useLegalWording } from "@/hooks/use-legal-wording";
import type {
  AnonymityStatus,
  DocumentContent,
  HearingType,
  LegalFramework,
} from "@/lib/admin-api";
import {
  createHearingType,
  createLegalFramework,
  deleteHearingType,
  deleteLegalFramework,
  describeLegalWordingError,
  isLegalWordingRefusal,
  updateAnonymityStatus,
  updateHearingType,
  updateLegalFramework,
} from "@/lib/admin-api";
import { hasLegalWording } from "@/lib/editor-contracts";
import type { Permission } from "@/lib/access/types";
import { useAccess } from "@/providers/access";
import { useJurisdiction } from "@/providers/jurisdiction";

function getDefaultSelection(content: DocumentContent): Selection | null {
  const firstHearingType = content.hearing_types[0];
  if (firstHearingType) {
    return { category: "hearing-types", id: firstHearingType.id };
  }

  const firstLegalFramework = content.legal_frameworks[0];
  if (firstLegalFramework) {
    return { category: "legal-frameworks", id: firstLegalFramework.id };
  }

  const firstAnonymityStatus = content.anonymity.statuses[0];
  if (firstAnonymityStatus) {
    return { category: "anonymity", id: firstAnonymityStatus.id };
  }

  return null;
}

/**
 * The Admin tabs (DIAAT-384). Each shows only to a context holding one of its
 * permissions, which the API returns; no role names are involved. The API
 * enforces the same permissions on every call behind them.
 */
interface AdminTab {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  anyOf: Permission[];
}

const ADMIN_TABS: AdminTab[] = [
  { value: "document-content", label: "Document Content", anyOf: ["legal_text.manage"] },
  { value: "templates", label: "Templates", anyOf: ["templates.manage"] },
  { value: "users", label: "Users", icon: Users, anyOf: ["users.manage"] },
  { value: "approvals", label: "Approvals", icon: Inbox, anyOf: ["access.approve"] },
  {
    value: "jurisdictions",
    label: "Jurisdictions",
    icon: Building2,
    anyOf: ["jurisdictions.manage", "jurisdiction.create"],
  },
  {
    value: "super-admins",
    label: "Super administrators",
    icon: ShieldCheck,
    anyOf: ["jurisdiction_super_admin.assign"],
  },
  { value: "feature-flags", label: "Feature flags", icon: Flag, anyOf: ["feature_flags.manage"] },
];

const TAB_TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent px-1 pb-0 pt-0 h-10 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium";


export default function AdminPage() {
  // useSearchParams needs a Suspense boundary for the page to build.
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminTabs />
    </Suspense>
  );
}

/**
 * `/admin?tab=approvals&request=<id>` (the link in the approvers' email,
 * DIAAT-398) opens that tab, and the approvals queue highlights that request. The
 * link carries only the id: what the person may see is decided by the API.
 */
function AdminTabs() {
  const { current, resolved } = useJurisdiction();
  const { can } = useAccess();
  const params = useSearchParams();
  const tabs = ADMIN_TABS.filter((tab) => tab.anyOf.some(can));
  const wanted = params?.get("tab") ?? null;
  const requestId = params?.get("request") ?? null;
  const initial = tabs.find((tab) => tab.value === wanted) ?? tabs[0];
  const [active, setActive] = useState(initial?.value);
  // A link followed while the page is open (same page, new query) moves the tab.
  const wantedIsAvailable = tabs.some((tab) => tab.value === wanted);
  useEffect(() => {
    if (wanted && wantedIsAvailable) setActive(wanted);
  }, [wanted, wantedIsAvailable]);

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p role="status" className="text-muted-foreground">
          There is nothing to manage here in your role.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 top-14 flex flex-col bg-background">
      <Tabs
        value={tabs.some((tab) => tab.value === active) ? active : tabs[0].value}
        onValueChange={setActive}
        className="flex flex-col h-full min-h-0"
      >
        <div className="shrink-0 border-b px-4">
          <TabsList className="h-10 rounded-none bg-transparent p-0 gap-4">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className={TAB_TRIGGER_CLASS}>
                {tab.icon && <tab.icon className="mr-1.5 h-4 w-4" />}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabs.map((tab) => {
          if (tab.value === "document-content") {
            return (
              <TabsContent
                key={tab.value}
                value={tab.value}
                className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden"
              >
                {/* DIAAT-342: the legal wording of the jurisdiction this tab works in.
                    Keyed by it, so nothing of another jurisdiction's carries over. */}
                {resolved ? (
                  <LegalWordingTab
                    key={current?.code ?? "none"}
                    code={current?.code ?? null}
                    name={current?.name ?? null}
                  />
                ) : (
                  <LoadingState />
                )}
              </TabsContent>
            );
          }
          return (
            <TabsContent
              key={tab.value}
              value={tab.value}
              // Kept mounted while another tab is open: unsaved jurisdiction or template
              // edits survive a look at another tab (DIAAT-344).
              forceMount={tab.value === "jurisdictions" ? true : undefined}
              className="flex-1 overflow-auto mt-0 p-6 data-[state=inactive]:hidden"
            >
              <AdminTabContent
                tab={tab.value}
                requestId={requestId}
                currentCode={resolved ? (current?.code ?? null) : undefined}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function AdminTabContent({
  tab,
  requestId,
  currentCode,
}: {
  tab: string;
  requestId: string | null;
  /** The jurisdiction this tab works in: null, none; undefined, not loaded yet. */
  currentCode: string | null | undefined;
}) {
  switch (tab) {
    case "templates":
      // DIAAT-344: the Word templates of the jurisdiction this tab works in. Someone
      // acting globally (a super administrator) picks a jurisdiction under Jurisdictions.
      if (currentCode === undefined) return <LoadingState />;
      return currentCode ? (
        <TemplatesEditor key={`templates:${currentCode}`} code={currentCode} />
      ) : (
        <AdminPlaceholder
          title="Templates"
          text="Open a jurisdiction under Jurisdictions to manage its templates."
        />
      );
    case "users":
      return <UsersPanel />;
    case "approvals":
      return <ApprovalsPanel highlightRequestId={requestId} />;
    case "jurisdictions":
      // DIAAT-356, DIAAT-394: jurisdictions, and who administers each.
      return <JurisdictionsPanel />;
    case "super-admins":
      return <SuperAdministratorsPanel />;
    case "feature-flags":
      return <FeatureFlagsPanel />;
    default:
      return null;
  }
}

function AdminPlaceholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-4xl space-y-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legal wording tab (one jurisdiction's: the one this tab works in)
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function LegalWordingTab({
  code,
  name,
}: {
  code: string | null;
  name: string | null;
}) {
  const { state, reload } = useLegalWording(code);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Selection | null>(null);
  const content = state.status === "loaded" ? state.content : null;
  // What the API calls it, else what this tab was told.
  const label = content?.jurisdiction?.name ?? name ?? code ?? undefined;

  // Only on new content: a selection cleared by a delete waits for the refreshed content.
  useEffect(() => {
    if (content)
      setSelection((current) => current ?? getDefaultSelection(content));
  }, [content]);

  if (!code) {
    return (
      <BlockedState message="You are not working in a jurisdiction yet. Choose one from the home page (or ask for access if you have none) before editing its legal wording." />
    );
  }

  if (state.status === "loading") return <LoadingState />;

  if (state.status === "error") {
    return (
      <BlockedState
        message={describeLegalWordingError(state.error, label)}
        // Trying again cannot change who you are or where you work.
        onRetry={
          isLegalWordingRefusal(state.error) ? undefined : () => reload()
        }
      />
    );
  }

  const { content: loaded } = state;
  const deleteName = deleteTarget
    ? resolveItemTitle(loaded, deleteTarget)
    : "";
  const deletesLastFramework =
    deleteTarget?.category === "legal-frameworks" &&
    loaded.legal_frameworks.length === 1;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-muted/40 px-4 py-2 text-sm">
        <p>
          Editing the legal wording of <strong>{label}</strong>
          {loaded.jurisdiction && <> ({loaded.jurisdiction.code})</>}. Changes
          apply to this jurisdiction only.
        </p>
        {!hasLegalWording(loaded) && (
          <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {label} has no legal frameworks yet. Judges are not asked for
              legal issues, and their decisions leave out the Issues and Legal
              Framework sections. Add a legal framework to turn them on.
            </span>
          </p>
        )}
      </div>
      <div className="flex min-h-0 w-full flex-1 justify-center overflow-hidden">
        <div className="h-full w-full max-w-[1280px] min-w-0">
          <SidebarProvider
            className="h-full min-h-0"
            style={
              {
                "--sidebar-width": "360px",
              } as React.CSSProperties
            }
          >
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute inset-y-0 right-full w-[100vw] bg-sidebar"
              />
              <AppSidebar
                documentContent={loaded}
                selection={selection}
                onItemSelect={setSelection}
              />
            </div>
            <SidebarInset className="relative overflow-y-auto bg-background">
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-full w-[100vw] bg-background"
              />
              {selection ? (
                <ContentPanel
                  key={`${selection.category}-${selection.id}-${selection.isNew}`}
                  content={loaded}
                  selection={selection}
                  onRefresh={() => reload(true)}
                  onSelect={setSelection}
                  onDelete={setDeleteTarget}
                />
              ) : (
                <EmptyState />
              )}
            </SidebarInset>
          </SidebarProvider>
        </div>
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        name={deleteName}
        warning={
          deletesLastFramework
            ? `This is the last legal framework of ${label}. Without one, judges are no longer asked for legal issues and their decisions leave out the Issues and Legal Framework sections.`
            : undefined
        }
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.category === "hearing-types") {
            await holdJurisdictionSwitch(deleteHearingType(deleteTarget.id));
          } else if (deleteTarget.category === "legal-frameworks") {
            await holdJurisdictionSwitch(
              deleteLegalFramework(deleteTarget.id)
            );
          }
          toast.success(`Deleted "${deleteName}"`);
          if (
            selection?.category === deleteTarget.category &&
            selection?.id === deleteTarget.id
          ) {
            setSelection(null);
          }
          setDeleteTarget(null);
          await reload(true);
        }}
      />
    </div>
  );
}

/** Why there is no legal wording to edit (or why it did not load), in words. */
function BlockedState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div
        role="alert"
        className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center shadow-sm"
      >
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h2 className="mb-2 text-lg font-semibold">
          Legal wording is not available
        </h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** The same form values: what the editors compare to know what is unsaved. */
function sameForm(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The saved version replaces the form only if nothing was typed while the save was under
// way; later edits stay, and show as unsaved.
function keepLaterEdits<T>(
  setForm: (update: (prev: T) => T) => void,
  submitted: T,
  saved: T,
): void {
  setForm((prev) => (sameForm(prev, submitted) ? saved : prev));
}

function resolveItemTitle(content: DocumentContent, sel: Selection): string {
  if (sel.category === "hearing-types") {
    return content.hearing_types.find((h) => h.id === sel.id)?.title ?? sel.id;
  }
  if (sel.category === "legal-frameworks") {
    return (
      content.legal_frameworks.find((f) => f.id === sel.id)?.title ?? sel.id
    );
  }
  return (
    content.anonymity.statuses.find((a) => a.id === sel.id)?.title ?? sel.id
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm space-y-2">
        <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h2 className="text-lg font-medium text-muted-foreground">
          Select an item
        </h2>
        <p className="text-sm text-muted-foreground/70">
          Choose a hearing type, legal framework, or anonymity status from the
          sidebar to view and edit its contents.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content panel (dispatches to the right editor)
// ---------------------------------------------------------------------------

function ContentPanel({
  content,
  selection,
  onRefresh,
  onSelect,
  onDelete,
}: {
  content: DocumentContent;
  selection: Selection;
  onRefresh: () => Promise<void>;
  onSelect: (sel: Selection | null) => void;
  onDelete: (sel: Selection) => void;
}) {
  if (selection.category === "hearing-types") {
    const item = selection.isNew
      ? undefined
      : content.hearing_types.find((h) => h.id === selection.id);
    return (
      <HearingTypeEditor
        item={item}
        isNew={!!selection.isNew}
        onSaved={async (saved) => {
          await onRefresh();
          onSelect({ category: "hearing-types", id: saved.id });
        }}
        onDelete={item ? () => onDelete(selection) : undefined}
      />
    );
  }

  if (selection.category === "legal-frameworks") {
    const item = selection.isNew
      ? undefined
      : content.legal_frameworks.find((f) => f.id === selection.id);
    return (
      <LegalFrameworkEditor
        item={item}
        isNew={!!selection.isNew}
        onSaved={async (saved) => {
          await onRefresh();
          onSelect({ category: "legal-frameworks", id: saved.id });
        }}
        onDelete={item ? () => onDelete(selection) : undefined}
      />
    );
  }

  const item = content.anonymity.statuses.find((a) => a.id === selection.id);
  if (!item) return <EmptyState />;

  return (
    <AnonymityEditor
      item={item}
      onSaved={async () => {
        await onRefresh();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Hearing Type Editor
// ---------------------------------------------------------------------------

function HearingTypeEditor({
  item,
  isNew,
  onSaved,
  onDelete,
}: {
  item?: HearingType;
  isNew: boolean;
  onSaved: (saved: HearingType) => Promise<void>;
  onDelete?: () => void;
}) {
  const blank = { id: "", title: "", hearing_title: "", hearing_description: "" };
  const [form, setForm] = useState<HearingType>(item ?? blank);
  const [saving, setSaving] = useState(false);
  // DIAAT-332: a switch reloads the tab, losing edits not saved, or a save under way.
  useJurisdictionSwitchGuard({
    busy: saving,
    unsaved: !sameForm(form, item ?? blank),
  });

  const set = (field: keyof HearingType, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  async function handleSave() {
    if (isNew && (!form.id || !form.title)) {
      toast.error("ID and Title are required");
      return;
    }
    setSaving(true);
    const submitted = form;
    try {
      if (isNew) {
        await holdJurisdictionSwitch(createHearingType(form));
        toast.success(`Created "${form.title}"`);
      } else {
        // The API's (trimmed) version is what is saved, so nothing shows as unsaved.
        const saved = await holdJurisdictionSwitch(
          updateHearingType(form.id, form)
        );
        keepLaterEdits(setForm, submitted, saved);
        toast.success(`Saved "${form.title}"`);
      }
      await onSaved(form);
    } catch (err: unknown) {
      toast.error(describeLegalWordingError(err, undefined, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorShell
      title={isNew ? "New Hearing Type" : form.title}
      subtitle={isNew ? "Create a new hearing type" : form.id}
      icon={<Gavel className="h-5 w-5" />}
      saving={saving}
      onSave={handleSave}
      onDelete={onDelete}
    >
      <div className="grid gap-5">
        {isNew && (
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="ID" description="Unique identifier (snake_case)">
              <Input
                value={form.id}
                onChange={(e) => set("id", e.target.value)}
                className="font-mono"
              />
            </FieldRow>
            <FieldRow label="Title">
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </FieldRow>
          </div>
        )}
        <FieldRow
          label="Hearing Title"
          description="Section heading in the generated document"
        >
          <Input
            value={form.hearing_title}
            onChange={(e) => set("hearing_title", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Hearing Description">
          <AdminEditor
            value={form.hearing_description}
            onChange={(v) => set("hearing_description", v)}
          />
        </FieldRow>
      </div>
    </EditorShell>
  );
}

// ---------------------------------------------------------------------------
// Legal Framework Editor
// ---------------------------------------------------------------------------

function LegalFrameworkEditor({
  item,
  isNew,
  onSaved,
  onDelete,
}: {
  item?: LegalFramework;
  isNew: boolean;
  onSaved: (saved: LegalFramework) => Promise<void>;
  onDelete?: () => void;
}) {
  const blank = { id: "", title: "", rank: 1, content: "", issues: [] };
  const [form, setForm] = useState<LegalFramework>(item ?? blank);
  const [saving, setSaving] = useState(false);
  const [newIssue, setNewIssue] = useState("");
  useJurisdictionSwitchGuard({
    busy: saving,
    unsaved: !sameForm(form, item ?? blank) || newIssue.trim() !== "",
  });

  const set = <K extends keyof LegalFramework>(
    field: K,
    value: LegalFramework[K]
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  function addIssue() {
    const trimmed = newIssue.trim();
    if (!trimmed) return;
    set("issues", [...form.issues, trimmed]);
    setNewIssue("");
  }

  function removeIssue(index: number) {
    set(
      "issues",
      form.issues.filter((_, i) => i !== index)
    );
  }

  function updateIssue(index: number, value: string) {
    const updated = [...form.issues];
    updated[index] = value;
    set("issues", updated);
  }

  async function handleSave() {
    if (isNew && (!form.id || !form.title)) {
      toast.error("ID and Title are required");
      return;
    }
    setSaving(true);
    const submitted = form;
    try {
      if (isNew) {
        await holdJurisdictionSwitch(createLegalFramework(form));
        toast.success(`Created "${form.title}"`);
      } else {
        const saved = await holdJurisdictionSwitch(
          updateLegalFramework(form.id, form)
        );
        keepLaterEdits(setForm, submitted, saved);
        toast.success(`Saved "${form.title}"`);
      }
      await onSaved(form);
    } catch (err: unknown) {
      toast.error(describeLegalWordingError(err, undefined, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorShell
      title={isNew ? "New Legal Framework" : form.title}
      subtitle={isNew ? "Create a new legal framework" : form.id}
      icon={<Scale className="h-5 w-5" />}
      saving={saving}
      onSave={handleSave}
      onDelete={onDelete}
    >
      <div className="grid gap-5">
        {isNew && (
          <div className="grid grid-cols-3 gap-4">
            <FieldRow label="ID" description="Unique identifier (snake_case)">
              <Input
                value={form.id}
                onChange={(e) => set("id", e.target.value)}
                className="font-mono"
              />
            </FieldRow>
            <FieldRow label="Title">
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Rank" description="Display order (lower = first)">
              <Input
                type="number"
                min={1}
                value={form.rank}
                onChange={(e) =>
                  set("rank", Number.parseInt(e.target.value, 10) || 1)
                }
              />
            </FieldRow>
          </div>
        )}

        <FieldRow label="Content" description="The main legal text">
          <AdminEditor
            value={form.content}
            onChange={(v) => set("content", v)}
          />
        </FieldRow>

        <div className="space-y-2">
          <Label>Issues / Questions</Label>
          <p className="text-xs text-muted-foreground">
            Legal questions generated in the document for this framework.
          </p>
          <div className="space-y-2">
            {form.issues.map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="mt-2.5 text-xs font-medium text-muted-foreground min-w-[24px]">
                  ({String.fromCharCode(97 + idx)})
                </span>
                <Textarea
                  value={issue}
                  onChange={(e) => updateIssue(idx, e.target.value)}
                  rows={2}
                  className="flex-1 text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-1 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40"
                  onClick={() => removeIssue(idx)}
                  aria-label={`Remove issue ${idx + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add a new issue&hellip;"
              aria-label="New issue"
              value={newIssue}
              onChange={(e) => setNewIssue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addIssue();
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={addIssue}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </div>
    </EditorShell>
  );
}

// ---------------------------------------------------------------------------
// Anonymity Editor
// ---------------------------------------------------------------------------

function AnonymityEditor({
  item,
  onSaved,
}: {
  item: AnonymityStatus;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<AnonymityStatus>(item);
  const [saving, setSaving] = useState(false);
  useJurisdictionSwitchGuard({ busy: saving, unsaved: !sameForm(form, item) });

  const set = (field: keyof AnonymityStatus, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  async function handleSave() {
    setSaving(true);
    const submitted = form;
    try {
      const saved = await holdJurisdictionSwitch(
        updateAnonymityStatus(form.id, form)
      );
      keepLaterEdits(setForm, submitted, saved);
      toast.success(`Saved "${form.title}"`);
      await onSaved();
    } catch (err: unknown) {
      toast.error(describeLegalWordingError(err, undefined, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorShell
      title={form.title}
      subtitle={form.id}
      icon={<Shield className="h-5 w-5" />}
      saving={saving}
      onSave={handleSave}
    >
      <div className="grid gap-5">
        <FieldRow label="Content">
          <AdminEditor
            value={form.content}
            onChange={(v) => set("content", v)}
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Header">
            <Input
              value={form.header}
              onChange={(e) => set("header", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Order Header">
            <Input
              value={form.order_header}
              onChange={(e) => set("order_header", e.target.value)}
            />
          </FieldRow>
        </div>
        <FieldRow label="Order Text">
          <AdminEditor
            value={form.order_text}
            onChange={(v) => set("order_text", v)}
          />
        </FieldRow>
      </div>
    </EditorShell>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function EditorShell({
  title,
  icon,
  saving,
  onSave,
  onDelete,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  saving: boolean;
  onSave: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-muted-foreground">{icon}</div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">
              {title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto">{children}</div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}

function DeleteConfirmDialog({
  open,
  name,
  warning,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  name: string;
  /** What else deleting it does (DIAAT-342), beyond removing the entry. */
  warning?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  useJurisdictionSwitchGuard({ busy: deleting, unsaved: false });

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onConfirm();
    } catch (err: unknown) {
      toast.error(describeLegalWordingError(err, undefined, "Delete failed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The entry will be permanently removed
            from the document content configuration.
            {warning && (
              <strong className="mt-2 block text-foreground">{warning}</strong>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
