import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database", () => ({
  getAllTranscriptionMetadata: vi.fn(),
  getMinuteVersionById: vi.fn(),
  getMinuteVersions: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";
import {
  getAllTranscriptionMetadata,
  getMinuteVersionById,
  getMinuteVersions,
  type MinuteVersion,
} from "@/lib/database";
import {
  cn,
  concatenateDialogueEntriesInTranscriptionJobs,
  DEFAULT_MEETING_TITLE,
  findExistingMinuteVersionForTemplate,
  getFirstName,
  getFullNameFromEmail,
  pollMinuteVersion,
  replaceSpeakerInDialogueEntries,
  submitLangfuseScore,
  submitLangfuseTrace,
} from "@/lib/utils";
import type { TemplateName } from "@/src/api/generated/models/TemplateName";

// Helper to build a minimal valid MinuteVersion for tests
function makeVersion(
  id: string,
  templateName: string,
  createdDatetime: string,
  isGenerating = false
): MinuteVersion {
  return {
    id,
    html_content: "<p></p>",
    transcription_id: "t1",
    template: {
      name: templateName as TemplateName,
      description: "Test template",
      category: "test",
    },
    created_datetime: createdDatetime,
    is_generating: isGenerating,
  };
}

// ─── DEFAULT_MEETING_TITLE ────────────────────────────────────────────────────

describe("DEFAULT_MEETING_TITLE", () => {
  it("equals 'Untitled Meeting'", () => {
    expect(DEFAULT_MEETING_TITLE).toBe("Untitled Meeting");
  });
});

// ─── cn ──────────────────────────────────────────────────────────────────────

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("filters out falsy values", () => {
    expect(cn("foo", false && "hidden", "bar")).toBe("foo bar");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("returns empty string with no args", () => {
    expect(cn()).toBe("");
  });

  it("handles undefined and null", () => {
    expect(cn("a", undefined, null as any, "b")).toBe("a b");
  });
});

// ─── getFirstName ─────────────────────────────────────────────────────────────

describe("getFirstName", () => {
  it("extracts the part before the first dot", () => {
    expect(getFirstName("john.doe@example.com")).toBe("john");
  });

  it("returns the local-part when there is no dot", () => {
    expect(getFirstName("johndoe@example.com")).toBe("johndoe");
  });

  it("returns '' for empty string", () => {
    expect(getFirstName("")).toBe("");
  });

  it("returns '' for null", () => {
    expect(getFirstName(null as any)).toBe("");
  });

  it("returns '' for non-string input", () => {
    expect(getFirstName(42 as any)).toBe("");
  });

  it("returns '' when local-part is empty (leading @)", () => {
    expect(getFirstName("@example.com")).toBe("");
  });
});

// ─── getFullNameFromEmail ─────────────────────────────────────────────────────

describe("getFullNameFromEmail", () => {
  it("returns initial and capitalised surname for dot-separated address", () => {
    expect(getFullNameFromEmail("john.doe@example.com")).toBe("J Doe");
  });

  it("handles uppercase input correctly", () => {
    expect(getFullNameFromEmail("ALICE.SMITH@example.com")).toBe("A Smith");
  });

  it("handles underscore separator", () => {
    expect(getFullNameFromEmail("jane_doe@example.com")).toBe("J Doe");
  });

  it("handles hyphen separator", () => {
    expect(getFullNameFromEmail("bob-jones@example.com")).toBe("B Jones");
  });

  it("uses last part as surname for multiple name parts", () => {
    expect(getFullNameFromEmail("a.b.c@example.com")).toBe("A C");
  });

  it("returns single capitalised name with no separator", () => {
    expect(getFullNameFromEmail("alice@example.com")).toBe("Alice");
  });

  it("returns '' for empty string", () => {
    expect(getFullNameFromEmail("")).toBe("");
  });

  it("returns '' for null", () => {
    expect(getFullNameFromEmail(null as any)).toBe("");
  });

  it("returns '' when local-part is empty", () => {
    expect(getFullNameFromEmail("@example.com")).toBe("");
  });
});

// ─── concatenateDialogueEntriesInTranscriptionJobs ───────────────────────────

