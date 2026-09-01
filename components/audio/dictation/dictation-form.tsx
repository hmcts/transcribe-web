"use client";

import { RefreshCcwIcon } from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Separator } from "@/components/ui/separator";
import type { DocumentContent } from "@/lib/editor-contracts";
import { getJudgeNameFromEmail, getJudgeTitleFromEmail } from "@/lib/utils";
import { useUserSettings } from "@/providers/user-settings";
import {
  type DictationFormValues,
  dictationFormSchema,
  getDefaultFormValues,
  getFormFields,
  sanitizeFormValues,
  shouldShowField,
} from "./formData";

type FormErrors = Partial<Record<keyof DictationFormValues, string>>;

type DictationFormProps = {
  onFormStateChange?: (values: DictationFormValues) => void;
  externalErrors?: FormErrors;
  initialValues?: DictationFormValues;
  documentContent?: DocumentContent;
};

const APPEAL_DATE_PICKER_PROPS = {
  captionLayout: "dropdown" as const,
  startMonth: new Date(new Date().getFullYear() - 10, 0),
  endMonth: new Date(),
};

const getFieldLabelId = (name: keyof DictationFormValues) =>
  `${String(name)}-label`;

const getFieldErrorId = (name: keyof DictationFormValues) =>
  `${String(name)}-error`;

const getFieldHintId = (name: keyof DictationFormValues) =>
  `${String(name)}-hint`;

const getFieldDescriptionIds = (
  name: keyof DictationFormValues,
  error?: string,
  extraIds: string[] = []
) => {
  const descriptionIds = [...extraIds];

  if (error) {
    descriptionIds.push(getFieldErrorId(name));
  }

  return descriptionIds.length > 0 ? descriptionIds.join(" ") : undefined;
};

const getFieldA11yProps = (
  name: keyof DictationFormValues,
  error?: string,
  options?: {
    extraDescriptionIds?: string[];
    required?: boolean;
  }
) => ({
  "aria-describedby": getFieldDescriptionIds(
    name,
    error,
    options?.extraDescriptionIds
  ),
  "aria-errormessage": error ? getFieldErrorId(name) : undefined,
  "aria-invalid": error ? true : undefined,
  "aria-required": options?.required ? true : undefined,
});

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

