"use client";

import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { format, isSameDay, isToday, isYesterday, parse } from "date-fns";
import React from "react";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMeetingsColumns } from "./columns";
import { RECENT_RECORDINGS_TABLE_ID } from "./ids";
import { MeetingsTableToolbar } from "./toolbar";
import type { DateFilter, MeetingRow } from "./types";

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDateSearchTerms(date: Date): string[] {
  const terms = [
    format(date, "dd/MM/yyyy"),
    format(date, "d/M/yyyy"),
    format(date, "dd-MM-yyyy"),
    format(date, "d-M-yyyy"),
    format(date, "dd.MM.yyyy"),
    format(date, "d.M.yyyy"),
    format(date, "yyyy-MM-dd"),
    format(date, "dd/MM/yy"),
    format(date, "d/M/yy"),
    format(date, "EEEE"),
    format(date, "EEE"),
    format(date, "EEEE d MMMM yyyy"),
    format(date, "EEEE d MMM yyyy"),
    format(date, "d MMMM yyyy"),
    format(date, "d MMM yyyy"),
    format(date, "MMMM yyyy"),
    format(date, "MMM yyyy"),
    format(date, "MMMM"),
    format(date, "MMM"),
    format(date, "do MMMM yyyy"),
    format(date, "do MMM yyyy"),
    format(date, "PP"),
    format(date, "PPPP"),
    format(date, "PPpp"),
    format(date, "p"),
    format(date, "HH:mm"),
    format(date, "h:mm a"),
  ];

  if (isToday(date)) {
    terms.push("today");
  } else if (isYesterday(date)) {
    terms.push("yesterday");
  }

  return terms;
}

function buildMeetingSearchIndex(meeting: MeetingRow): string {
  const searchableFields = [
    meeting.title,
    meeting.createdLabel,
    meeting.createdExactLabel,
    ...buildDateSearchTerms(new Date(meeting.createdDatetime ?? Date.now())),
    meeting.hearingTypes.join(" "),
  ];

  return searchableFields
    .filter(Boolean)
    .flatMap((value) => {
      const stringValue = String(value);
      const normalizedValue = normalizeSearchValue(stringValue);
      return normalizedValue && normalizedValue !== stringValue.toLowerCase()
        ? [stringValue, normalizedValue]
        : [stringValue];
    })
    .join(" ")
    .toLowerCase();
}

function matchesDateFilter(date: Date, filter: DateFilter): boolean {
  if (filter === "today") {
    return isToday(date);
  }

  if (filter === "last7Days") {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    return date >= sevenDaysAgo && date <= now;
  }

  return true;
}

