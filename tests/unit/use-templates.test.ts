import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getTemplates: vi.fn(),
  },
}));

import useTemplates from "@/hooks/use-templates";
import { apiClient } from "@/lib/api-client";

describe("useTemplates", () => {
  it("starts with loading true and empty templates", () => {
    vi.mocked(apiClient.getTemplates).mockReturnValue(
      new Promise((_resolve) => {
        /* never resolves */
      })
    );
    const { result } = renderHook(() => useTemplates());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.templates).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads templates on mount", async () => {
    const templates = [
      { name: "Template A", description: "Desc A" },
      { name: "Template B", description: "Desc B" },
    ];
    vi.mocked(apiClient.getTemplates).mockResolvedValue({
      data: { templates },
      error: undefined,
    });

    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.templates).toEqual(templates);
    expect(result.current.error).toBeNull();
  });

  it("sets error when API returns error", async () => {
    vi.mocked(apiClient.getTemplates).mockResolvedValue({
      data: undefined,
      error: "Server error",
    });

    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.templates).toEqual([]);
  });

  it("sets error when request throws", async () => {
    vi.mocked(apiClient.getTemplates).mockRejectedValue(
      new Error("Network error")
    );

    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Network error");
  });

  it("sets loading false after successful fetch", async () => {
    vi.mocked(apiClient.getTemplates).mockResolvedValue({
      data: { templates: [] },
      error: undefined,
    });

    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
