import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioUpload } from "@/components/recording/audio-upload/audio-upload";
import { apiClient } from "@/lib/api-client";
import {
  DEFAULT_MAX_RECORDING_SECONDS,
  describeRecordingLimit,
  parseRuntimeFlags,
  resolveMaxRecordingSeconds,
} from "@/lib/flags/runtime-flags";
import { RuntimeFlagsProvider } from "@/providers/runtime-flags";
import { ME } from "../../../access-helpers";

// DIAAT-408: the dropzone's "Recordings up to ..." is the longest recording the
// API accepts now (GET /api/flags, max_recording_seconds), not a fixed string.

vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
vi.mock("@/providers/access", () => ({ useAccess: () => ({ me: ME.judge }) }));

const request = vi.mocked(apiClient.request);

const mount = () =>
  render(
    <RuntimeFlagsProvider>
      <AudioUpload onUpload={vi.fn()} uploading={false} />
    </RuntimeFlagsProvider>
  );

beforeEach(() => {
  request.mockReset();
});

describe("the dropzone's length hint", () => {
  it("says 4 hours until the API has answered", () => {
    request.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(screen.getByText(/up to 4 hours\./i)).toBeTruthy();
  });

  it("says 8 hours when the API says the limit is 28800 seconds", async () => {
    request.mockResolvedValue({
      data: { dictation_enabled: true, max_recording_seconds: 28_800 },
    });
    mount();
    expect(await screen.findByText(/up to 8 hours\./i)).toBeTruthy();
    expect(screen.queryByText(/up to 4 hours/i)).toBeNull();
  });

  it("says 4 hours for an API that does not send the limit (before DIAAT-408)", async () => {
    request.mockResolvedValue({ data: { dictation_enabled: true } });
    mount();
    expect(await screen.findByText(/up to 4 hours\./i)).toBeTruthy();
  });
});

describe("max_recording_seconds in the flags", () => {
  it("is read when it is a positive number, and left out otherwise", () => {
    expect(
      parseRuntimeFlags({
        dictation_enabled: true,
        max_recording_seconds: 14_400,
      })
    ).toEqual({ dictation_enabled: true, max_recording_seconds: 14_400 });
    for (const bad of ["x", 0, -5, null, Number.NaN]) {
      expect(
        parseRuntimeFlags({
          dictation_enabled: true,
          max_recording_seconds: bad,
        })?.max_recording_seconds
      ).toBeUndefined();
    }
  });

  it("resolves to the API's value, else 4 hours", () => {
    expect(
      resolveMaxRecordingSeconds({
        dictation_enabled: true,
        max_recording_seconds: 28_800,
      })
    ).toBe(28_800);
    expect(resolveMaxRecordingSeconds({ dictation_enabled: true })).toBe(
      DEFAULT_MAX_RECORDING_SECONDS
    );
    expect(resolveMaxRecordingSeconds(null)).toBe(14_400);
  });

  it.each([
    [14_400, "4 hours"],
    [28_800, "8 hours"],
    [12_600, "3 hours 30 minutes"],
    [3_600, "1 hour"],
    [60, "1 minute"],
    [5_400, "1 hour 30 minutes"],
  ])("%d seconds is described as %s", (seconds, text) => {
    expect(describeRecordingLimit(seconds)).toBe(text);
  });
});