function DictationForm({
  onFormStateChange,
  externalErrors,
  initialValues,
  documentContent,
}: DictationFormProps) {
  const { user } = useUserSettings();
  const [formState, setFormState] = useState<DictationFormValues>(
    () => initialValues ?? getDefaultFormValues("")
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [hasManuallyEditedJudgeName, setHasManuallyEditedJudgeName] =
    useState(false);

  // Track if we're currently syncing from parent to prevent callback loops
  const isSyncingFromParentRef = useRef(false);

  const judgeTitle = user?.email ? getJudgeTitleFromEmail(user.email) : "";
  const judgeName = user?.email ? getJudgeNameFromEmail(user.email) : "";
  const formFields = useMemo(
    () => getFormFields(documentContent),
    [documentContent]
  );

  // Sync initialValues prop to internal state when it changes (e.g., on remount)
  // Use a serialized comparison to detect actual data changes
  const _initialValuesJson = JSON.stringify(initialValues);
  useEffect(() => {
    if (initialValues) {
      isSyncingFromParentRef.current = true;
      setFormState(initialValues);
      // Reset flag after state update completes
      setTimeout(() => {
        isSyncingFromParentRef.current = false;
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  // Update judge name when user data loads (only if not manually edited)
  useEffect(() => {
    if (
      judgeName &&
      !hasManuallyEditedJudgeName &&
      formState.judgeName === ""
    ) {
      setFormState((prev) => ({ ...prev, judgeName: judgeName || "" }));
    }
  }, [judgeName, hasManuallyEditedJudgeName, formState.judgeName]);

  useEffect(() => {
    if (!documentContent) return;

    setFormState((prev) => sanitizeFormValues(prev, documentContent));
  }, [documentContent]);

  const headerFields = useMemo(
    () =>
      formFields.filter(
        (field) =>
          (field.name === "jurisdiction" ||
            field.name === "hearingDate" ||
            field.name === "judgeName") &&
          shouldShowField(field.name, formState)
      ),
    [formFields, formState]
  );

  const mainFields = useMemo(
    () =>
      formFields.filter(
        (field) =>
          field.name !== "jurisdiction" &&
          field.name !== "hearingDate" &&
          field.name !== "judgeName" &&
          field.name !== "locationOther" && // Rendered inline with location field
          field.name !== "appellantRepDetails" && // Rendered inline with appellantRepType field
          field.name !== "respondentRepName" && // Rendered inline with respondentRepType field
          shouldShowField(field.name, formState)
      ),
    [formFields, formState]
  );

  useEffect(() => {
    // Don't call parent callback when we're syncing FROM parent to avoid loops
    if (onFormStateChange && !isSyncingFromParentRef.current) {
      onFormStateChange(formState);
    }
  }, [formState, onFormStateChange]);

  useEffect(() => {
    setErrors((prev) => {
      const next = { ...prev };

      Object.keys(prev).forEach((key) => {
        const typedKey = key as keyof DictationFormValues;

        if (!shouldShowField(typedKey, formState)) {
          delete next[typedKey];
        }
      });

      return next;
    });
  }, [formState]);

  // Update errors when external errors are provided
  useEffect(() => {
    if (externalErrors) {
      setErrors(externalErrors);
    }
  }, [externalErrors]);

  const updateField = (
    name: keyof DictationFormValues,
    value: string | string[]
  ) => {
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleTextChange =
    (name: keyof DictationFormValues) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      if (name === "judgeName") {
        setHasManuallyEditedJudgeName(true);
      }
      updateField(name, event.target.value);
    };

  const handleSelectChange =
    (name: keyof DictationFormValues) => (value: string) => {
      updateField(name, value);
    };

  const handleDateChange = (name: keyof DictationFormValues, value: string) => {
    updateField(name, value);
  };

  const handleCheckboxChange =
    (name: keyof DictationFormValues, option: string) => (checked: boolean) => {
      const currentValues = Array.isArray(formState[name])
        ? (formState[name] as string[])
        : [];

      const newValues = checked
        ? [...currentValues, option]
        : currentValues.filter((v) => v !== option);

      updateField(name, newValues);
    };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = dictationFormSchema.safeParse(formState);

    if (!result.success) {
      const fieldErrors: FormErrors = {};

      result.error.issues.forEach(({ path, message }) => {
        const key = path[0] as keyof DictationFormValues | undefined;

        if (key) {
          fieldErrors[key] = message;
        }
      });

      setErrors(fieldErrors);
      toast.error("Please review the highlighted fields.");
      const firstErrorKey = Object.keys(fieldErrors)[0];
      if (firstErrorKey) {
        document.getElementById(firstErrorKey)?.focus();
      }
      return;
    }

    setErrors({});
    toast.success("Session form saved.");
  };

  const handleReset = () => {
    setFormState(getDefaultFormValues(judgeName || ""));
    setErrors({});
    setHasManuallyEditedJudgeName(false);
  };

  return (
    <>
      <div className="flex flex-row items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Hearing details
        </h1>
        <Button
          variant="outline"
          type="button"
          onClick={handleReset}
          className="w-min hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-950/50 border-neutral-200 dark:border-neutral-800 [&>svg]:text-neutral-900 dark:[&>svg]:text-neutral-100"
          // "w-min !m-0 hover:bg-neutral-100 dark:hover:bg-neutral-950/50 border-neutral-200 dark:border-neutral-800"
          size="sm"
        >
          <RefreshCcwIcon className="size-4 mr-2" />
          Reset
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col gap-4">
          {headerFields.map((field) => {
            const fieldValue = formState[field.name];
            const error = errors[field.name];
            const fieldA11yProps = getFieldA11yProps(field.name, error, {
              required: field.required,
            });

            return (
              <div key={field.id} className="space-y-2">
                <Label
                  id={getFieldLabelId(field.name)}
                  htmlFor={field.name}
                  className={error ? "text-red-600 dark:text-red-400" : ""}
                >
                  {field.label}
                  {field.required && <RequiredIndicator />}
                </Label>

                {field.fieldType === "text" && field.name === "judgeName" && (
                  <>
                    {judgeTitle && (
                      <p className="text-sm text-muted-foreground">
                        Title:{" "}
                        <span className="font-medium text-foreground">
                          {judgeTitle}
                        </span>
                      </p>
                    )}
                    <Input
                      id={field.name}
                      placeholder="e.g. A Smith"
                      value={typeof fieldValue === "string" ? fieldValue : ""}
                      onChange={handleTextChange(field.name)}
                      {...fieldA11yProps}
                      className={
                        error
                          ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                          : ""
                      }
                    />
                  </>
                )}

                {field.fieldType === "text" && field.name !== "judgeName" && (
                  <Input
                    id={field.name}
                    placeholder="Enter a value"
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={handleTextChange(field.name)}
                    {...fieldA11yProps}
                    className={
                      error
                        ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                        : ""
                    }
                  />
                )}

                {field.fieldType === "date" && (
                  <DatePicker
                    id={field.name}
                    label={field.label}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(value) => handleDateChange(field.name, value)}
                    placeholder="Select date"
                    {...(field.name === "appealableDecisionDate" && APPEAL_DATE_PICKER_PROPS)}
                    {...fieldA11yProps}
                    className={
                      error
                        ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                        : ""
                    }
                  />
                )}

                {field.fieldType === "select" && (
                  <Select
                    value={
                      typeof fieldValue === "string" && fieldValue.length > 0
                        ? fieldValue
                        : undefined
                    }
                    onValueChange={handleSelectChange(field.name)}
                  >
                    <SelectTrigger
                      id={field.name}
                      {...fieldA11yProps}
                      className={
                        error
                          ? "border-red-500 dark:border-red-400 focus:ring-red-500 dark:focus:ring-red-400"
                          : ""
                      }
                    >
                      <SelectValue
                        placeholder="Select an option"
                        className="text-left"
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((option) => (
                        <SelectItem value={option.value} key={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {error && (
                  <p
                    id={getFieldErrorId(field.name)}
                    className="text-xs font-medium text-red-600 dark:text-red-400 mt-1"
                  >
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Main Form Fields */}
        <div className="flex flex-col gap-6">
          {mainFields.map((field) => {
            const fieldValue = formState[field.name];
            const error = errors[field.name];
            const fieldA11yProps = getFieldA11yProps(field.name, error, {
              required: field.required,
            });

            return (
              <div key={field.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {field.fieldType === "multiselect" ? (
                    <Label
                      id={getFieldLabelId(field.name)}
                      className={error ? "text-red-600 dark:text-red-400" : ""}
                    >
                      {field.label}
                      {field.required && <RequiredIndicator />}
                    </Label>
                  ) : (
                    <Label
                      id={getFieldLabelId(field.name)}
                      htmlFor={field.name}
                      className={error ? "text-red-600 dark:text-red-400" : ""}
                    >
                      {field.label}
                      {field.required && <RequiredIndicator />}
                    </Label>
                  )}
                </div>

                {field.fieldType === "text" && (
                  <Input
                    id={field.name}
                    placeholder="Enter a value"
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={handleTextChange(field.name)}
                    {...fieldA11yProps}
                    className={
                      error
                        ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                        : ""
                    }
                  />
                )}

                {field.fieldType === "date" && (
                  <DatePicker
                    id={field.name}
                    label={field.label}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(value) => handleDateChange(field.name, value)}
                    placeholder="Select date"
                    {...(field.name === "appealableDecisionDate" && APPEAL_DATE_PICKER_PROPS)}
                    {...fieldA11yProps}
                    className={
                      error
                        ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                        : ""
                    }
                  />
                )}

                {field.fieldType === "select" && (
                  <>
                    <Select
                      value={
                        typeof fieldValue === "string" && fieldValue.length > 0
                          ? fieldValue
                          : undefined
                      }
                      onValueChange={handleSelectChange(field.name)}
                    >
                      <SelectTrigger
                        id={field.name}
                        {...fieldA11yProps}
                        className={
                          error
                            ? "border-red-500 dark:border-red-400 focus:ring-red-500 dark:focus:ring-red-400"
                            : ""
                        }
                      >
                        <SelectValue
                          placeholder="Select an option"
                          className="text-left"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((option) => (
                          <SelectItem value={option.value} key={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Inline "Other" location text field */}
                    {field.name === "location" &&
                      formState.location === "Other" && (
                        <div className="mt-3 ml-4 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                          <Label
                            id={getFieldLabelId("locationOther")}
                            htmlFor="locationOther"
                            className={
                              errors.locationOther
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }
                          >
                            Specify location
                            <RequiredIndicator />
                          </Label>
                          <Input
                            id="locationOther"
                            placeholder="Enter location"
                            value={formState.locationOther}
                            onChange={handleTextChange("locationOther")}
                            {...getFieldA11yProps(
                              "locationOther",
                              errors.locationOther,
                              {
                                required: true,
                              }
                            )}
                            className={`mt-2 ${
                              errors.locationOther
                                ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                                : ""
                            }`}
                          />
                          {errors.locationOther && (
                            <p
                              id={getFieldErrorId("locationOther")}
                              className="text-xs font-medium text-red-600 dark:text-red-400 mt-1"
                            >
                              {errors.locationOther}
                            </p>
                          )}
                        </div>
                      )}
                    {/* Inline appellant representative details field */}
                    {field.name === "appellantRepType" &&
                      formState.appellantRepType === "represented" && (
                        <div className="mt-3 ml-4 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                          <Label
                            id={getFieldLabelId("appellantRepDetails")}
                            htmlFor="appellantRepDetails"
                            className={
                              errors.appellantRepDetails
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }
                          >
                            Representative name and role
                            <RequiredIndicator />
                          </Label>
                          <Input
                            id="appellantRepDetails"
                            placeholder="e.g. Mr Smith, Counsel"
                            value={formState.appellantRepDetails}
                            onChange={handleTextChange("appellantRepDetails")}
                            {...getFieldA11yProps(
                              "appellantRepDetails",
                              errors.appellantRepDetails,
                              {
                                required: true,
                              }
                            )}
                            className={`mt-2 ${
                              errors.appellantRepDetails
                                ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                                : ""
                            }`}
                          />
                          {errors.appellantRepDetails && (
                            <p
                              id={getFieldErrorId("appellantRepDetails")}
                              className="text-xs font-medium text-red-600 dark:text-red-400 mt-1"
                            >
                              {errors.appellantRepDetails}
                            </p>
                          )}
                        </div>
                      )}
                    {/* Inline respondent representative name field */}
                    {field.name === "respondentRepType" &&
                      (formState.respondentRepType === "hopo" ||
                        formState.respondentRepType === "counsel") && (
                        <div className="mt-3 ml-4 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                          <Label
                            id={getFieldLabelId("respondentRepName")}
                            htmlFor="respondentRepName"
                            className={
                              errors.respondentRepName
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }
                          >
                            Name of representative
                            <RequiredIndicator />
                          </Label>
                          <Input
                            id="respondentRepName"
                            placeholder="e.g. Mr Jones"
                            value={formState.respondentRepName}
                            onChange={handleTextChange("respondentRepName")}
                            {...getFieldA11yProps(
                              "respondentRepName",
                              errors.respondentRepName,
                              {
                                required: true,
                              }
                            )}
                            className={`mt-2 ${
                              errors.respondentRepName
                                ? "border-red-500 dark:border-red-400 focus-visible:ring-red-500 dark:focus-visible:ring-red-400"
                                : ""
                            }`}
                          />
                          {errors.respondentRepName && (
                            <p
                              id={getFieldErrorId("respondentRepName")}
                              className="text-xs font-medium text-red-600 dark:text-red-400 mt-1"
                            >
                              {errors.respondentRepName}
                            </p>
                          )}
                        </div>
                      )}
                  </>
                )}

                {field.fieldType === "multiselect" && (
                  <fieldset
                    aria-labelledby={getFieldLabelId(field.name)}
                    aria-describedby={getFieldDescriptionIds(
                      field.name,
                      error,
                      [getFieldHintId(field.name)]
                    )}
                    aria-invalid={error ? true : undefined}
                    className={`space-y-4 rounded-md border bg-white dark:bg-neutral-950 p-4 ${
                      error
                        ? "border-red-500 dark:border-red-400"
                        : "border-neutral-200 dark:border-neutral-800"
                    }`}
                  >
                    <p
                      id={getFieldHintId(field.name)}
                      className="text-sm text-muted-foreground"
                    >
                      Select all options that apply.
                    </p>
                    {field.options?.map((option) => {
                      const isChecked = Array.isArray(fieldValue)
                        ? (fieldValue as string[]).includes(option.value)
                        : false;

                      return (
                        <div
                          key={option.value}
                          className="flex items-start gap-3"
                        >
                          <Checkbox
                            id={`${field.name}-${option.value}`}
                            checked={isChecked}
                            onCheckedChange={handleCheckboxChange(
                              field.name,
                              option.value
                            )}
                            aria-describedby={getFieldDescriptionIds(
                              field.name,
                              error,
                              [getFieldHintId(field.name)]
                            )}
                            aria-invalid={error ? true : undefined}
                          />
                          <Label
                            htmlFor={`${field.name}-${option.value}`}
                            className="text-sm font-normal leading-tight cursor-pointer flex-1"
                          >
                            {option.label}
                          </Label>
                        </div>
                      );
                    })}
                  </fieldset>
                )}

                {error && (
                  <p
                    id={getFieldErrorId(field.name)}
                    className="text-xs font-medium text-red-600 dark:text-red-400 mt-1"
                  >
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </form>
    </>
  );
}

export default DictationForm;
