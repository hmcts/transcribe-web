import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionWordingEditor } from "@/components/jurisdiction/wording-editor";
import { apiClient } from "@/lib/api-client";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { jurisdictionContextValue } from "@/lib/jurisdiction-context";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";
import { ET } from "../jurisdiction-helpers";

// DIAAT-356: whoever holds `jurisdiction.wording.edit` changes the jurisdiction's
// wording; any other role is told it cannot.

// DIAAT-373: whether the user may edit the wording is the API's permission.
let mockPersona: MeResponse = ME.jurisdictionAdministrator;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => jurisdictionContextValue(ET, [ET]),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

import { toast } from "sonner";

const request = vi.mocked(apiClient.request);
const KEYS = {
  "help.subtitle": "Subtitle of the help page",
  "home.intro": "Introduction under the welcome heading",
};

describe("JurisdictionWordingEditor", () => {
  beforeEach(() => {
    mockPersona = ME.jurisdictionAdministrator;
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("shows the jurisdiction's wording and saves the admin's changes", async () => {
    request.mockImplementation(async (_endpoint: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        const { wording } = JSON.parse(String(options.body));
        return { data: { code: "ET", name: ET.name, keys: KEYS, wording, version: "v2" } };
      }
      return {
        data: { code: "ET", name: ET.name, keys: KEYS, wording: { "help.subtitle": "ET help" }, version: "v1" },
      };
    });
    const user = userEvent.setup();
    render(<JurisdictionWordingEditor />);

    const subtitle = (await screen.findByLabelText("Subtitle of the help page")) as HTMLInputElement;
    expect(subtitle.value).toBe("ET help");
    // A blank line shows the standard text it falls back to.
    expect((screen.getByLabelText("Introduction under the welcome heading") as HTMLInputElement).placeholder).not.toBe("");

    await user.clear(subtitle);
    await user.type(subtitle, "Employment Tribunal help");
    await user.click(screen.getByRole("button", { name: "Save wording" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(request).toHaveBeenLastCalledWith("/jurisdictions/wording", {
      method: "PUT",
      body: JSON.stringify({ wording: { "help.subtitle": "Employment Tribunal help" }, version: "v1" }),
    });
  });

  it("shows the API's reason when the wording is refused", async () => {
    request.mockImplementation(async (_endpoint: string, options?: RequestInit) => {
      // apiClient.request returns a refusal; it never throws.
      if (options?.method === "PUT") return { error: "Invalid wording: too long", status: 400 };
      return { data: { code: "ET", name: ET.name, keys: KEYS, wording: {}, version: "v1" } };
    });
    const user = userEvent.setup();
    render(<JurisdictionWordingEditor />);

    await user.click(await screen.findByRole("button", { name: "Save wording" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid wording: too long"));
  });

  it("refuses a stale save, and can drop the edits to reload", async () => {
    let stored = { "help.subtitle": "Theirs" } as Record<string, string>;
    request.mockImplementation(async (_endpoint: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        if (body.version === "stale") return { error: "ET's wording was changed by someone else meanwhile; load it again", status: 409 };
        stored = body.wording;
        return { data: { code: "ET", name: ET.name, keys: KEYS, wording: stored, version: "v2" } };
      }
      return { data: { code: "ET", name: ET.name, keys: KEYS, wording: stored, version: "stale" } };
    });
    const user = userEvent.setup();
    render(<JurisdictionWordingEditor />);

    const subtitle = (await screen.findByLabelText("Subtitle of the help page")) as HTMLInputElement;
    await user.type(subtitle, " and mine");
    await user.click(screen.getByRole("button", { name: "Save wording" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("ET's wording was changed by someone else meanwhile; load it again"));

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Subtitle of the help page") as HTMLInputElement).value).toBe("Theirs")
    );
  });

  it("stops a jurisdiction switch while wording is unsaved or being saved (DIAAT-332)", async () => {
    let finishSave: (value: unknown) => void = () => undefined;
    request.mockImplementation(async (_endpoint: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        const { wording } = JSON.parse(String(options.body));
        await new Promise((resolve) => {
          finishSave = resolve;
        });
        return { data: { code: "ET", name: ET.name, keys: KEYS, wording, version: "v2" } };
      }
      return { data: { code: "ET", name: ET.name, keys: KEYS, wording: { "help.subtitle": "ET help" }, version: "v1" } };
    });
    const user = userEvent.setup();
    render(<JurisdictionWordingEditor />);

    const subtitle = await screen.findByLabelText("Subtitle of the help page");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    await user.type(subtitle, "!");
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "unsaved_changes" });

    await user.click(screen.getByRole("button", { name: "Save wording" }));
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "busy" });
    finishSave(undefined);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it.each([
    ["a judge", ME.judge],
    ["a legal text manager", ME.legalTextManager],
  ])("tells %s it cannot change the wording, without asking the API", (_n, persona) => {
    mockPersona = persona;
    render(<JurisdictionWordingEditor />);

    expect(
      screen.getByText("Your role cannot change the wording of ET.")
    ).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
