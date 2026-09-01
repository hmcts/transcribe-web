"use client";

import {
  CheckCheck,
  Ellipsis,
  Eye,
  FileDown,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MeetingRow } from "./types";

interface MeetingsRowActionsProps {
  meeting: MeetingRow;
  onOpenMeeting: (meeting: MeetingRow) => void;
  onRenameMeeting: (meeting: MeetingRow) => void;
  onDeleteMeeting: (meeting: MeetingRow) => void;
  onDownloadDocument: (meeting: MeetingRow) => void;
  onToggleDone: (meeting: MeetingRow) => void;
}

export function MeetingsRowActions({
  meeting,
  onOpenMeeting,
  onRenameMeeting,
  onDeleteMeeting,
  onDownloadDocument,
  onToggleDone,
}: MeetingsRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 p-0"
          aria-label={`Open actions for ${meeting.title}`}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => onOpenMeeting(meeting)}>
          <Eye className="mr-2 size-4" />
          Open hearing
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRenameMeeting(meeting)}>
          <Pencil className="mr-2 size-4" />
          Rename
        </DropdownMenuItem>
        {meeting.documentBlobPath && (
          <DropdownMenuItem onClick={() => onDownloadDocument(meeting)}>
            <FileDown className="mr-2 size-4" />
            Download document
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onToggleDone(meeting)}>
          {meeting.isDone ? (
            <Undo2 className="mr-2 size-4" />
          ) : (
            <CheckCheck className="mr-2 size-4" />
          )}
          {meeting.isDone ? "Mark as not done" : "Mark as done"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDeleteMeeting(meeting)}
        >
          <Trash2 className="mr-2 size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