function parseSelectedDateFilter(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function matchesSelectedDate(date: Date, selectedDateFilter: string): boolean {
  if (!selectedDateFilter) {
    return true;
  }

  const selectedDate = parseSelectedDateFilter(selectedDateFilter);
  if (!selectedDate) {
    return true;
  }

  return isSameDay(date, selectedDate);
}

interface MeetingsDataTableProps {
  data: MeetingRow[];
  onOpenMeeting: (meeting: MeetingRow) => void;
  onRenameMeeting: (meeting: MeetingRow) => void;
  onDeleteMeeting: (meeting: MeetingRow) => void;
  onDownloadDocument: (meeting: MeetingRow) => void;
  onToggleDone: (meeting: MeetingRow) => void;
  onBulkDelete: (meetings: MeetingRow[]) => Promise<void> | void;
  onBulkMarkDone: (meetings: MeetingRow[]) => Promise<void> | void;
  isBulkDeleting: boolean;
  isBulkMarkingDone: boolean;
}

export function MeetingsDataTable({
  data,
  onOpenMeeting,
  onRenameMeeting,
  onDeleteMeeting,
  onDownloadDocument,
  onToggleDone,
  onBulkDelete,
  onBulkMarkDone,
  isBulkDeleting,
  isBulkMarkingDone,
}: MeetingsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "createdTimestamp", desc: true },
  ]);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 5,
  });
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [rowSelection, setRowSelection] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all");
  const [selectedDateFilter, setSelectedDateFilter] = React.useState("");

  const columns = React.useMemo(
    () =>
      getMeetingsColumns({
        onOpenMeeting,
        onRenameMeeting,
        onDeleteMeeting,
        onDownloadDocument,
        onToggleDone,
      }),
    [
      onOpenMeeting,
      onRenameMeeting,
      onDeleteMeeting,
      onDownloadDocument,
      onToggleDone,
    ]
  );

  const filteredData = React.useMemo(
    () =>
      data.filter((meeting) => {
        if (!meeting.createdDatetime) {
          return dateFilter === "all" && !selectedDateFilter;
        }

        const meetingDate = new Date(meeting.createdDatetime);
        return (
          matchesDateFilter(meetingDate, dateFilter) &&
          matchesSelectedDate(meetingDate, selectedDateFilter)
        );
      }),
    [data, dateFilter, selectedDateFilter]
  );

  const hearingTypeOptions = React.useMemo(
    () =>
      Array.from(
        new Set(filteredData.flatMap((meeting) => meeting.hearingTypes))
      ).sort((a, b) => a.localeCompare(b)),
    [filteredData]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination,
      rowSelection,
      globalFilter,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const rawQuery = String(filterValue).trim();
      const query = rawQuery.toLowerCase();
      const normalizedQuery = normalizeSearchValue(rawQuery);
      if (!query) return true;

      const searchIndex = buildMeetingSearchIndex(row.original);
      return (
        searchIndex.includes(query) || searchIndex.includes(normalizedQuery)
      );
    },
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const filteredRowsCount = table.getFilteredRowModel().rows.length;
  const totalRowsCount = data.length;
  const selectedHearingType =
    (table.getColumn("hearingTypes")?.getFilterValue() as string | undefined) ??
    "all";
  const activeFilters: string[] = [];

  if (globalFilter.trim()) {
    activeFilters.push(`Search term: ${globalFilter.trim()}.`);
  }

  if (selectedHearingType !== "all") {
    activeFilters.push(`Hearing type filter: ${selectedHearingType}.`);
  }

  if (selectedDateFilter) {
    const parsedSelectedDate = parseSelectedDateFilter(selectedDateFilter);
    if (parsedSelectedDate) {
      activeFilters.push(
        `Exact date filter: ${format(parsedSelectedDate, "dd/MM/yyyy")}.`
      );
    }
  } else if (dateFilter === "today") {
    activeFilters.push("Date filter: today.");
  } else if (dateFilter === "last7Days") {
    activeFilters.push("Date filter: last 7 days.");
  }

  const liveAnnouncement = `Recent recordings updated. Showing ${filteredRowsCount} of ${totalRowsCount} recordings.${activeFilters.length > 0 ? ` ${activeFilters.join(" ")}` : ""}`;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
      <div className="border-b border-border/80 px-4 py-4 sm:px-6">
        <MeetingsTableToolbar
          table={table}
          hearingTypeOptions={hearingTypeOptions}
          dateFilter={dateFilter}
          selectedDateFilter={selectedDateFilter}
          onDateFilterChange={setDateFilter}
          onSelectedDateFilterChange={setSelectedDateFilter}
          onBulkDelete={onBulkDelete}
          onBulkMarkDone={onBulkMarkDone}
          isBulkDeleting={isBulkDeleting}
          isBulkMarkingDone={isBulkMarkingDone}
        />
      </div>

      <Table id={RECENT_RECORDINGS_TABLE_ID}>
        <TableCaption className="sr-only">
          Recent recordings. Results update automatically as you search or apply
          filters.
        </TableCaption>
        <TableHeader className="bg-muted/60">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="hover:bg-muted/70"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No hearings matched your current search or filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="border-t border-border/80 px-4 py-3 sm:px-6">
        <DataTablePagination table={table} />
      </div>
    </div>
  );
}
