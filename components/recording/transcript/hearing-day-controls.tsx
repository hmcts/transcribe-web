"use client";

import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { JobProgress } from "@/components/recording/job-status/job-progress";
import { JobStatusBadge } from "@/components/recording/job-status/job-status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/recording/ui/alert-dialog";
import { Button } from "@/components/recording/ui/button";
import { formatHearingDate, isHearingDate } from "@/lib/recording/hearing-date";
import {
  ALL_DAYS,
  type DaySelection,
  dayOptionLabel,
  NO_DAYS,
} from "@/lib/recording/hearing-days";
import type { HearingDay } from "@/lib/recording/types";

// The parts of a hearing's page about one of its days (DIAAT-428).

interface ChangeHearingDateProps {
  day: HearingDay;
  // Rejects with an Error whose message is for the user.
  onSave: (hearingDate: string) => Promise<void>;
}

/** "Change date", then the date and Save. */
export function ChangeHearingDate({ day, onSave }: ChangeHearingDateProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(day.hearingDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        type="button"
        className="text-sm text-primary hover:underline"
        aria-label={`Change the date of day ${day.dayNumber}`}
        onClick={() => {
          setValue(day.hearingDate);
          setError(null);
          setEditing(true);
        }}
      >
        Change date
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isHearingDate(value)) {
      setError("Enter the date of the hearing.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The date could not be changed."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <label className="flex items-center gap-2">
        <span className="sr-only">Date of day {day.dayNumber}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          className="rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={saving}
        onClick={() => setEditing(false)}
      >
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

interface DeleteDayButtonProps {
  day: HearingDay;
  // Rejects with an Error whose message is for the user.
  onDelete: () => Promise<void>;
}

export function DeleteDayButton({ day, onDelete }: DeleteDayButtonProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The day could not be deleted."
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete day ${day.dayNumber}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
          Delete day
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete day {day.dayNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the audio file and transcript of day{" "}
            {day.dayNumber} (&ldquo;{day.audioFileName}&rdquo;). The other days
            of the hearing are kept. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Stays open if the delete fails, with the error.
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface HearingDayHeaderProps {
  day: HearingDay;
  // The day the audio player and the accuracy sidebar are on.
  selected: boolean;
  // Only for a day with a transcript to listen to.
  onSelect?: () => void;
  onChangeDate?: (hearingDate: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/** "Day 2 · 11 November 2026 · day2.mp3 · Completed", and what can be done with the day. */
export function HearingDayHeader({
  day,
  selected,
  onSelect,
  onChangeDate,
  onDelete,
}: HearingDayHeaderProps) {
  const headingId = `day-${day.id}-heading`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-2">
      <h3 id={headingId} className="font-semibold">
        Day {day.dayNumber}
      </h3>
      <span className="text-sm">{formatHearingDate(day.hearingDate)}</span>
      <span className="truncate max-w-56 text-sm text-muted-foreground">
        {day.audioFileName}
      </span>
      <JobStatusBadge status={day.status} />
      <span className="ml-auto flex flex-wrap items-center gap-3">
        {onSelect && (
          <button
            type="button"
            className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            aria-pressed={selected}
            disabled={selected}
            onClick={onSelect}
          >
            {selected ? "In the player" : "Listen to this day"}
          </button>
        )}
        {onChangeDate && <ChangeHearingDate day={day} onSave={onChangeDate} />}
        {onDelete && <DeleteDayButton day={day} onDelete={onDelete} />}
      </span>
    </div>
  );
}

export function dayTranscriptId(day: HearingDay): string {
  return `day-${day.id}-transcript`;
}

interface DaySelectorProps {
  days: HearingDay[];
  value: DaySelection;
  onChange: (selection: DaySelection) => void;
}

/** Which days' transcripts are expanded (DIAAT-429). */
export function DaySelector({ days, value, onChange }: DaySelectorProps) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <span className="font-medium">Show</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-controls={days.map(dayTranscriptId).join(" ")}
        className="max-w-full truncate rounded-md border border-border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value={ALL_DAYS}>All</option>
        <option value={NO_DAYS}>None</option>
        {days.map((day) => (
          <option key={day.id} value={day.id}>
            {dayOptionLabel(day)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What a day without a transcript to show says instead. */
export function DayWithoutTranscript({ day }: { day: HearingDay }) {
  if (day.status === "PENDING" || day.status === "PROCESSING") {
    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          {day.status === "PENDING"
            ? "This recording is being prepared for transcription. This page updates automatically."
            : "Transcription is still in progress. This page updates automatically."}
        </p>
        <JobProgress job={day} />
      </div>
    );
  }
  if (day.status === "FAILED") {
    return (
      <div className="bg-destructive/5 p-4">
        <p className="mb-1 font-medium text-destructive">
          Transcription failed
        </p>
        <p className="text-sm text-muted-foreground">
          {day.errorMessage ?? "An unknown error occurred."}
        </p>
      </div>
    );
  }
  return (
    <p className="p-4 text-sm text-muted-foreground">
      This day&rsquo;s transcript has no content to display.
    </p>
  );
}
