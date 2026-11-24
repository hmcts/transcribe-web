"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isIsoDate, parseTypedDate } from "@/lib/typed-date";

/**
 * A date the judge types, as DD/MM/YYYY, or picks from a calendar (DIAAT-340). Its
 * value is the date as YYYY-MM-DD; what they typed that is not a date is kept as typed,
 * so the form can say so, and they are told the format when they move on.
 */

function shown(value: string | undefined): string {
  if (!value) return "";
  return isIsoDate(value)
    ? `${value.slice(8)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : value;
}

/** The value for what was typed: the day, else the text as typed, else nothing. */
function typedValue(text: string): string | undefined {
  return text.trim() ? (parseTypedDate(text) ?? text) : undefined;
}

export function DateInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  hintId,
  errorId,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** The judge moved on from the typed date. */
  onBlur?: () => void;
  /** The hint giving the format, which the input refers to. */
  hintId: string;
  /** The message shown under the field, when there is one. */
  errorId?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [text, setText] = useState(() => shown(value));
  const [open, setOpen] = useState(false);
  // Changed from outside (cleared, or a draft restored): show it.
  useEffect(() => {
    setText((current) =>
      typedValue(current) === value ? current : shown(value)
    );
  }, [value]);
  const day = value && isIsoDate(value) ? value : undefined;

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(typedValue(e.target.value));
        }}
        onBlur={() => {
          // A day typed another way (1/3/2026) is shown as the hint shows it.
          const typed = typedValue(text);
          if (typed && isIsoDate(typed)) setText(shown(typed));
          onBlur?.();
        }}
        aria-describedby={errorId ? `${hintId} ${errorId}` : hintId}
        aria-errormessage={errorId}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Choose ${label} from a calendar`}
          >
            <CalendarIcon className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={`${label} calendar`}
          className="w-auto p-0"
          align="end"
        >
          <Calendar
            mode="single"
            selected={day ? new Date(`${day}T00:00:00`) : undefined}
            defaultMonth={day ? new Date(`${day}T00:00:00`) : undefined}
            aria-label={`${label} calendar`}
            onSelect={(date) => {
              if (!date) return;
              const picked = format(date, "yyyy-MM-dd");
              setText(shown(picked));
              onChange(picked);
              setOpen(false);
            }}
            className="rounded-md border"
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
