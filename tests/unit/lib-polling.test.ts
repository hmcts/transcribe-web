import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";
import { pollEndpoint, pollLLMOutput } from "@/lib/polling";

describe("pollEndpoint", () => {
  beforeEach(() => {
    vi.mocked(apiClient.request).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the successField value when status is 'completed'", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "completed", transcription: "hello world" },
    });

    const promise = pollEndpoint<string>({
      endpoint: "/test",
      successField: "transcription",
      interval: 0,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("hello world");
  });

  it("polls multiple times until status becomes 'completed'", async () => {
    vi.mocked(apiClient.request)
      .mockResolvedValueOnce({ data: { status: "processing" } })
      .mockResolvedValueOnce({ data: { status: "processing" } })
      .mockResolvedValueOnce({
        data: { status: "completed", result: "done" },
      });

    const promise = pollEndpoint<string>({
      endpoint: "/test",
      successField: "result",
      interval: 500,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("done");
    expect(apiClient.request).toHaveBeenCalledTimes(3);
  });

  it("throws with the response error when status is 'failed'", async () => {
    // The failed throw is caught by the inner try/catch; maxErrors: 0 ensures
    // it immediately re-throws rather than retrying.
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "failed", error: "Out of memory" },
    });

    const promise = pollEndpoint({
      endpoint: "/test",
      successField: "result",
      interval: 0,
      maxErrors: 0,
    });
    promise.catch(() => {
      /* prevent unhandled-rejection warning before rejects.toThrow runs */
    });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("Out of memory");
  });

  it("throws 'Operation failed' when status is 'failed' with no error message", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "failed" },
    });

    const promise = pollEndpoint({
      endpoint: "/test",
      successField: "result",
      interval: 0,
      maxErrors: 0,
    });
    promise.catch(() => {
      /* prevent unhandled-rejection warning before rejects.toThrow runs */
    });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("Operation failed");
  });

  it("increments error count on API error and retries", async () => {
    vi.mocked(apiClient.request)
      .mockResolvedValueOnce({ error: "Server error" })
      .mockResolvedValueOnce({
        data: { status: "completed", result: "recovered" },
      });

    const promise = pollEndpoint<string>({
      endpoint: "/test",
      successField: "result",
      interval: 0,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("recovered");
  });

  it("throws after error count exceeds maxErrors", async () => {
    const networkError = new Error("Network failure");
    vi.mocked(apiClient.request).mockRejectedValue(networkError);

    const promise = pollEndpoint({
      endpoint: "/test",
      successField: "result",
      interval: 0,
      maxErrors: 2,
    });
    promise.catch(() => {
      /* prevent unhandled-rejection warning before rejects.toThrow runs */
    });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("Network failure");
  });

  it("uses POST as default method", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "completed", out: 1 },
    });

    const promise = pollEndpoint({
      endpoint: "/test",
      successField: "out",
      interval: 0,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(apiClient.request).toHaveBeenCalledWith(
      "/test",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("passes requestBody as JSON when provided", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "completed", out: 1 },
    });

    const promise = pollEndpoint({
      endpoint: "/test",
      successField: "out",
      interval: 0,
      requestBody: { key: "value" },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(apiClient.request).toHaveBeenCalledWith(
      "/test",
      expect.objectContaining({ body: JSON.stringify({ key: "value" }) })
    );
  });
});

// ─── pollLLMOutput ────────────────────────────────────────────────────────────

describe("pollLLMOutput", () => {
  beforeEach(() => {
    vi.mocked(apiClient.request).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the correct endpoint with GET and resolves llm_output", async () => {
    const output = { summary: "Meeting notes" };
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      data: { status: "completed", llm_output: output },
    });

    const promise = pollLLMOutput("task-abc");
    await vi.runAllTimersAsync();

    expect(await promise).toEqual(output);
    expect(apiClient.request).toHaveBeenCalledWith(
      "/query-llm-output/task-abc",
      expect.objectContaining({ method: "GET" })
    );
  });
});
