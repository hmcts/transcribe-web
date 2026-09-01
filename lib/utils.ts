/* eslint-disable no-plusplus */
/* eslint-disable no-promise-executor-return */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  getAllTranscriptionMetadata,
  getMinuteVersionById,
  getMinuteVersions,
  type MinuteVersion,
} from "@/lib/database";
import type { DialogueEntry, TranscriptionJob } from "@/src/api/generated";

// Constant for fallback when no meeting title is available
export const DEFAULT_MEETING_TITLE = "Untitled Meeting";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default cn;

export function concatenateDialogueEntriesInTranscriptionJobs(
  jobs: TranscriptionJob[]
): DialogueEntry[] {
  return jobs.flatMap((job) => job.dialogue_entries);
}

export function replaceSpeakerInDialogueEntries(
  entries: DialogueEntry[],
  oldSpeaker: string,
  newSpeaker: string
): DialogueEntry[] {
  return entries.map((entry) =>
    entry.speaker === oldSpeaker ? { ...entry, speaker: newSpeaker } : entry
  );
}

// Langfuse trace submission via backend proxy
export const submitLangfuseTrace = async (params: {
  traceId: string;
  name: string;
  metadata?: Record<string, any>;
  inputData?: Record<string, any> | string;
  outputData?: Record<string, any> | string;
}) => {
  const { apiClient } = await import("@/lib/api-client");

  const result = await apiClient.request("/langfuse/trace", {
    method: "POST",
    body: JSON.stringify({
      trace_id: params.traceId,
      name: params.name,
      metadata: params.metadata,
      input_data: params.inputData,
      output_data: params.outputData,
    }),
  });

  if (result.error) {
    throw new Error(`Failed to submit trace: ${result.error}`);
  }

  return result.data;
};

// Langfuse score submission via backend proxy
export const submitLangfuseScore = async (params: {
  traceId: string;
  name: string;
  value: number;
  comment?: string;
}) => {
  const { apiClient } = await import("@/lib/api-client");

  const result = await apiClient.request("/langfuse/score", {
    method: "POST",
    body: JSON.stringify({
      trace_id: params.traceId,
      name: params.name,
      value: params.value,
      comment: params.comment,
    }),
  });

  if (result.error) {
    throw new Error(`Failed to submit score: ${result.error}`);
  }

  return result.data;
};

export const findExistingMinuteVersionForTemplate = (
  minuteVersions: MinuteVersion[],
  templateName: string
): MinuteVersion | undefined => {
  return minuteVersions
    .filter((version) => version.template?.name === templateName)
    .sort((a, b) => {
      const dateA = new Date(a.created_datetime || "").getTime();
      const dateB = new Date(b.created_datetime || "").getTime();
      return dateB - dateA; // Sort in descending order (newest first)
    })[0];
};

