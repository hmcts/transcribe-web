import type { TranscriptionMetadata } from "@/src/api/generated/models/TranscriptionMetadata";

export const DONE_MEETING_TAG = "Done";
const NORMALIZED_DONE_TAG = DONE_MEETING_TAG.toLowerCase();

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

export type DateFilter = "all" | "today" | "last7Days";

export interface MeetingRow {
  id: string;
  title: string;
  createdDatetime: string | null;
  createdLabel: string;
  createdExactLabel: string;
  createdTimestamp: number;
  hearingTypes: string[];
  isDone: boolean;
  documentBlobPath: string | null;
  source: TranscriptionMetadata;
}

export const isDoneMeeting = (tags?: string[]) =>
  (tags ?? []).some((tag) => normalizeTag(tag) === NORMALIZED_DONE_TAG);

export const extractHearingTypes = (tags?: string[]) =>
  (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => normalizeTag(tag) !== NORMALIZED_DONE_TAG);
