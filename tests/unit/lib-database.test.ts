import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    request: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";
import {
  addTagToTranscription,
  deleteTranscription,
  getAllTranscriptionMetadata,
  getCurrentUser,
  getMinuteVersionById,
  getMinuteVersions,
  getTranscriptionById,
  getTranscriptionJobs,
  getTranscriptionTags,
  removeTagFromTranscription,
  saveMinuteVersion,
  saveTranscription,
  saveTranscriptionJob,
  updateCurrentUser,
} from "@/lib/database";

// ─── helpers ──────────────────────────────────────────────────────────────────

const ok = <T>(data: T) => ({ data });
const err = (msg: string) => ({ error: msg });

// ─── saveTranscription ────────────────────────────────────────────────────────

describe("saveTranscription", () => {
  it("posts the transcription to /transcriptions", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok({}));
    const t = { id: "t1", title: "Meeting" } as any;

    await saveTranscription(t);

    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("swallows API errors (does not throw)", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Server error"));
    await expect(saveTranscription({} as any)).resolves.toBeUndefined();
  });
});

// ─── getTranscriptionById ─────────────────────────────────────────────────────

describe("getTranscriptionById", () => {
  it("fetches /transcriptions/:id and returns the data", async () => {
    const t = { id: "t1", title: "Meeting" };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(t));

    const result = await getTranscriptionById("t1");

    expect(result).toEqual(t);
    expect(apiClient.request).toHaveBeenCalledWith("/transcriptions/t1");
  });

  it("returns null on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Not found"));
    expect(await getTranscriptionById("missing")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getTranscriptionById("t1")).toBeNull();
  });
});

// ─── getAllTranscriptionMetadata ──────────────────────────────────────────────

describe("getAllTranscriptionMetadata", () => {
  it("returns metadata array with ISO dates", async () => {
    const raw = [{ id: "t1", created_datetime: "2024-01-01T00:00:00" }];
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(raw));

    const result = await getAllTranscriptionMetadata();

    expect(result[0].id).toBe("t1");
    expect(result[0].created_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty array on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await getAllTranscriptionMetadata()).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getAllTranscriptionMetadata()).toEqual([]);
  });
});

// ─── deleteTranscription ──────────────────────────────────────────────────────

describe("deleteTranscription", () => {
  it("sends DELETE to /transcriptions/:id", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok({}));

    await deleteTranscription("t1");

    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("swallows API errors (does not throw)", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    await expect(deleteTranscription("t1")).resolves.toBeUndefined();
  });
});

// ─── getMinuteVersions ────────────────────────────────────────────────────────

describe("getMinuteVersions", () => {
  it("fetches minute versions for a transcription", async () => {
    const versions = [{ id: "v1" }, { id: "v2" }];
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(versions));

    const result = await getMinuteVersions("t1");

    expect(result).toEqual(versions);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/minute-versions"
    );
  });

  it("returns empty array on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await getMinuteVersions("t1")).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getMinuteVersions("t1")).toEqual([]);
  });
});

// ─── saveMinuteVersion ────────────────────────────────────────────────────────

describe("saveMinuteVersion", () => {
  const version = {
    html_content: "<p>content</p>",
    transcription_id: "t1",
    template: { name: "General", description: "desc", category: "cat" },
  } as any;

  it("posts to /transcriptions/:id/minute-versions and returns the saved version", async () => {
    const saved = { ...version, id: "v-new" };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(saved));

    const result = await saveMinuteVersion("t1", version);

    expect(result).toEqual(saved);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/minute-versions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Conflict"));
    await expect(saveMinuteVersion("t1", version)).rejects.toThrow();
  });
});

// ─── getTranscriptionJobs ─────────────────────────────────────────────────────

describe("getTranscriptionJobs", () => {
  it("fetches jobs for a transcription", async () => {
    const jobs = [{ id: "j1", transcription_id: "t1", dialogue_entries: [] }];
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(jobs));

    const result = await getTranscriptionJobs("t1");

    expect(result).toEqual(jobs);
  });

  it("returns empty array on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await getTranscriptionJobs("t1")).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getTranscriptionJobs("t1")).toEqual([]);
  });
});

