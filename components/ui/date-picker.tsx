"use client";

import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  captionLayout?: ComponentProps<typeof Calendar>["captionLayout"];
  startMonth?: Date;
  endMonth?: Date;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-errormessage"?: string;
  "aria-required"?: boolean;
};

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  captionLayout,
  startMonth,
  endMonth,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
  "aria-required": ariaRequired,
}: DatePickerProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const hasMountedRef = useRef(false);
  const selectedDate = parseDate(value);
  const triggerId = id ?? `date-picker-${generatedId}`;
  const dialogId = `${triggerId}-dialog`;
  const dialogTitleId = `${triggerId}-dialog-title`;
  const dialogDescriptionId = `${triggerId}-dialog-description`;
  const dialogLabel = label ? `${label} calendar` : "Choose a date";
  const formattedDate = selectedDate ? format(selectedDate, "PPP") : null;
  const triggerLabel = label ?? "Date";

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (formattedDate) {
      setSelectionAnnouncement(`${triggerLabel} selected ${formattedDate}.`);
      return;
    }

    setSelectionAnnouncement(`${triggerLabel} cleared.`);
  }, [formattedDate, triggerLabel]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <p className="sr-only" aria-live="polite">
        {selectionAnnouncement}
      </p>
      {open && (
        <p className="sr-only" aria-live="polite">
          {dialogLabel} opened. Use arrow keys to move between days and Enter to
          select a date.
        </p>
      )}
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          variant="outline"
          data-empty={!selectedDate}
          aria-controls={dialogId}
          aria-describedby={ariaDescribedBy}
          aria-errormessage={ariaErrorMessage}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-invalid={ariaInvalid}
          aria-label={
            formattedDate
              ? `${triggerLabel}, ${formattedDate}`
              : `${triggerLabel}, no date selected`
          }
          aria-required={ariaRequired}
          className={cn(
            "h-10 w-full justify-between border-neutral-200 bg-background px-3 py-2 text-left font-normal hover:bg-muted/50 hover:border-neutral-400 dark:border-neutral-800 dark:hover:bg-muted/40 dark:hover:border-neutral-600 data-[empty=true]:text-muted-foreground",
            className
          )}
          type="button"
        >
          {formattedDate ?? placeholder}
          <CalendarIcon className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={dialogId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        className="w-auto p-0"
        align="start"
      >
        <div className="sr-only">
          <h2 id={dialogTitleId}>{dialogLabel}</h2>
          <p id={dialogDescriptionId}>
            Select a date from the calendar. Use arrow keys to move between days
            and Enter to choose a date.
          </p>
        </div>
        <Calendar
          mode="single"
          selected={selectedDate}
          aria-label={dialogLabel}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            if (date) {
              setOpen(false);
            }
          }}
          captionLayout={captionLayout}
          startMonth={startMonth}
          endMonth={endMonth}
          className="rounded-md border"
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