export async function pollMinuteVersion(
  transcriptionId: string,
  versionId: string,
  options: {
    maxAttempts?: number;
    interval?: number;
  } = {}
): Promise<MinuteVersion> {
  const maxAttempts = options.maxAttempts ?? 210; // 7 minutes total
  const interval = options.interval ?? 2000; // 2 seconds
  let attempts = 0;
  let consecutiveNotFound = 0;

  while (attempts < maxAttempts) {
    const version = await getMinuteVersionById(transcriptionId, versionId);

    if (version && !version.is_generating) {
      return version as MinuteVersion;
    }

    // If version is null (404), increment counter
    if (version === null) {
      consecutiveNotFound++;
      // After 5 consecutive 404s (10 seconds), check if transcription has errors
      if (consecutiveNotFound >= 5) {
        const metadata = await getAllTranscriptionMetadata();
        const transcription = metadata.find((t) => t.id === transcriptionId);
        if (transcription?.is_showable_in_ui) {
          // Check if it's showable due to errors (no successful minute versions)
          const versions = await getMinuteVersions(transcriptionId);
          if (versions.length === 0) {
            throw new Error(
              "Transcription has errors. Minute generation failed."
            );
          }
        }
      }
    } else {
      consecutiveNotFound = 0; // Reset on success
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
    attempts++;
  }

  throw new Error("Timeout: Failed to get minute version after 7 minutes");
}

export const getFirstName = (email: string) => {
  try {
    if (!email || typeof email !== "string") {
      return "";
    }

    const beforeAt = email.split("@")[0];
    if (!beforeAt) {
      return "";
    }

    const firstName = beforeAt.split(".")[0];
    return firstName || "";
  } catch (error) {
    console.warn("Error extracting first name from email:", error);
    return "";
  }
};

const JUDGE_TYPES: Record<string, string> = {
  tribunaljudge: "Tribunal Judge",
  residentjudge: "Resident Judge",
  districttribunaljudge: "District Tribunal Judge",
  ddj: "DDJ",
};

const SURNAME_PREFIXES_NOSPACE = new Set(["Mc", "Mac"]);
const SURNAME_PREFIXES_SPACE = new Set(["Le", "De", "La", "Van", "Von", "Di"]);

const splitCamelCase = (str: string): string[] =>
  str
    .replace(/([a-z])([A-Z])/g, "$1\0$2")
    .split("\0")
    .filter(Boolean);

const capitalizeWord = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const formatJudgeNameParts = (nameParts: string[]): string => {
  if (nameParts.length === 0) return "";

  if (nameParts.length >= 2) {
    const initial = nameParts[0].charAt(0).toUpperCase();
    const surnameRaw = nameParts.slice(1).join("");
    const pieces = splitCamelCase(surnameRaw);
    if (pieces.length >= 2) {
      const [firstPiece, ...restPieces] = pieces;
      if (SURNAME_PREFIXES_NOSPACE.has(firstPiece)) {
        return `${initial} ${firstPiece}${restPieces.join("")}`;
      }
      if (SURNAME_PREFIXES_SPACE.has(firstPiece)) {
        return `${initial} ${firstPiece} ${restPieces.join("")}`;
      }
    }
    return `${initial} ${surnameRaw}`;
  }

  const single = nameParts[0];
  const pieces = splitCamelCase(single);
  if (pieces.length >= 2) {
    const initial = pieces[0].charAt(0).toUpperCase();
    const [firstSurnamePart, ...restSurnameParts] = pieces.slice(1);
    if (SURNAME_PREFIXES_NOSPACE.has(firstSurnamePart)) {
      return `${initial} ${firstSurnamePart}${restSurnameParts.join("")}`;
    }
    if (SURNAME_PREFIXES_SPACE.has(firstSurnamePart)) {
      return `${initial} ${firstSurnamePart} ${restSurnameParts.join("")}`;
    }
    return `${initial} ${[firstSurnamePart, ...restSurnameParts].join("")}`;
  }

  return capitalizeWord(single);
};

/**
 * Extract just the judge title from an ejudiciary email address.
 * Returns "" for non-ejudiciary emails or unrecognised title prefixes.
 *
 * TribunalJudge.Aldridge@ejudiciary.net -> "Tribunal Judge"
 * DDJ.Gareth.McMahon@ejudiciary.net     -> "DDJ"
 * john.doe@example.com                  -> ""
 */
export const getJudgeTitleFromEmail = (email: string): string => {
  try {
    if (!email || typeof email !== "string") return "";
    const atIndex = email.indexOf("@");
    if (atIndex === -1) return "";
    const domain = email.slice(atIndex + 1);
    if (domain.toLowerCase() !== "ejudiciary.net") return "";
    const dotParts = email.slice(0, atIndex).split(".");
    if (dotParts.length < 2) return "";
    return JUDGE_TYPES[dotParts[0].toLowerCase()] ?? "";
  } catch {
    return "";
  }
};

/**
 * Extract just the name (without judge title) from an email address.
 *
 * TribunalJudge.Aldridge@ejudiciary.net -> "A Aldridge"
 * DDJ.Gareth.McMahon@ejudiciary.net     -> "G McMahon"
 * john.doe@example.com                  -> "J Doe"
 */
export const getJudgeNameFromEmail = (email: string): string => {
  try {
    if (!email || typeof email !== "string") return "";
    const atIndex = email.indexOf("@");
    if (atIndex === -1) return "";
    const beforeAt = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);

    if (domain.toLowerCase() === "ejudiciary.net") {
      const dotParts = beforeAt.split(".");
      if (dotParts.length < 2) return beforeAt;
      const typeKey = dotParts[0].toLowerCase();
      if (JUDGE_TYPES[typeKey]) {
        return formatJudgeNameParts(dotParts.slice(1));
      }
      return dotParts.map(capitalizeWord).join(" ");
    }

    const parts = beforeAt.split(/[._-]/).filter((part) => part.length > 0);
    if (parts.length >= 2) {
      const initial = parts[0].charAt(0).toUpperCase();
      const surname = capitalizeWord(parts[parts.length - 1]);
      return `${initial} ${surname}`;
    }
    if (parts.length === 1) return capitalizeWord(parts[0]);
    return "";
  } catch {
    return "";
  }
};

/**
 * Extract full name (First Last) from an email address.
 *
 * Handles two formats:
 * - ejudiciary.net judge emails, e.g.:
 *   - TribunalJudge.Seelhoff@ejudiciary.net -> "Tribunal Judge Seelhoff"
 *   - DDJ.Gareth.McMahon@ejudiciary.net -> "DDJ G McMahon"
 * - standard emails, e.g.:
 *   - john.doe@example.com -> "J Doe"
 */
export const getFullNameFromEmail = (email: string): string => {
  try {
    if (!email || typeof email !== "string") {
      return "";
    }

    const atIndex = email.indexOf("@");
    if (atIndex === -1) {
      return "";
    }

    const beforeAt = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);

    if (domain.toLowerCase() === "ejudiciary.net") {
      const dotParts = beforeAt.split(".");
      if (dotParts.length < 2) {
        return beforeAt;
      }

      const typeKey = dotParts[0].toLowerCase();
      const judgeType = JUDGE_TYPES[typeKey];

      if (judgeType) {
        const nameParts = dotParts.slice(1);
        return `${judgeType} ${formatJudgeNameParts(nameParts)}`;
      }

      return dotParts.map(capitalizeWord).join(" ");
    }

    const parts = beforeAt.split(/[._-]/).filter((part) => part.length > 0);

    if (parts.length >= 2) {
      const initial = parts[0].charAt(0).toUpperCase();
      const surname = capitalizeWord(parts[parts.length - 1]);
      return `${initial} ${surname}`;
    }

    if (parts.length === 1) {
      return capitalizeWord(parts[0]);
    }

    return "";
  } catch (error) {
    console.warn("Error extracting full name from email:", error);
    return "";
  }
};