// ─── saveTranscriptionJob ─────────────────────────────────────────────────────

describe("saveTranscriptionJob", () => {
  const job = { transcription_id: "t1", dialogue_entries: [] } as any;

  it("posts the job and returns the saved object", async () => {
    const saved = { ...job, id: "j-new" };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(saved));

    const result = await saveTranscriptionJob("t1", job);

    expect(result).toEqual(saved);
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    await expect(saveTranscriptionJob("t1", job)).rejects.toThrow();
  });
});

// ─── getMinuteVersionById ─────────────────────────────────────────────────────

describe("getMinuteVersionById", () => {
  it("fetches a specific minute version", async () => {
    const v = { id: "v1", html_content: "<p/>" };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(v));

    const result = await getMinuteVersionById("t1", "v1");

    expect(result).toEqual(v);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/minute-versions/v1"
    );
  });

  it("returns null on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Not found"));
    expect(await getMinuteVersionById("t1", "v99")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getMinuteVersionById("t1", "v1")).toBeNull();
  });
});

// ─── getCurrentUser ───────────────────────────────────────────────────────────

describe("getCurrentUser", () => {
  it("calls apiClient.getCurrentUser and returns the user", async () => {
    const user = {
      id: "u1",
      email: "alice@example.com",
      azure_user_id: "az-1",
    };
    vi.mocked(apiClient.getCurrentUser).mockResolvedValueOnce(ok(user));

    const result = await getCurrentUser();

    expect(result).toEqual(user);
  });

  it("returns null on API error", async () => {
    vi.mocked(apiClient.getCurrentUser).mockResolvedValueOnce(err("Unauth"));
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.mocked(apiClient.getCurrentUser).mockRejectedValueOnce(
      new Error("Network")
    );
    expect(await getCurrentUser()).toBeNull();
  });
});

// ─── updateCurrentUser ────────────────────────────────────────────────────────

describe("updateCurrentUser", () => {
  it("posts updates to /user and returns the updated user", async () => {
    const user = { id: "u1", email: "alice@example.com" };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(user));

    const result = await updateCurrentUser({
      email: "alice@example.com",
    } as any);

    expect(result).toEqual(user);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/user",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns null on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await updateCurrentUser({})).toBeNull();
  });
});

// ─── getTranscriptionTags ─────────────────────────────────────────────────────

describe("getTranscriptionTags", () => {
  it("fetches tags for a transcription", async () => {
    const tags = [
      {
        id: "tag1",
        name: "important",
        created_datetime: "2024-01-01",
        updated_datetime: null,
      },
    ];
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(tags));

    const result = await getTranscriptionTags("t1");

    expect(result).toEqual(tags);
    expect(apiClient.request).toHaveBeenCalledWith("/transcriptions/t1/tags");
  });

  it("returns empty array on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await getTranscriptionTags("t1")).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await getTranscriptionTags("t1")).toEqual([]);
  });
});

// ─── addTagToTranscription ────────────────────────────────────────────────────

describe("addTagToTranscription", () => {
  it("posts the tag name and returns the created tag", async () => {
    const tag = {
      id: "tag1",
      name: "urgent",
      created_datetime: "2024-01-01",
      updated_datetime: null,
    };
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok(tag));

    const result = await addTagToTranscription("t1", "urgent");

    expect(result).toEqual(tag);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/tags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "urgent" }),
      })
    );
  });

  it("returns null on API error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    expect(await addTagToTranscription("t1", "urgent")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("Network"));
    expect(await addTagToTranscription("t1", "urgent")).toBeNull();
  });
});

// ─── removeTagFromTranscription ───────────────────────────────────────────────

describe("removeTagFromTranscription", () => {
  it("sends DELETE to the correct tag endpoint", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok({}));

    await removeTagFromTranscription("t1", "urgent");

    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/tags/urgent",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("URL-encodes the tag name", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(ok({}));

    await removeTagFromTranscription("t1", "needs review");

    expect(apiClient.request).toHaveBeenCalledWith(
      "/transcriptions/t1/tags/needs%20review",
      expect.any(Object)
    );
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(err("Fail"));
    await expect(removeTagFromTranscription("t1", "urgent")).rejects.toThrow();
  });
});