describe("concatenateDialogueEntriesInTranscriptionJobs", () => {
  it("returns [] for empty jobs array", () => {
    expect(concatenateDialogueEntriesInTranscriptionJobs([])).toEqual([]);
  });

  it("returns all entries from a single job", () => {
    const entries = [
      { speaker: "Alice", text: "Hello", start_time: 0, end_time: 1 },
      { speaker: "Bob", text: "Hi", start_time: 1, end_time: 2 },
    ];
    const jobs = [{ transcription_id: "t1", dialogue_entries: entries }];
    expect(concatenateDialogueEntriesInTranscriptionJobs(jobs)).toEqual(
      entries
    );
  });

  it("concatenates entries across multiple jobs in order", () => {
    const e1 = { speaker: "A", text: "1", start_time: 0, end_time: 1 };
    const e2 = { speaker: "B", text: "2", start_time: 1, end_time: 2 };
    const e3 = { speaker: "A", text: "3", start_time: 2, end_time: 3 };
    const jobs = [
      { transcription_id: "t1", dialogue_entries: [e1, e2] },
      { transcription_id: "t2", dialogue_entries: [e3] },
    ];
    expect(concatenateDialogueEntriesInTranscriptionJobs(jobs)).toEqual([
      e1,
      e2,
      e3,
    ]);
  });

  it("handles jobs with empty dialogue_entries", () => {
    const e1 = { speaker: "A", text: "hi", start_time: 0, end_time: 1 };
    const jobs = [
      { transcription_id: "t1", dialogue_entries: [] },
      { transcription_id: "t2", dialogue_entries: [e1] },
    ];
    expect(concatenateDialogueEntriesInTranscriptionJobs(jobs)).toEqual([e1]);
  });
});

// ─── replaceSpeakerInDialogueEntries ─────────────────────────────────────────

describe("replaceSpeakerInDialogueEntries", () => {
  const entries = [
    { speaker: "Speaker 1", text: "Hello", start_time: 0, end_time: 1 },
    { speaker: "Speaker 2", text: "Hi", start_time: 1, end_time: 2 },
    { speaker: "Speaker 1", text: "Bye", start_time: 2, end_time: 3 },
  ];

  it("replaces every occurrence of the old speaker name", () => {
    const result = replaceSpeakerInDialogueEntries(
      entries,
      "Speaker 1",
      "Alice"
    );
    expect(result.filter((e) => e.speaker === "Alice")).toHaveLength(2);
    expect(result.filter((e) => e.speaker === "Speaker 2")).toHaveLength(1);
  });

  it("preserves other entry fields unchanged", () => {
    const result = replaceSpeakerInDialogueEntries(
      entries,
      "Speaker 1",
      "Alice"
    );
    expect(result[0].text).toBe("Hello");
    expect(result[0].start_time).toBe(0);
  });

  it("does not mutate the original array", () => {
    replaceSpeakerInDialogueEntries(entries, "Speaker 1", "Alice");
    expect(entries[0].speaker).toBe("Speaker 1");
  });

  it("leaves entries unchanged when speaker not found", () => {
    const result = replaceSpeakerInDialogueEntries(entries, "Unknown", "Alice");
    expect(result).toEqual(entries);
  });

  it("returns [] for empty input", () => {
    expect(replaceSpeakerInDialogueEntries([], "A", "B")).toEqual([]);
  });
});

// ─── findExistingMinuteVersionForTemplate ────────────────────────────────────

describe("findExistingMinuteVersionForTemplate", () => {
  it("returns undefined for an empty array", () => {
    expect(findExistingMinuteVersionForTemplate([], "General")).toBeUndefined();
  });

  it("returns undefined when no version matches the template", () => {
    const versions = [makeVersion("v1", "Crissa", "2024-01-01T00:00:00")];
    expect(
      findExistingMinuteVersionForTemplate(versions, "General")
    ).toBeUndefined();
  });

  it("returns the matching version", () => {
    const versions = [makeVersion("v1", "General", "2024-01-01T00:00:00")];
    expect(findExistingMinuteVersionForTemplate(versions, "General")?.id).toBe(
      "v1"
    );
  });

  it("returns the newest version when multiple match", () => {
    const versions = [
      makeVersion("v1", "General", "2024-01-01T00:00:00"),
      makeVersion("v2", "General", "2024-06-01T00:00:00"),
      makeVersion("v3", "General", "2024-03-01T00:00:00"),
    ];
    expect(findExistingMinuteVersionForTemplate(versions, "General")?.id).toBe(
      "v2"
    );
  });

  it("ignores versions for other templates when picking newest", () => {
    const versions = [
      makeVersion("v1", "General", "2024-01-01T00:00:00"),
      makeVersion("v2", "Crissa", "2025-01-01T00:00:00"),
    ];
    expect(findExistingMinuteVersionForTemplate(versions, "General")?.id).toBe(
      "v1"
    );
  });
});

