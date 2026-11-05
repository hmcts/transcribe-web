import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLegalWording } from "@/hooks/use-legal-wording";
import { apiClient } from "@/lib/api-client";

// DIAAT-342: whatever the admin area holds is for the active jurisdiction; a
// late answer for another is dropped, and a new jurisdiction starts afresh.

vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

const request = vi.mocked(apiClient.request);

const wording = (code: string) => ({
  jurisdiction: { code, name: `${code} name` },
  has_legal_wording: false,
  hearing_types: [],
  legal_frameworks: [],
  anonymity: { statuses: [] },
});

/** A request whose answer the test gives when it likes. */
function deferred() {
  let resolve!: (value: { data: unknown; status: number }) => void;
  const promise = new Promise<{ data: unknown; status: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useLegalWording", () => {
  beforeEach(() => request.mockReset());

  it("loads the active jurisdiction's wording", async () => {
    request.mockResolvedValue({ data: wording("ET"), status: 200 });
    const { result } = renderHook(() => useLegalWording("ET"));

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores a late response for the jurisdiction it has moved on from", async () => {
    const first = deferred();
    const second = deferred();
    request
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const { result, rerender } = renderHook(
      ({ code }) => useLegalWording(code),
      {
        initialProps: { code: "ET" as string | null },
      }
    );

    rerender({ code: "IAC" });
    // Nothing of ET's is shown while IAC's loads.
    expect(result.current.state.status).toBe("loading");

    await act(async () =>
      second.resolve({ data: wording("IAC"), status: 200 })
    );
    await act(async () => first.resolve({ data: wording("ET"), status: 200 }));

    const { state } = result.current;
    expect(state.status).toBe("loaded");
    if (state.status === "loaded") {
      expect(state.content.jurisdiction?.code).toBe("IAC");
    }
  });

  it("shows nothing of the last jurisdiction's wording while the next one's loads", async () => {
    request.mockResolvedValueOnce({ data: wording("ET"), status: 200 });
    const { result, rerender } = renderHook(
      ({ code }) => useLegalWording(code),
      {
        initialProps: { code: "ET" as string | null },
      }
    );
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));

    request.mockReturnValueOnce(new Promise(() => undefined) as never);
    rerender({ code: "IAC" });

    expect(result.current.state.status).toBe("loading");
  });

  it("does not show an answer that names another jurisdiction", async () => {
    request.mockResolvedValue({ data: wording("IAC"), status: 200 });
    const { result } = renderHook(() => useLegalWording("ET"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const { state } = result.current;
    expect(state.status === "error" && String(state.error)).toMatch(
      /answered for IAC, not ET/
    );
  });

  it("asks for nothing without a jurisdiction", () => {
    renderHook(() => useLegalWording(null));
    expect(request).not.toHaveBeenCalled();
  });

  it("carries the API's refusal code to the caller", async () => {
    request.mockResolvedValue({
      error: "no",
      status: 403,
      code: "jurisdiction_admin_required",
    });
    const { result } = renderHook(() => useLegalWording("ET"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const { state } = result.current;
    expect(
      state.status === "error" && (state.error as { code?: string }).code
    ).toBe("jurisdiction_admin_required");
  });
});
