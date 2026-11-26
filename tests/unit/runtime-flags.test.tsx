import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationOnly } from "@/components/flags/dictation-only";
import { apiClient } from "@/lib/api-client";
import { parseRuntimeFlags, resolveDictationEnabled } from "@/lib/flags/runtime-flags";
import {
  RuntimeFlagsProvider,
  useDictationEnabled,
} from "@/providers/runtime-flags";
import { ME } from "../access-helpers";

// DIAAT-392: the UI reads the dictation flag at runtime (GET /api/flags). The
// deploy-time NEXT_PUBLIC_DICTATION_ENABLED is the default until it loads, and
// whenever it cannot be read.

vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let access: { me: unknown } = { me: ME.judge };
vi.mock("@/providers/access", () => ({ useAccess: () => access }));

const request = vi.mocked(apiClient.request);
const ENV = "NEXT_PUBLIC_DICTATION_ENABLED";

function Probe() {
  return <p>{useDictationEnabled() ? "dictation on" : "dictation off"}</p>;
}
const mount = () =>
  render(
    <RuntimeFlagsProvider>
      <Probe />
      <DictationOnly>
        <a href="/record">Dictation</a>
      </DictationOnly>
    </RuntimeFlagsProvider>
  );

beforeEach(() => {
  access = { me: ME.judge };
  request.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("parseRuntimeFlags", () => {
  it("accepts the promised shape and nothing else", () => {
    expect(parseRuntimeFlags({ dictation_enabled: false })).toEqual({ dictation_enabled: false });
    for (const bad of [null, undefined, {}, { dictation_enabled: "true" }, { dictation_enabled: 1 }, "x", []]) {
      expect(parseRuntimeFlags(bad)).toBeNull();
    }
  });

  it("resolves to the flag if read, else the deploy default", () => {
    expect(resolveDictationEnabled({ dictation_enabled: false }, true)).toBe(false);
    expect(resolveDictationEnabled({ dictation_enabled: true }, false)).toBe(true);
    expect(resolveDictationEnabled(null, false)).toBe(false);
    expect(resolveDictationEnabled(undefined, true)).toBe(true);
  });
});

describe("the dictation flag in the UI", () => {
  it("hides dictation when the flag is off, though the deploy value says on", async () => {
    vi.stubEnv(ENV, "true");
    request.mockResolvedValue({ data: { dictation_enabled: false } });
    mount();

    // On the deploy value until the flag has loaded.
    expect(screen.getByText("dictation on")).toBeTruthy();
    expect(await screen.findByText("dictation off")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Dictation" })).toBeNull();
    expect(request).toHaveBeenCalledWith("/flags", expect.anything());
  });

  it("shows dictation when the flag is on, though the deploy value says off", async () => {
    vi.stubEnv(ENV, "false");
    request.mockResolvedValue({ data: { dictation_enabled: true } });
    mount();

    expect(screen.getByText("dictation off")).toBeTruthy();
    expect(await screen.findByText("dictation on")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dictation" })).toBeTruthy();
  });

  describe("fails to the deploy-time value when the flag cannot be read", () => {
    it.each([
      ["a refusal", { error: "Forbidden", status: 403 }],
      ["the API being down", { error: "HTTP error! status: 503", status: 503 }],
      ["a body that is not the flags", { data: { dictation_enabled: "yes" } }],
      ["no body", { data: undefined }],
    ])("after %s", async (_, answer) => {
      for (const [env, shown] of [
        ["false", "dictation off"],
        ["true", "dictation on"],
      ]) {
        vi.stubEnv(ENV, env);
        request.mockReset();
        request.mockResolvedValue(answer);
        const { unmount } = mount();
        await waitFor(() => expect(request).toHaveBeenCalled());
        expect(screen.getByText(shown)).toBeTruthy();
        expect(screen.queryByRole("link", { name: "Dictation" }) !== null).toBe(env === "true");
        unmount();
      }
    });

    it("keeps what it last knew when a later read fails", async () => {
      vi.stubEnv(ENV, "true");
      request.mockResolvedValueOnce({ data: { dictation_enabled: false } });
      mount();
      expect(await screen.findByText("dictation off")).toBeTruthy();

      request.mockResolvedValue({ error: "down", status: 503 });
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(screen.getByText("dictation off")).toBeTruthy();
    });
  });

  it("reads the flag again when the tab comes back into view, so a change reaches an open tab", async () => {
    vi.stubEnv(ENV, "true");
    request.mockResolvedValueOnce({ data: { dictation_enabled: true } });
    mount();
    expect(await screen.findByText("dictation on")).toBeTruthy();

    request.mockResolvedValueOnce({ data: { dictation_enabled: false } });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("dictation off")).toBeTruthy();
  });

  it("ignores a read that was superseded: a late first answer cannot put back a value an administrator just changed", async () => {
    vi.stubEnv(ENV, "true");
    let answerFirst!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)) as never); // the first read: slow
    mount();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // The administrator switches dictation off; the reload after the save answers first.
    request.mockResolvedValueOnce({ data: { dictation_enabled: false } });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("dictation off")).toBeTruthy();

    // Then the slow first read finishes, with the old value.
    answerFirst({ data: { dictation_enabled: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("dictation off")).toBeTruthy();
  });

  it("does not ask before it knows who the user is", async () => {
    access = { me: null };
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the deploy-time value where there is no provider at all", () => {
    vi.stubEnv(ENV, "false");
    render(<Probe />);
    expect(screen.getByText("dictation off")).toBeTruthy();
  });
});

describe("a dictation route refused with 403 dictation_disabled", () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });

  it("makes the tab read the flag again, once, so dictation is hidden at once", async () => {
    vi.stubEnv(ENV, "true");
    request.mockResolvedValueOnce({ data: { dictation_enabled: true } });
    window.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: { code: "dictation_disabled", message: "Dictation is switched off." } }), {
          status: 403,
        })
    ) as typeof fetch;
    mount();
    expect(await screen.findByText("dictation on")).toBeTruthy();

    request.mockResolvedValue({ data: { dictation_enabled: false } });
    await fetch("/api/transcriptions-metadata");
    await fetch("/api/transcriptions-metadata");

    expect(await screen.findByText("dictation off")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2); // the first read, and one more however many calls were refused
  });
});
