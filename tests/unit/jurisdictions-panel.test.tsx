import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionsPanel } from "@/components/admin/jurisdictions-panel";
import type * as api from "@/lib/admin-jurisdictions-api";
import { apiClient } from "@/lib/api-client";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";

// DIAAT-356: a SystemAdministrator adds a jurisdiction and its judges from the admin
// area, because nobody may run a command on the cluster.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

import { toast } from "sonner";

const IAC: api.AdminJurisdiction = {
  code: "IAC",
  name: "Immigration and Asylum Chamber",
  enabled: true,
  auto_enrol: true,
  settings: { template: "iac_decision", features: { hearing_recordings: true } },
  member_count: 12,
  version: "2026-10-01T09:00:00",
};
const ET: api.AdminJurisdiction = {
  code: "ET",
  name: "Employment Tribunal",
  enabled: true,
  auto_enrol: false,
  settings: { wording: { "help.subtitle": "Employment Tribunal" }, template: null },
  member_count: 0,
  version: "2026-10-31T09:00:00",
};

const request = vi.mocked(apiClient.request);

// Radix Select uses DOM APIs jsdom does not have.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= vi.fn(() => false);
Element.prototype.releasePointerCapture ??= vi.fn();
// Radix Checkbox measures itself.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {
      // No-op for jsdom.
    }
    unobserve() {
      // No-op for jsdom.
    }
    disconnect() {
      // No-op for jsdom.
    }
  }
);

/** A small fake of the API's admin routes. A refusal comes back as `error`, as
 * apiClient.request returns it (it never throws). */
function serve({ jurisdictions = [IAC], members = [] as api.AdminJurisdictionMember[] } = {}) {
  let list = [...jurisdictions];
  const memberList = [...members];
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (endpoint === "/admin/jurisdictions") return { data: list };
    if (endpoint === "/admin/jurisdictions/wording-keys")
      return { data: { keys: { "help.subtitle": "Under the service name" } } };
    const put = endpoint.match(/^\/admin\/jurisdictions\/(\w+)$/);
    if (put && method === "PUT") {
      const existing = list.find((j) => j.code === put[1]);
      if ((existing?.version ?? "") !== body.version)
        return { error: existing && !body.version ? `${put[1]} already exists` : "changed", status: 409 };
      const { version: _, ...fields } = body;
      const saved = { code: put[1], member_count: 0, ...fields, version: "new" } as api.AdminJurisdiction;
      list = [...list.filter((j) => j.code !== saved.code), saved];
      return { data: saved };
    }
    if (endpoint.endsWith("/members") && method === "GET") return { data: memberList };
    if (endpoint.endsWith("/members") && method === "POST") {
      if (body.email === "nope@example.test") return { error: "No jurisdiction ET", status: 404 };
      const email = body.email.toLowerCase();
      const existing = memberList.find((m) => m.email === email);
      const added = {
        email,
        role: body.role,
        tester: body.tester ?? existing?.tester ?? false,
        pending: existing?.pending ?? true,
      };
      memberList.splice(0, memberList.length, ...memberList.filter((m) => m.email !== email), added);
      return { data: added };
    }
    if (endpoint.includes("/members?") && method === "DELETE") {
      const email = new URLSearchParams(endpoint.split("?")[1]).get("email");
      const index = memberList.findIndex((m) => m.email === email);
      if (index < 0) return { error: "Not a member of ET", status: 404 };
      memberList.splice(index, 1);
      return { data: undefined, status: 204 };
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  });
  return {
    /** Someone else changes `code` meanwhile. */
    changeElsewhere(code: string, name: string) {
      list = list.map((j) => (j.code === code ? { ...j, name, version: `${j.version}+` } : j));
    },
  };
}

