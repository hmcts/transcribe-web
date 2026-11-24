"use client";

import { RefreshCcwIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AvailableTemplate,
  dateFormatMessage,
  hasAnswers,
  ownValue,
  type TemplateFormField,
  type TemplateValue,
  type TemplateValues,
  withPrefills,
} from "@/lib/templates-api";
import { DATE_FORMAT_HINT, isIsoDate } from "@/lib/typed-date";

/**
 * The Hearing Details form of an uploaded template (DIAAT-344): the judge chooses one
 * of the jurisdiction's templates, and fills the fields its admin set up, in their
 * order. BenchNotes fills the rest (the jurisdiction, the year, the judgment).
 */

function RequiredIndicator() {
  return (
    <>
      <span aria-hidden="true" className="ml-1 text-red-700 dark:text-red-300">
        *
      </span>
      <span className="sr-only"> required</span>
    </>
  );
}

export function templateLabel(template: AvailableTemplate): string {
  return template.service
    ? `${template.name} (${template.service})`
    : template.name;
}

export function TemplateForm({
  templates,
  templateId,
  onTemplateChange,
  values,
  onValuesChange,
  errors,
  onClear,
  headingLevel = 2,
  judgeName = "",
}: {
  templates: AvailableTemplate[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  values: TemplateValues;
  onValuesChange: (values: TemplateValues) => void;
  errors: Record<string, string>;
  /** Discard every answer (a dropdown or yes/no cannot be unanswered otherwise). */
  onClear: () => void;
  /** Its heading's level: 5 inside the admin area's preview (DIAAT-346). */
  headingLevel?: 2 | 5;
  /** The signed-in judge's name, for the fields that start with it (DIAAT-340). */
  judgeName?: string;
}) {
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const Heading = headingLevel === 5 ? "h5" : "h2";
  const set = (tag: string, value: TemplateValue | undefined) =>
    onValuesChange({ ...values, [tag]: value });
  // The judge's own answers, and the name in each field that starts with it until
  // they change it: it is not an answer of theirs until then.
  const shownValues = withPrefills(template, values, judgeName);

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between gap-2">
        <Heading className="text-lg font-semibold">Hearing details</Heading>
        {hasAnswers(values) && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <RefreshCcwIcon className="mr-1 h-4 w-4" aria-hidden />
            Clear answers
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="template-choice">Template</Label>
        {templates.length === 1 ? (
          <p id="template-choice" className="text-sm">
            {templateLabel(template)}
          </p>
        ) : (
          <Select value={template.id} onValueChange={onTemplateChange}>
            <SelectTrigger id="template-choice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {templateLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {template.fields.map((field) => (
        <TemplateFieldInput
          key={`${template.id}:${field.tag}`}
          field={field}
          value={ownValue(shownValues, field.tag)}
          error={ownValue(errors, field.tag)}
          onChange={(value) => set(field.tag, value)}
        />
      ))}
    </form>
  );
}

function TemplateFieldInput({
  field,
  value,
  error: givenError,
  onChange,
}: {
  field: TemplateFormField;
  value: TemplateValue | undefined;
  error?: string;
  onChange: (value: TemplateValue | undefined) => void;
}) {
  // Not from the tag, which can hold spaces (an ID reference list would split it).
  const id = useId();
  // DIAAT-340: a typed date that is not one, once the judge moves on from it.
  const [leftDate, setLeftDate] = useState(false);
  const error =
    givenError ??
    (leftDate &&
    field.type === "date" &&
    typeof value === "string" &&
    value.trim() !== "" &&
    !isIsoDate(value)
      ? dateFormatMessage(field.label)
      : undefined);
  const errorId = `${id}-error`;
  const labelId = `${id}-label`;
  const a11y = {
    "aria-describedby": error ? errorId : undefined,
    "aria-errormessage": error ? errorId : undefined,
    "aria-invalid": error ? true : undefined,
    "aria-required": field.required ? true : undefined,
  } as const;
  const label = (
    <Label id={labelId} htmlFor={id}>
      {field.label}
      {field.required && <RequiredIndicator />}
    </Label>
  );
  const message = error && (
    <p
      id={errorId}
      className="mt-1 text-xs font-medium text-red-600 dark:text-red-400"
    >
      {error}
    </p>
  );

  if (field.type === "multi_select" || field.type === "legal_issues") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className="space-y-3"
      >
        <legend id={labelId} className="text-sm font-medium">
          {field.label}
          {field.required && <RequiredIndicator />}
        </legend>
        {field.options.map((option, index) => {
          const optionId = `${id}-option-${index}`;
          return (
            <div key={option.value} className="flex items-start gap-3">
              <Checkbox
                id={optionId}
                checked={chosen.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...chosen, option.value]
                      : chosen.filter((v) => v !== option.value)
                  )
                }
              />
              <Label htmlFor={optionId} className="font-normal">
                {option.label}
              </Label>
            </div>
          );
        })}
        {message}
      </fieldset>
    );
  }

  if (field.type === "yes_no") {
    return (
      <fieldset aria-labelledby={labelId} className="space-y-2">
        <legend id={labelId} className="text-sm font-medium">
          {field.label}
          {field.required && <RequiredIndicator />}
        </legend>
        <RadioGroup
          value={value === true ? "yes" : value === false ? "no" : ""}
          onValueChange={(v) => onChange(v === "yes")}
          {...a11y}
        >
          {(["yes", "no"] as const).map((choice) => (
            <div key={choice} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${choice}`} value={choice} />
              <Label htmlFor={`${id}-${choice}`} className="font-normal">
                {choice === "yes" ? "Yes" : "No"}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {message}
      </fieldset>
    );
  }

  return (
    <div className="space-y-2">
      {label}
      {field.type === "date" ? (
        <>
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {DATE_FORMAT_HINT}
          </p>
          <DateInput
            id={id}
            label={field.label}
            value={typeof value === "string" ? value : undefined}
            onChange={(v) => {
              setLeftDate(false);
              onChange(v);
            }}
            onBlur={() => setLeftDate(true)}
            hintId={`${id}-hint`}
            errorId={error ? errorId : undefined}
            aria-invalid={a11y["aria-invalid"]}
            aria-required={a11y["aria-required"]}
          />
        </>
      ) : field.type === "dropdown" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} {...a11y}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type="text"
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          {...a11y}
        />
      )}
      {message}
    </div>
  );
}
