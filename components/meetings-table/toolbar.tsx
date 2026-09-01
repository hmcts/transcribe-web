"use client";

import type { Table } from "@tanstack/react-table";
import { format, parse } from "date-fns";
import { Check, CheckCheck, Search, Trash2, X } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RECENT_RECORDINGS_TABLE_ID } from "./ids";
import type { DateFilter, MeetingRow } from "./types";

const RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID =
  "recent-recordings-controls-description";
const RECENT_RECORDINGS_SEARCH_ID = "recent-recordings-search";
const RECENT_RECORDINGS_SEARCH_DESCRIPTION_ID =
  "recent-recordings-search-description";
const RECENT_RECORDINGS_DATE_FILTERS_LABEL_ID =
  "recent-recordings-date-filters-label";

interface MeetingsTableToolbarProps {
  table: Table<MeetingRow>;
  hearingTypeOptions: string[];
  dateFilter: DateFilter;
  selectedDateFilter: string;
  onDateFilterChange: (value: DateFilter) => void;
  onSelectedDateFilterChange: (value: string) => void;
  onBulkDelete: (meetings: MeetingRow[]) => Promise<void> | void;
  onBulkMarkDone: (meetings: MeetingRow[]) => Promise<void> | void;
  isBulkDeleting: boolean;
  isBulkMarkingDone: boolean;
}

