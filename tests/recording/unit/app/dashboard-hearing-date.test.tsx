import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/recording/page";

// DIAAT-428: with multi_day_hearings on, a new recording is dated (the first
// day of a new hearing); off, the upload is as it always was (dashboard.test.tsx).

vi.mock("@/providers/runtime-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/runtime-flags")>()),
  useMultiDayHearings: () => true,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/recording/audio-duration", () => ({
  readAudioDurationSeconds: vi.fn().mockResolvedValue(undefined),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? {
            ok: true,
            status: 201,
            json: () => Promise.resolve({ job: { id: "j" } }),
          }
        : {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ hearings: [] }),
          }
    )
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("uploading a recording with multi_day_hearings on", () => {
  it("sends the date of the hearing given", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.upload(
      screen.getByLabelText("Audio file input"),
      new File(["bytes"], "hearing.mp3", { type: "audio/mpeg" })
    );
    const date = screen.getByLabelText("Date of the hearing");
    await user.clear(date);
    await user.type(date, "2026-11-03");
    await user.click(
      screen.getByRole("button", { name: /transcribe a recording/i })
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
      ).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(
      ([, i]) => i?.method === "POST"
    ) as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Hearing-Date": "2026-11-03" });
    expect(init.headers).not.toHaveProperty("X-Hearing-Id");
  });
});
