"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { MeetingsRowActions } from "./row-actions";
import type { MeetingRow } from "./types";

interface MeetingsColumnsActions {
  onOpenMeeting: (meeting: MeetingRow) => void;
  onRenameMeeting: (meeting: MeetingRow) => void;
  onDeleteMeeting: (meeting: MeetingRow) => void;
  onDownloadDocument: (meeting: MeetingRow) => void;
  onToggleDone: (meeting: MeetingRow) => void;
}

const matchesHearingType = (hearingTypes: string[], selectedType?: string) => {
  if (!selectedType) return true;
  return hearingTypes.some(
    (hearingType) => hearingType.toLowerCase() === selectedType.toLowerCase()
  );
};

export const getMeetingsColumns = ({
  onOpenMeeting,
  onRenameMeeting,
  onDeleteMeeting,
  onDownloadDocument,
  onToggleDone,
}: MeetingsColumnsActions): ColumnDef<MeetingRow>[] => [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) =>
          table.toggleAllPageRowsSelected(Boolean(value))
        }
        aria-label="Select all visible rows"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
        aria-label={`Select ${row.original.title}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 36,
  },
  {
    id: "title",
    accessorKey: "title",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Hearing" />
    ),
    cell: ({ row }) => (
      <button
        type="button"
        className="flex w-full flex-col items-start text-left"
        onClick={() => onOpenMeeting(row.original)}
      >
        <span className="ph-mask font-medium text-card-foreground">
          {row.original.title}
        </span>
      </button>
    ),
    enableSorting: false,
  },
  {
    id: "isDone",
    accessorKey: "isDone",
    header: "Status",
    cell: ({ row }) =>
      row.original.isDone ? (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300">
          Done
        </Badge>
      ) : (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
          To review
        </Badge>
      ),
    enableSorting: false,
  },
  {
    id: "createdTimestamp",
    accessorKey: "createdTimestamp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => (
      <div className="flex items-start text-foreground/90">
        <Clock className="mr-1.5 mt-0.5 size-3.5 shrink-0 text-foreground/70" />
        <div>
          <div>{row.original.createdLabel}</div>
          <div className="mt-1 text-xs text-foreground/80">
            {row.original.createdExactLabel}
          </div>
        </div>
      </div>
    ),
    enableHiding: false,
  },
  {
    id: "hearingTypes",
    accessorKey: "hearingTypes",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Hearing type" />
    ),
    cell: ({ row }) => {
      const hearingTypes = row.original.hearingTypes;

      if (hearingTypes.length === 0) {
        return <span className="text-muted-foreground">—</span>;
      }

      return (
        <div className="flex flex-wrap gap-1.5">
          {hearingTypes.map((hearingType) => (
            <Badge key={`${row.original.id}-${hearingType}`} variant="outline">
              {hearingType}
            </Badge>
          ))}
        </div>
      );
    },
    filterFn: (row, _columnId, filterValue) => {
      const selectedType =
        typeof filterValue === "string" && filterValue !== "all"
          ? filterValue
          : undefined;
      return matchesHearingType(row.original.hearingTypes, selectedType);
    },
    enableSorting: false,
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <MeetingsRowActions
          meeting={row.original}
          onOpenMeeting={onOpenMeeting}
          onRenameMeeting={onRenameMeeting}
          onDeleteMeeting={onDeleteMeeting}
          onDownloadDocument={onDownloadDocument}
          onToggleDone={onToggleDone}
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
];