function parseSelectedDateFilter(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function MeetingsTableToolbar({
  table,
  hearingTypeOptions,
  dateFilter,
  selectedDateFilter,
  onDateFilterChange,
  onSelectedDateFilterChange,
  onBulkDelete,
  onBulkMarkDone,
  isBulkDeleting,
  isBulkMarkingDone,
}: MeetingsTableToolbarProps) {
  const selectedMeetings = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original);

  const hearingTypeColumn = table.getColumn("hearingTypes");
  const selectedHearingType =
    (hearingTypeColumn?.getFilterValue() as string | undefined) ?? "all";
  const hasActiveSearch = Boolean(table.getState().globalFilter);
  const hasSelectedDateFilter = selectedDateFilter.length > 0;
  const hasActiveDateFilter = dateFilter !== "all" || hasSelectedDateFilter;
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    hasActiveSearch ||
    hasActiveDateFilter;
  const selectedDate = parseSelectedDateFilter(selectedDateFilter);

  const handleBulkMarkDone = () => {
    void Promise.resolve(onBulkMarkDone(selectedMeetings)).then(() => {
      table.resetRowSelection();
    });
  };

  const handleBulkDelete = () => {
    void Promise.resolve(onBulkDelete(selectedMeetings)).then(() => {
      table.resetRowSelection();
    });
  };

  return (
    <div role="search" aria-label="Search and filter recent recordings" className="space-y-4">
      <p id={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID} className="sr-only">
        Use these controls to filter the recent recordings table. Results update
        automatically as you search or apply filters.
      </p>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div
          className={cn(
            "grid gap-3 sm:items-center",
            isFiltered
              ? "sm:grid-cols-[minmax(0,1fr)_220px_auto]"
              : "sm:grid-cols-[minmax(0,1fr)_220px]"
          )}
        >
          <div className="relative w-full">
            <label htmlFor={RECENT_RECORDINGS_SEARCH_ID} className="sr-only">
              Search recent recordings
            </label>
            <p id={RECENT_RECORDINGS_SEARCH_DESCRIPTION_ID} className="sr-only">
              Search recent recordings by hearing title or date.
            </p>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={RECENT_RECORDINGS_SEARCH_ID}
              type="search"
              placeholder="Search hearings or dates"
              value={(table.getState().globalFilter as string) ?? ""}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              aria-controls={RECENT_RECORDINGS_TABLE_ID}
              aria-describedby={`${RECENT_RECORDINGS_SEARCH_DESCRIPTION_ID} ${RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}`}
              className="h-10 pl-9"
            />
          </div>
          <Select
            value={selectedHearingType}
            onValueChange={(value) => {
              hearingTypeColumn?.setFilterValue(
                value === "all" ? undefined : value
              );
            }}
          >
            <SelectTrigger
              className="h-10 w-full"
              aria-label="Filter recent recordings by hearing type"
              aria-controls={RECENT_RECORDINGS_TABLE_ID}
              aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
            >
              <SelectValue placeholder="Filter by hearing type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All hearing types</SelectItem>
              {hearingTypeOptions.map((hearingType) => (
                <SelectItem key={hearingType} value={hearingType}>
                  {hearingType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFiltered && (
            <Button
              variant="ghost"
              onClick={() => {
                table.resetColumnFilters();
                table.setGlobalFilter("");
                onDateFilterChange("all");
                onSelectedDateFilterChange("");
              }}
              className="h-10 justify-self-start whitespace-nowrap px-3"
            >
              Reset filters
              <X className="ml-2 size-4" />
            </Button>
          )}
        </div>

        <div
          role="group"
          aria-labelledby={RECENT_RECORDINGS_DATE_FILTERS_LABEL_ID}
          aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
          className="flex flex-wrap items-center gap-2 xl:justify-end"
        >
          <span
            id={RECENT_RECORDINGS_DATE_FILTERS_LABEL_ID}
            className="sr-only"
          >
            Filter recent recordings by date
          </span>
          <Button
            variant={
              dateFilter === "all" && !hasSelectedDateFilter
                ? "default"
                : "outline"
            }
            size="sm"
            onClick={() => {
              onDateFilterChange("all");
              onSelectedDateFilterChange("");
            }}
            aria-label="Show all recent recordings"
            aria-controls={RECENT_RECORDINGS_TABLE_ID}
            aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
            aria-pressed={dateFilter === "all" && !hasSelectedDateFilter}
          >
            {(dateFilter === "all" && !hasSelectedDateFilter) && <Check className="size-3" aria-hidden="true" />}
            All
          </Button>
          <Button
            variant={dateFilter === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              onDateFilterChange("today");
              onSelectedDateFilterChange("");
            }}
            aria-label="Filter recent recordings to today"
            aria-controls={RECENT_RECORDINGS_TABLE_ID}
            aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
            aria-pressed={dateFilter === "today"}
          >
            {dateFilter === "today" && <Check className="size-3" aria-hidden="true" />}
            Today
          </Button>
          <Button
            variant={dateFilter === "last7Days" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              onDateFilterChange("last7Days");
              onSelectedDateFilterChange("");
            }}
            aria-label="Filter recent recordings to the last 7 days"
            aria-controls={RECENT_RECORDINGS_TABLE_ID}
            aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
            aria-pressed={dateFilter === "last7Days"}
          >
            {dateFilter === "last7Days" && <Check className="size-3" aria-hidden="true" />}
            Last 7 days
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={hasSelectedDateFilter ? "default" : "outline"}
                size="sm"
                className={cn(
                  "justify-between gap-2",
                  !hasSelectedDateFilter && "text-muted-foreground"
                )}
                aria-label={
                  selectedDate
                    ? `Filter recent recordings by exact date, ${format(
                        selectedDate,
                        "dd/MM/yyyy"
                      )}`
                    : "Filter recent recordings by exact date"
                }
                aria-controls={RECENT_RECORDINGS_TABLE_ID}
                aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
                aria-pressed={hasSelectedDateFilter}
              >
                {hasSelectedDateFilter && <Check className="size-3" aria-hidden="true" />}
                <span>
                  {selectedDate
                    ? format(selectedDate, "dd/MM/yyyy")
                    : "Pick a date"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  onSelectedDateFilterChange(
                    date ? format(date, "yyyy-MM-dd") : ""
                  );
                  onDateFilterChange("all");
                }}
                className="rounded-md border"
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {hasSelectedDateFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={() => onSelectedDateFilterChange("")}
              aria-label="Clear exact date filter for recent recordings"
              aria-controls={RECENT_RECORDINGS_TABLE_ID}
              aria-describedby={RECENT_RECORDINGS_CONTROLS_DESCRIPTION_ID}
            >
              <X className="size-4" />
              Clear date
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {selectedMeetings.length} selected
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkMarkDone}
            disabled={
              selectedMeetings.length === 0 ||
              isBulkMarkingDone ||
              isBulkDeleting
            }
          >
            <CheckCheck className="mr-2 size-4" />
            {isBulkMarkingDone ? "Marking..." : "Mark as done"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedMeetings.length === 0 || isBulkMarkingDone}
              >
                <Trash2 className="mr-2 size-4" />
                Delete selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete selected recordings?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {selectedMeetings.length}{" "}
                  selected recording(s). This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isBulkDeleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isBulkDeleting}
                  onClick={handleBulkDelete}
                >
                  {isBulkDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
