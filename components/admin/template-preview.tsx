"use client";

import { Download, Eye, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { TemplateForm } from "@/components/audio/dictation/template-form";
import { Button } from "@/components/ui/button";
import {
  type AdminTemplate,
  type AvailableTemplate,
  fetchTemplateForm,
  fittingValue,
  missingValues,
  ownValue,
  previewTemplate,
  sampleValues,
  TemplateRefusedError,
  type TemplateValues,
  valuesToSend,
} from "@/lib/templates-api";

/**
 * Preview a template before any judge sees it (DIAAT-346): fill its Hearing Details
 * form, as judges will get it, with sample details, and download the document a judge
 * would get from them. What stops the preview is said in plain words.
 *
 * The preview is of the saved template, so it waits for unsaved edits to be saved.
 */

interface Failure {
  message: string;
  problems: string[];
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  // In the page, and the URL kept until the download has started: Firefox and Safari
  // drop a download from a detached link or a URL revoked straight away.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function failureOf(err: unknown): Failure {
  if (err instanceof TemplateRefusedError)
    return { message: err.message, problems: err.problems };
  return {
    message: err instanceof Error ? err.message : "Something went wrong",
    problems: [],
  };
}

export function TemplatePreview({
  code,
  template,
  unsaved,
  locked,
  values,
  onValuesChange,
}: {
  code: string;
  /** The saved template: what the preview is made from. */
  template: AdminTemplate;
  /** Edits not saved yet: the preview would not show them. */
  unsaved: boolean;
  /** A save, a new file or a delete is under way. */
  locked: boolean;
  /** The sample details, kept by the list across saves of this template. */
  values: TemplateValues;
  onValuesChange: (values: TemplateValues) => void;
}) {
  const [form, setForm] = useState<AvailableTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [making, setMaking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const headingId = useId();
  const incomplete = template.problems.length > 0;
  // The latest form request: one that answers after another was made, or after the
  // editor reopened (a save remounts it), must not overwrite the details since.
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  async function open() {
    const asked = ++latest.current;
    const current = () => asked === latest.current;
    setLoading(true);
    setFailure(null);
    try {
      const loaded = await fetchTemplateForm(code, template.id);
      if (!current()) return;
      setForm(loaded);
      // The details kept from before, as they fit the saved fields; a sample for each
      // field not filled in yet (new after a save) or whose answer no longer fits.
      const samples = sampleValues(loaded);
      onValuesChange(
        Object.fromEntries(
          loaded.fields.map((f) => {
            const kept = Object.hasOwn(values, f.tag)
              ? fittingValue(f, ownValue(values, f.tag))
              : null;
            return [f.tag, kept === null ? ownValue(samples, f.tag) : kept];
          })
        )
      );
    } catch (err) {
      if (current()) setFailure(failureOf(err));
    } finally {
      if (current()) setLoading(false);
    }
  }

  async function download() {
    if (!form) return;
    const missing = missingValues(form, values);
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setFailure({
        message: "Fill in the required sample details first.",
        problems: [],
      });
      return;
    }
    setMaking(true);
    setFailure(null);
    try {
      const file = await previewTemplate(code, template.id, {
        values: valuesToSend(form, values),
        version: template.version,
      });
      saveFile(file, `Preview - ${template.name}.docx`);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setMaking(false);
    }
  }

  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-labelledby={headingId}
    >
      <h4 id={headingId} className="font-semibold">
        Preview {template.name}
      </h4>
      <p className="text-sm text-muted-foreground">
        Fill in sample hearing details as a judge would, then download the
        document a judge would get. Sample text stands in for the judge's
        dictation.
        {template.stage === "draft"
          ? " Judges cannot choose this template yet."
          : template.stage === "test"
            ? " Only its test group and administrators can choose this template."
            : ""}
      </p>

      {incomplete ? (
        <p className="text-sm">
          Link every box to a field and save before previewing: see what is
          missing above.
        </p>
      ) : unsaved ? (
        <p className="text-sm">
          Save your changes first: the preview is made from the saved template.
        </p>
      ) : null}

      {failure && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium">The preview could not be made.</p>
          {failure.problems.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {failure.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">{failure.message}</p>
          )}
        </div>
      )}

      {form ? (
        <>
          <TemplateForm
            headingLevel={5}
            templates={[form]}
            templateId={form.id}
            onTemplateChange={() => undefined}
            values={values}
            onValuesChange={(next) => {
              onValuesChange(next);
              setErrors({});
            }}
            errors={errors}
            onClear={() => {
              // Each field left unanswered, not forgotten: a save does not refill it.
              onValuesChange(
                Object.fromEntries(form.fields.map((f) => [f.tag, undefined]))
              );
              setErrors({});
            }}
          />
          <Button
            onClick={() => void download()}
            disabled={incomplete || unsaved || locked || making}
          >
            {making ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-1 h-4 w-4" aria-hidden />
            )}
            Download preview
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => void open()}
          disabled={incomplete || unsaved || locked || loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Eye className="mr-1 h-4 w-4" aria-hidden />
          )}
          Fill in sample details
        </Button>
      )}
    </section>
  );
}