// ─── submitLangfuseTrace ──────────────────────────────────────────────────────

describe("submitLangfuseTrace", () => {
  beforeEach(() => {
    vi.mocked(apiClient.request).mockReset();
  });

  afterEach(() => {
    vi.mocked(apiClient.request).mockReset();
  });

  it("posts to /langfuse/trace with the correct payload", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({ data: { ok: true } });

    await submitLangfuseTrace({
      traceId: "trace-123",
      name: "test-event",
      metadata: { key: "val" },
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/langfuse/trace",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("trace-123"),
      })
    );
  });

  it("throws when the request returns an error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      error: "Server error",
    });

    await expect(
      submitLangfuseTrace({ traceId: "t1", name: "n1" })
    ).rejects.toThrow("Failed to submit trace: Server error");
  });
});

// ─── submitLangfuseScore ──────────────────────────────────────────────────────

describe("submitLangfuseScore", () => {
  beforeEach(() => {
    vi.mocked(apiClient.request).mockReset();
  });

  afterEach(() => {
    vi.mocked(apiClient.request).mockReset();
  });

  it("posts to /langfuse/score with the correct payload", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({ data: { ok: true } });

    await submitLangfuseScore({
      traceId: "trace-456",
      name: "rating",
      value: 5,
      comment: "great",
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/langfuse/score",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("rating"),
      })
    );
  });

  it("throws when the request returns an error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({ error: "Fail" });

    await expect(
      submitLangfuseScore({ traceId: "t1", name: "n1", value: 1 })
    ).rejects.toThrow("Failed to submit score: Fail");
  });
});

// ─── pollMinuteVersion ───────────────────────────────────────────────────────

describe("pollMinuteVersion", () => {
  beforeEach(() => {
    vi.mocked(getMinuteVersionById).mockReset();
    vi.mocked(getAllTranscriptionMetadata).mockReset();
    vi.mocked(getMinuteVersions).mockReset();
  });

  it("resolves immediately when version is already ready", async () => {
    const version = makeVersion("v1", "General", "2024-01-01T00:00:00", false);
    vi.mocked(getMinuteVersionById).mockResolvedValueOnce(version);

    const result = await pollMinuteVersion("t1", "v1", {
      interval: 0,
      maxAttempts: 3,
    });
    expect(result).toEqual(version);
    expect(getMinuteVersionById).toHaveBeenCalledTimes(1);
  });

  it("polls until the version finishes generating", async () => {
    const generating = makeVersion(
      "v1",
      "General",
      "2024-01-01T00:00:00",
      true
    );
    const ready = { ...generating, is_generating: false };

    vi.mocked(getMinuteVersionById)
      .mockResolvedValueOnce(generating)
      .mockResolvedValueOnce(generating)
      .mockResolvedValueOnce(ready);

    const result = await pollMinuteVersion("t1", "v1", {
      interval: 0,
      maxAttempts: 10,
    });

    expect(result).toEqual(ready);
    expect(getMinuteVersionById).toHaveBeenCalledTimes(3);
  });

  it("throws a timeout error when maxAttempts is exceeded", async () => {
    vi.mocked(getMinuteVersionById).mockResolvedValue(
      makeVersion("v1", "General", "2024-01-01T00:00:00", true)
    );

    await expect(
      pollMinuteVersion("t1", "v1", { interval: 0, maxAttempts: 3 })
    ).rejects.toThrow("Timeout");
  });

  it("throws when transcription has errors after consecutive 404s", async () => {
    vi.mocked(getMinuteVersionById).mockResolvedValue(null);
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([
      { id: "t1", is_showable_in_ui: true } as any,
    ]);
    vi.mocked(getMinuteVersions).mockResolvedValue([]);

    await expect(
      pollMinuteVersion("t1", "v1", { interval: 0, maxAttempts: 10 })
    ).rejects.toThrow("Transcription has errors");
  });
});
