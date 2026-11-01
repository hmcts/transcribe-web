import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionWordingEditor } from "@/components/jurisdiction/wording-editor";
import { apiClient } from "@/lib/api-client";
import { jurisdictionContextValue } from "@/lib/jurisdiction-context";
import { ET } from "../jurisdiction-helpers";

// DIAAT-356: a judge made an admin for a jurisdiction changes its wording; a judge
// who is not its admin is told they cannot.

let role: "judge" | "admin" = "admin";
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => jurisdictionContextValue({ ...ET, role }, [{ ...ET, role }]),
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
    role = "admin";
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

  it("tells a judge who is not its admin, without asking the API", () => {
    role = "judge";
    render(<JurisdictionWordingEditor />);

    expect(screen.getByText("Only an admin for ET can change its wording.")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