describe("JurisdictionsPanel", () => {
  beforeEach(() => {
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("lists the jurisdictions with their members and status", async () => {
    serve({ jurisdictions: [IAC, ET] });
    render(<JurisdictionsPanel />);

    expect(await screen.findByRole("button", { name: "IAC" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ET" })).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("New users join")).toBeTruthy();
  });

  it("adds the ET with its wording, no template and no hearing recordings", async () => {
    serve();
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: /Add jurisdiction/ }));
    await user.type(screen.getByLabelText("Code"), "et");
    await user.type(screen.getByLabelText("Name"), "Employment Tribunal");
    await user.type(screen.getByLabelText("Under the service name"), "Employment Tribunal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved ET"));
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(put?.[0]).toBe("/admin/jurisdictions/ET");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      name: "Employment Tribunal",
      display_name: "",
      service: "",
      // DIAAT-345: a new jurisdiction is a draft only its admins see.
      stage: "draft",
      enabled: true,
      auto_enrol: false,
      settings: {
        wording: { "help.subtitle": "Employment Tribunal" },
        template: null,
        features: { hearing_recordings: false },
      },
      version: "",
    });
    // The new jurisdiction opens, ready for its members.
    expect(await screen.findByRole("heading", { name: "Members of ET" })).toBeTruthy();
  });

  it("keeps an existing jurisdiction's settings and drops blank wording", async () => {
    serve({ jurisdictions: [IAC] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "IAC" }));
    expect((screen.getByLabelText("Code") as HTMLInputElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Under the service name"), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).settings).toEqual({
      wording: {},
      template: "iac_decision",
      features: { hearing_recordings: true },
    });
  });

  it("adds test judges by email before they have signed in, and removes one", async () => {
    serve({ jurisdictions: [IAC, ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    expect(await screen.findByText("No members yet.")).toBeTruthy();
    await user.type(screen.getByLabelText("Sign-in email"), "Hamza.Ahmed@justice.gov.uk");
    await user.click(screen.getByRole("button", { name: /Add member/ }));

    expect(await screen.findByText("hamza.ahmed@justice.gov.uk")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(
      "Added hamza.ahmed@justice.gov.uk. They join ET when they first sign in."
    );
    expect((screen.getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("");

    // Removing needs a second, deliberate click.
    await user.click(screen.getByRole("button", { name: "Remove hamza.ahmed@justice.gov.uk" }));
    expect(request.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(await screen.findByText("No members yet.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      "/admin/jurisdictions/ET/members?email=hamza.ahmed%40justice.gov.uk",
      { method: "DELETE" }
    );
  });

  it("shows the API's reason when something is refused", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.type(await screen.findByLabelText("Sign-in email"), "nope@example.test");
    await user.click(screen.getByRole("button", { name: /Add member/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No jurisdiction ET"));
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("nope@example.test");
  });

  it("does not report a removal that was refused", async () => {
    serve({ jurisdictions: [ET], members: [{ email: "a@example.test", role: "judge", pending: true }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(await screen.findByRole("button", { name: "Remove a@example.test" }));
    const fake = request.getMockImplementation();
    request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
      options?.method === "DELETE" ? { error: "Not a member of ET", status: 404 } : (fake as typeof apiClient.request)(endpoint, options)
    );
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not a member of ET"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("will not add a jurisdiction over an existing one", async () => {
    serve({ jurisdictions: [IAC] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: /Add jurisdiction/ }));
    await user.type(screen.getByLabelText("Code"), "iac");
    await user.type(screen.getByLabelText("Name"), "Mistake");

    expect(screen.getByText("IAC already exists. Choose it in the list to edit it.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(false);
  });

  it("sends the version it edited, and shows a refusal of a stale one", async () => {
    serve({ jurisdictions: [{ ...ET, version: "newer" }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    const fake = request.getMockImplementation();
    request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? { error: "ET was changed by someone else meanwhile; load it again", status: 409 }
        : (fake as typeof apiClient.request)(endpoint, options)
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("ET was changed by someone else meanwhile; load it again")
    );
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).version).toBe("newer");
  });

  it("does not send stored wording this release no longer knows", async () => {
    serve({
      jurisdictions: [{ ...ET, settings: { ...ET.settings, wording: { "help.subtitle": "Kept", "old.key": "Gone" } } }],
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).settings.wording).toEqual({ "help.subtitle": "Kept" });
  });

  it("keeps unsaved edits when a member is added", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.type(name, "s");
    await user.type(screen.getByLabelText("Sign-in email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: /Add member/ }));

    expect(await screen.findByText("a@example.test")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Employment Tribunals");
  });

  it("refuses a stale form even after a member change shows the newer copy", async () => {
    const api = serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.type(screen.getByLabelText("Name"), " (mine)");
    api.changeElsewhere("ET", "Employment Tribunals (theirs)");
    await user.type(screen.getByLabelText("Sign-in email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: /Add member/ }));
    await screen.findByText("a@example.test");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("changed"));
    expect(toast.success).not.toHaveBeenCalledWith("Saved ET");

    // Discard reopens the form from the server's copy, which then saves.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Employment Tribunals (theirs)")
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved ET"));
  });

  it("saves twice in a row without a conflict", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stops a jurisdiction switch while its changes are unsaved, not once saved (DIAAT-332)", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    await user.type(screen.getByLabelText("Name"), "s");
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "unsaved_changes" });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();

    // An email typed but not added yet.
    await user.type(screen.getByLabelText("Sign-in email"), "new@example.test");
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "unsaved_changes" });
  });

  it("says when adding changes an existing member's role", async () => {
    serve({ jurisdictions: [ET], members: [{ email: "a@example.test", role: "judge", pending: true }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await screen.findByText("a@example.test");
    await user.type(screen.getByLabelText("Sign-in email"), "A@example.test");
    await user.click(screen.getByLabelText("Role"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: /Add member/ }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("a@example.test is now an admin in ET")
    );
  });

  // DIAAT-345 ---------------------------------------------------------------

  it("shows each jurisdiction's stage, display name and service", async () => {
    serve({
      jurisdictions: [
        { ...IAC, stage: "live" },
        { ...ET, stage: "test", display_name: "Employment Tribunals (ET)", service: "England and Wales" },
        { ...ET, code: "SSCS", name: "Social Security", stage: "draft" },
        { ...ET, code: "OLD", name: "Old", stage: "live", enabled: false },
      ],
    });
    render(<JurisdictionsPanel />);

    expect(await screen.findByText("Employment Tribunals (ET)")).toBeTruthy();
    expect(screen.getByText("England and Wales")).toBeTruthy();
    for (const status of ["Live", "Test", "Draft", "Disabled"]) {
      expect(screen.getByText(status)).toBeTruthy();
    }
  });

  it("starts a new jurisdiction as a draft, with its display name and service", async () => {
    serve();
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: /Add jurisdiction/ }));
    const stage = screen.getByLabelText("Who sees it");
    expect(stage.textContent).toContain("Draft: only its admins see it");
    expect((stage as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Code"), "et");
    await user.type(screen.getByLabelText("Name"), "Employment Tribunals");
    await user.type(screen.getByLabelText("Display name"), "Employment Tribunals (ET)");
    await user.type(screen.getByLabelText("Service (where it applies)"), "England and Wales");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved ET"));
    const body = JSON.parse(String(request.mock.calls.find(([, o]) => o?.method === "PUT")?.[1]?.body));
    expect([body.display_name, body.service, body.stage]).toEqual([
      "Employment Tribunals (ET)",
      "England and Wales",
      "draft",
    ]);
  });

  it("lists what stops a draft being switched on", async () => {
    serve({
      jurisdictions: [
        {
          ...ET,
          stage: "draft",
          problems: ["Add the screen wording for: Subtitle of the help page.", "Assign at least one jurisdiction admin."],
        },
      ],
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    const region = screen.getByRole("region", { name: /Before it can be switched on/ });
    expect(region.textContent).toContain("Add the screen wording for: Subtitle of the help page.");
    expect(region.textContent).toContain("Assign at least one jurisdiction admin.");
  });

  it("does not list problems for a jurisdiction already switched on", async () => {
    serve({ jurisdictions: [{ ...ET, stage: "live", problems: ["Assign at least one jurisdiction admin."] }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    expect(screen.queryByRole("region", { name: /Before it can be switched on/ })).toBeNull();
  });

  it("switches a draft on for its test group, and shows why if it is not ready", async () => {
    serve({ jurisdictions: [{ ...ET, stage: "draft" }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(screen.getByLabelText("Who sees it"));
    await user.click(await screen.findByRole("option", { name: "Test: its admins and testers see it" }));
    const fake = request.getMockImplementation();
    request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? { error: "ET is not ready to be switched on. Assign at least one jurisdiction admin.", status: 400 }
        : (fake as typeof apiClient.request)(endpoint, options)
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "ET is not ready to be switched on. Assign at least one jurisdiction admin."
      )
    );
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).stage).toBe("test");
  });

  it("adds a member to the test group, and takes one out keeping their role", async () => {
    serve({ jurisdictions: [ET], members: [{ email: "lead@example.test", role: "admin", tester: true, pending: false }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await screen.findByText("lead@example.test");
    await user.type(screen.getByLabelText("Sign-in email"), "tester@example.test");
    await user.click(screen.getByLabelText("Tester"));
    await user.click(screen.getByRole("button", { name: /Add member/ }));
    await screen.findByText("tester@example.test");
    const added = request.mock.calls.filter(([, o]) => o?.method === "POST").map(([, o]) => JSON.parse(String(o?.body)));
    expect(added).toEqual([{ email: "tester@example.test", role: "judge", tester: true }]);
    expect((screen.getByLabelText("Tester") as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");

    await user.click(screen.getByRole("checkbox", { name: "lead@example.test is a tester" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("lead@example.test is no longer in the test group for ET")
    );
    const posts = request.mock.calls.filter(([, o]) => o?.method === "POST").map(([, o]) => JSON.parse(String(o?.body)));
    expect(posts.at(-1)).toEqual({ email: "lead@example.test", role: "admin", tester: false });
  });

  it("offers a retry when the list cannot be loaded", async () => {
    serve();
    // The first load's two requests are both refused.
    request
      .mockResolvedValueOnce({ error: "Forbidden", status: 403 })
      .mockResolvedValueOnce({ error: "Forbidden", status: 403 });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    expect(await screen.findByText("Forbidden")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "IAC" })).toBeTruthy();
  });
});
