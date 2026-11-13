"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdminApiError } from "@/lib/admin-api";
import { type HistoryVersion, settingName, valueText } from "@/lib/history-api";
import { TemplateRefusedError } from "@/lib/templates-api";

/**
 * Who changed a jurisdiction's settings or a template, when, and what each setting was
 * before; going back to an earlier version (DIAAT-348). Shown on request, and loaded
 * again whenever the editor's version changes (a save, or going back).
 */

interface Failure {
  message: string;
  problems: string[];
}

function failureOf(err: unknown): Failure {
  return {
    message: err instanceof Error ? err.message : "Something went wrong",
    problems:
      err instanceof TemplateRefusedError || err instanceof AdminApiError
        ? err.problems
        : [],
  };
}

function when(savedAt: string): string {
  const at = new Date(savedAt);
  return Number.isNaN(at.getTime())
    ? savedAt
    : at.toLocaleString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function who(version: HistoryVersion): string {
  if (!version.saved_by) return "not recorded (changed outside the admin area)";
  return version.saved_by.name || version.saved_by.email;
}

export function SettingHistory({
  id,
  load,
  version,
  wordingKeys,
  locked,
  unsaved,
  onRestore,
}: {
  /** Unique on the page: the section's ids start with it. */
  id: string;
  /** Its versions, newest first. */
  load: () => Promise<HistoryVersion[]>;
  /** The version the editor shows: the history is loaded again when it changes. */
  version: string;
  /** The jurisdiction's screen text keys and what each is for. */
  wordingKeys?: Record<string, string>;
  /** A save, a new file or a delete is under way. */
  locked: boolean;
  /** Edits not saved yet: going back would drop them. */
  unsaved: boolean;
  /** Go back to version `number`; throws if it is refused. */
  onRestore: (number: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  // The latest load: one answering after another was asked for must not replace it.
  const latest = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloaded for a new version only
  useEffect(() => {
    if (!open) return;
    const asked = ++latest.current;
    // The old history's buttons would go back from a version no longer current.
    setVersions(null);
    setConfirming(null);
    setFailure(null);
    load().then(
      (loaded) => {
        if (asked === latest.current) setVersions(loaded);
      },
      (err) => {
        if (asked !== latest.current) return;
        // An API from before DIAAT-348 has no history route.
        const tooOld = (err as { status?: number } | null)?.status === 404;
        setFailure(
          tooOld
            ? {
                message: "The history needs the latest version of the API.",
                problems: [],
              }
            : failureOf(err)
        );
      }
    );
  }, [open, version]);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  async function restore(number: number) {
    setRestoring(true);
    setFailure(null);
    try {
      await onRestore(number);
      setConfirming(null);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-labelledby={`${id}-heading`}
    >
      <h4
        id={`${id}-heading`}
        className="flex items-center gap-2 font-semibold"
      >
        <History className="h-4 w-4" aria-hidden />
        History
      </h4>
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Show who changed what
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Each save, newest first: who saved it, when, and what each setting
            was before. Going back saves an earlier version again; who sees it
            stays as it is now.
          </p>
          {unsaved && (
            <p className="text-sm">
              Save or discard your changes before going back to an earlier
              version.
            </p>
          )}
          {failure && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm"
            >
              <p className="font-medium">{failure.message}</p>
              {failure.problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {failure.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {versions === null ? (
            !failure && (
              <p className="flex items-center gap-2 text-sm" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading the history
              </p>
            )
          ) : versions.length === 0 ? (
            <p className="text-sm">
              Nothing has been saved here since the history began.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="Versions">
              {versions.map((v) => (
                <li key={v.number} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    Version {v.number}: {when(v.saved_at)}, by {who(v)}
                  </p>
                  {v.restored_from !== null && (
                    <p>Went back to version {v.restored_from}.</p>
                  )}
                  {v.first ? (
                    <p className="text-muted-foreground">
                      The history starts here, with the settings as they were
                      then.
                    </p>
                  ) : v.changes.length === 0 ? (
                    <p className="text-muted-foreground">Nothing changed.</p>
                  ) : (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {v.changes.map((c) => (
                        <li key={c.setting}>
                          <span className="font-medium">
                            {settingName(c.setting, wordingKeys)}
                          </span>
                          : was {valueText(c.before)}, now {valueText(c.after)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!v.content_as_now && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {confirming === v.number ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={locked || unsaved || restoring}
                            onClick={() => void restore(v.number)}
                          >
                            {restoring ? (
                              <Loader2
                                className="mr-1 h-4 w-4 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
                            )}
                            Confirm: go back to version {v.number}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={restoring}
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locked || unsaved || restoring}
                          onClick={() => setConfirming(v.number)}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
                          Go back to version {v.number}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
