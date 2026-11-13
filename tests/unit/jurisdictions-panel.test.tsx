import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionsPanel } from "@/components/admin/jurisdictions-panel";
import type * as api from "@/lib/admin-jurisdictions-api";
import { apiClient } from "@/lib/api-client";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";

// DIAAT-356, DIAAT-394: whoever may manage jurisdictions adds one and edits its
// settings from the admin area, because nobody may run a command on the cluster.
// Who administers a jurisdiction is a role assignment (DIAAT-373), not a setting.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

let persona: MeResponse = ME.jurisdictionSuperAdministrator;
// No role holds jurisdictions.manage without jurisdiction.create since DIAAT-406; the
// panel still follows the permissions, so this tests that it does.
const SETTINGS_ONLY: MeResponse = {
  ...ME.jurisdictionSuperAdministrator,
  permissions: ME.jurisdictionSuperAdministrator.permissions.filter(
    (p) => p !== "jurisdiction.create" && p !== "jurisdiction_admin.assign"
  ),
};
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);

import { toast } from "sonner";

const IAC: api.AdminJurisdiction = {
  code: "IAC",
  name: "Immigration and Asylum Chamber",
  enabled: true,
  settings: { template: "iac_decision", features: { hearing_recordings: true } },
  member_count: 12,
  version: "2026-10-01T09:00:00",
};
const ET: api.AdminJurisdiction = {
  code: "ET",
  name: "Employment Tribunal",
  enabled: true,
  settings: { wording: { "help.subtitle": "Employment Tribunal" }, template: null },
  member_count: 0,
  version: "2026-10-31T09:00:00",
};

const request = vi.mocked(apiClient.request);

// Radix Select uses DOM APIs jsdom does not have.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= vi.fn(() => false);
Element.prototype.releasePointerCapture ??= vi.fn();

/** A small fake of the API's admin routes. A refusal comes back as `error`, as
 * apiClient.request returns it (it never throws). */
type Holder = { assignmentId: string; email: string; id: string; pending?: boolean };

function serve({ jurisdictions = [IAC], admins = [] as Holder[] } = {}) {
  let list = [...jurisdictions];
  let listRefused = false;
  const adminList = [...admins];
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (endpoint === "/admin/jurisdictions")
      return listRefused ? { error: "Service unavailable", status: 503 } : { data: list };
    if (endpoint === "/admin/jurisdictions/wording-keys")
      return { data: { keys: { "help.subtitle": "Under the service name" } } };
    const put = endpoint.match(/^\/admin\/jurisdictions\/(\w+)$/);
    if (put && method === "PUT") {
      const existing = list.find((j) => j.code === put[1]);
      if ((existing?.version ?? "") !== body.version)
        return { error: existing && !body.version ? `${put[1]} already exists` : "changed", status: 409 };
      const { version: _, sign_off: signOff, ...fields } = body;
      // As the API: going live records the sign-off, leaving live clears it.
      const sign_off =
        fields.stage !== "live"
          ? null
          : signOff
            ? { service_lead: signOff.service_lead, signed_off_at: "2026-11-12T10:00:00" }
            : (existing?.sign_off ?? null);
      const saved = { code: put[1], member_count: 0, ...fields, sign_off, version: `${existing?.version ?? ""}+` } as api.AdminJurisdiction;
      list = [...list.filter((j) => j.code !== saved.code), saved];
      return { data: saved };
    }
    if (endpoint.startsWith("/admin/users?") && method === "GET") {
      const params = new URLSearchParams(endpoint.split("?")[1]);
      const code = params.get("jurisdiction");
      const items = adminList.map((h) => ({
        id: h.id,
        email: h.email,
        name: null,
        is_active: true,
        pending: !!h.pending,
        assignments: [{ id: h.assignmentId, jurisdiction: { code, name: code }, role: "JurisdictionAdministrator" }],
      }));
      return { data: { items, total: items.length, page: 1, page_size: 100 } };
    }
    if (endpoint === "/admin/assignments" && method === "POST") {
      if (body.email === "nope@example.test")
        return { error: "You cannot give that role", status: 403, code: "assignment_not_allowed" };
      adminList.push({ assignmentId: `a-${adminList.length + 1}`, id: `u-${adminList.length + 1}`, email: body.email, pending: true });
      return { data: { id: "new", jurisdiction: { code: body.jurisdiction }, role: body.role }, status: 201 };
    }
    if (endpoint.startsWith("/admin/assignments/") && method === "DELETE") {
      const index = adminList.findIndex((h) => h.assignmentId === endpoint.split("/").pop());
      if (index < 0) return { error: "No such assignment", status: 404 };
      adminList.splice(index, 1);
      return { data: undefined, status: 204 };
    }
    // DIAAT-344: the open jurisdiction's templates (none here).
    if (/^\/admin\/jurisdictions\/\w+\/templates$/.test(endpoint) && method === "GET") return { data: [] };
    throw new Error(`Unexpected ${method} ${endpoint}`);
  });
  return {
    /** Someone else changes `code` meanwhile. */
    changeElsewhere(code: string, name: string) {
      list = list.map((j) => (j.code === code ? { ...j, name, version: `${j.version}+` } : j));
    },
    /** The list cannot be loaded from now on. */
    refuseList() {
      listRefused = true;
    },
  };
}

describe("JurisdictionsPanel", () => {
  beforeEach(() => {
    persona = ME.jurisdictionSuperAdministrator;
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("lists the jurisdictions with their users and status, and no sign of auto-enrol", async () => {
    serve({ jurisdictions: [IAC, ET] });
    render(<JurisdictionsPanel />);

    expect(await screen.findByRole("button", { name: "IAC" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ET" })).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.queryByText(/New users join/i)).toBeNull();
  });

  // DIAAT-345: stages. An API that reports them gets the stage controls; one that does not
  // is left as it was, because it would ignore them and make a "draft" visible to everyone.
  describe("stages (DIAAT-345)", () => {
    const STAGED: api.AdminJurisdiction = {
      ...ET,
      display_name: "Employment Tribunals (ET)",
      service: "England and Wales",
      stage: "draft",
      problems: ["It has no template yet"],
    };
    const LIVE: api.AdminJurisdiction = { ...IAC, stage: "live" };

    it("says Draft, Test or Live beside each jurisdiction, with its display name and service", async () => {
      serve({ jurisdictions: [STAGED, { ...LIVE, stage: "test" }] });
      render(<JurisdictionsPanel />);

      expect(await screen.findByText("Employment Tribunals (ET)")).toBeTruthy();
      expect(screen.getByText("England and Wales")).toBeTruthy();
      expect(screen.getByText("Test")).toBeTruthy();
      expect(screen.queryByText("Draft")).not.toBeNull();
    });

    it("shows who sees a draft, and what stops it being switched on", async () => {
      serve({ jurisdictions: [STAGED, LIVE] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "ET" }));

      expect(screen.getByLabelText("Display name")).toBeTruthy();
      expect(screen.getByText("Who sees it")).toBeTruthy();
      expect(screen.getByText("It has no template yet")).toBeTruthy();
    });

    it("sends the stage, display name and service with a save", async () => {
      serve({ jurisdictions: [STAGED, LIVE] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "ET" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
      expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
        display_name: "Employment Tribunals (ET)",
        service: "England and Wales",
        stage: "draft",
      });
    });

    it("offers none of it, and sends none of it, to an API that does not report stages", async () => {
      serve({ jurisdictions: [IAC] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));
      expect(screen.queryByLabelText("Display name")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
      expect(JSON.parse(String(put?.[1]?.body))).not.toHaveProperty("stage");
    });
  });

  it("does not show a jurisdiction's templates: they are its administrator's, under Templates (DIAAT-406)", async () => {
    serve({ jurisdictions: [IAC] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "IAC" }));

    expect(await screen.findByRole("heading", { name: "Administrators of IAC" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Templates of IAC" })).toBeNull();
    expect(request.mock.calls.some(([endpoint]) => String(endpoint).includes("/templates"))).toBe(false);
  });

  it("adds the ET with its wording, no template and no hearing recordings", async () => {
    serve();
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: /Add jurisdiction/ }));
    expect(screen.queryByLabelText(/join it on first sign-in/i)).toBeNull();
    await user.type(screen.getByLabelText("Code"), "et");
    await user.type(screen.getByLabelText("Name"), "Employment Tribunal");
    await user.type(screen.getByLabelText("Under the service name"), "Employment Tribunal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved ET"));
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(put?.[0]).toBe("/admin/jurisdictions/ET");
    // No `auto_enrol`: the field is gone from the request.
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      name: "Employment Tribunal",
      enabled: true,
      settings: {
        wording: { "help.subtitle": "Employment Tribunal" },
        template: null,
        features: { hearing_recordings: false },
      },
      version: "",
    });
    // The new jurisdiction opens, ready for its administrators.
    expect(await screen.findByRole("heading", { name: "Administrators of ET" })).toBeTruthy();
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

  it("lists a jurisdiction's administrators from the user list, and shows no judge or member vocabulary", async () => {
    serve({
      jurisdictions: [ET],
      admins: [{ assignmentId: "a-1", id: "u-1", email: "admin@example.test" }],
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    expect(await screen.findByText("admin@example.test")).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      expect.stringMatching(/^\/admin\/users\?.*jurisdiction=ET.*role=JurisdictionAdministrator/),
      expect.anything()
    );
    expect(screen.queryByText(/Members of/)).toBeNull();
    expect(screen.queryByText(/Add member/)).toBeNull();
    expect(request.mock.calls.some(([endpoint]) => String(endpoint).includes("/members"))).toBe(false);
  });

  it("adds an administrator by email, as a JurisdictionAdministrator assignment, and removes one", async () => {
    serve({ jurisdictions: [IAC, ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    expect(await screen.findByText("Nobody yet.")).toBeTruthy();
    await user.type(screen.getByLabelText("Sign-in email"), "Hamza.Ahmed@justice.gov.uk");
    await user.click(screen.getByRole("button", { name: /Add administrator/ }));

    expect(await screen.findByText("hamza.ahmed@justice.gov.uk")).toBeTruthy();
    const post = request.mock.calls.find(([endpoint]) => endpoint === "/admin/assignments");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      user_id: null,
      email: "hamza.ahmed@justice.gov.uk",
      jurisdiction: "ET",
      role: "JurisdictionAdministrator",
    });
    expect(toast.success).toHaveBeenCalledWith("hamza.ahmed@justice.gov.uk is now an administrator");
    expect((screen.getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("");

    // Removing needs a second, deliberate click.
    await user.click(screen.getByRole("button", { name: /Remove hamza.ahmed@justice.gov.uk/ }));
    expect(request.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(await screen.findByText("Nobody yet.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("/admin/assignments/a-1", { method: "DELETE" });
  });

  it("shows the API's reason when something is refused", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.type(await screen.findByLabelText("Sign-in email"), "nope@example.test");
    await user.click(screen.getByRole("button", { name: /Add administrator/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot give that role"));
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("nope@example.test");
  });

  it("does not report a removal that was refused", async () => {
    serve({ jurisdictions: [ET], admins: [{ assignmentId: "a-1", id: "u-1", email: "a@example.test" }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(await screen.findByRole("button", { name: /Remove a@example.test/ }));
    const fake = request.getMockImplementation();
    request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
      options?.method === "DELETE"
        ? { error: "You cannot remove that role", status: 403 }
        : (fake as typeof apiClient.request)(endpoint, options)
    );
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot remove that role"));
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

  it("keeps unsaved edits when an administrator is added", async () => {
    serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.type(name, "s");
    await user.type(screen.getByLabelText("Sign-in email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: /Add administrator/ }));

    expect(await screen.findByText("a@example.test")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Employment Tribunals");
  });

  it("refuses a stale form even after another change shows the newer copy", async () => {
    const api = serve({ jurisdictions: [ET] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.type(screen.getByLabelText("Name"), " (mine)");
    api.changeElsewhere("ET", "Employment Tribunals (theirs)");
    await user.type(screen.getByLabelText("Sign-in email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: /Add administrator/ }));
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

  it("switches a jurisdiction on for everyone only with the service lead's sign-off (DIAAT-347)", async () => {
    serve({ jurisdictions: [{ ...ET, stage: "test" }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));
    await user.click(screen.getByLabelText("Who sees it"));
    await user.click(await screen.findByRole("option", { name: "Live: everyone with a role there sees it" }));
    const signOff = screen.getByRole("group", { name: "Service lead's sign-off" });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(signOff.textContent).toContain("Enter the service lead's name and tick that they have signed it off.");
    expect(request.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(false);

    await user.type(screen.getByLabelText("Service lead who signed it off"), "A Lead");
    await user.click(screen.getByLabelText("The service lead has signed this off"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(request.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(true));
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body));
    expect([body.stage, body.sign_off]).toEqual(["live", { service_lead: "A Lead", confirmed: true }]);
  });

  it("shows who signed a live jurisdiction off, and does not ask again", async () => {
    serve({
      jurisdictions: [{ ...ET, stage: "live", sign_off: { service_lead: "A Lead", signed_off_at: "2026-11-12T10:00:00" } }],
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);

    await user.click(await screen.findByRole("button", { name: "ET" }));

    expect(screen.getByText("Signed off by A Lead on 12 November 2026.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Service lead's sign-off" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(request.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(true));
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).sign_off).toBeUndefined();
  });

  /** Choose a stage in the open editor and save it. */
  async function saveStage(user: ReturnType<typeof userEvent.setup>, label: string) {
    const puts = request.mock.calls.filter(([, o]) => o?.method === "PUT").length;
    await user.click(screen.getByLabelText("Who sees it"));
    await user.click(await screen.findByRole("option", { name: label }));
    if (screen.queryByRole("group", { name: "Service lead's sign-off" })) {
      await user.type(screen.getByLabelText("Service lead who signed it off"), "A Lead");
      await user.click(screen.getByLabelText("The service lead has signed this off"));
    }
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(request.mock.calls.filter(([, o]) => o?.method === "PUT")).toHaveLength(puts + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false));
  }

  it("asks for a fresh sign-off each time it goes live again", async () => {
    serve({ jurisdictions: [{ ...ET, stage: "test" }] });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);
    await user.click(await screen.findByRole("button", { name: "ET" }));

    await saveStage(user, "Live: everyone with a role there sees it");
    await saveStage(user, "Test: its administrators and test group see it");
    await user.click(screen.getByLabelText("Who sees it"));
    await user.click(await screen.findByRole("option", { name: "Live: everyone with a role there sees it" }));

    expect(screen.getByLabelText("Service lead who signed it off")).toHaveProperty("value", "");
    expect(screen.getByLabelText("The service lead has signed this off").getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter the service lead's name and tick that they have signed it off."
    );
    expect(request.mock.calls.filter(([, o]) => o?.method === "PUT")).toHaveLength(2);
  });

  it("asks for the sign-off after leaving live, even when the list could not be reloaded", async () => {
    const fake = serve({
      jurisdictions: [{ ...ET, stage: "live", sign_off: { service_lead: "A Lead", signed_off_at: "2026-11-12T10:00:00" } }],
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);
    await user.click(await screen.findByRole("button", { name: "ET" }));

    fake.refuseList();
    await saveStage(user, "Test: its administrators and test group see it");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await user.click(screen.getByLabelText("Who sees it"));
    await user.click(await screen.findByRole("option", { name: "Live: everyone with a role there sees it" }));

    expect(screen.getByRole("group", { name: "Service lead's sign-off" })).toBeTruthy();
    expect(screen.queryByText("Signed off by A Lead on 12 November 2026.")).toBeNull();
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

  it("shows who changed the screen text and what it was, and goes back to it (DIAAT-348)", async () => {
    serve({ jurisdictions: [{ ...ET, stage: "live", settings: { ...ET.settings, wording: { "help.subtitle": "A mistake" } } }] });
    const jurisdictions = request.getMockImplementation();
    if (!jurisdictions) throw new Error("serve() sets the fake API");
    let restored = false;
    let answerRestore: () => void = () => undefined;
    const RESTORED = { ...ET, stage: "live" as const, version: "restored" };
    request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === "/admin/jurisdictions/ET/history")
        return {
          data: {
            versions: [
              {
                number: 2,
                saved_at: "2026-11-12T15:00:00Z",
                saved_by: { id: "u1", email: "lead@example.test", name: null },
                restored_from: null,
                first: false,
                content_as_now: true,
                changes: [{ setting: "settings.wording.help.subtitle", before: "Employment Tribunal", after: "A mistake" }],
              },
              {
                number: 1,
                saved_at: "2026-11-12T14:00:00Z",
                saved_by: null,
                restored_from: null,
                first: true,
                content_as_now: false,
                changes: [],
              },
            ],
          },
        };
      if (endpoint === "/admin/jurisdictions/ET/history/1/restore" && options?.method === "POST") {
        await new Promise<void>((resolve) => {
          answerRestore = resolve;
        });
        restored = true;
        return { data: RESTORED };
      }
      // The editor reopens from the restore's answer, not from a reload.
      if (endpoint === "/admin/jurisdictions" && restored) return { error: "Service unavailable", status: 503 };
      return jurisdictions(endpoint, options);
    });
    const user = userEvent.setup();
    render(<JurisdictionsPanel />);
    await user.click(await screen.findByRole("button", { name: "ET" }));
    const history = screen.getByRole("region", { name: "History" });

    await user.click(within(history).getByRole("button", { name: "Show who changed what" }));
    expect(
      (await within(history).findByText(/Screen text: Under the service name/)).closest("li")?.textContent
    ).toBe("Screen text: Under the service name: was Employment Tribunal, now A mistake");
    await user.click(within(history).getByRole("button", { name: "Go back to version 1" }));
    await user.click(within(history).getByRole("button", { name: "Confirm: go back to version 1" }));

    // Nothing can be edited or saved meanwhile: the editor reopens when it is done.
    expect(screen.getByLabelText("Under the service name").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveProperty("disabled", true);
    // Nor can another be opened, whose edits the reopening would drop.
    expect(screen.getByRole("button", { name: "ET" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Add jurisdiction/ })).toHaveProperty("disabled", true);
    answerRestore();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("ET is back to version 1."));
    const restore = request.mock.calls.find(([endpoint]) => endpoint.endsWith("/restore"));
    expect(JSON.parse(String(restore?.[1]?.body))).toEqual({ version: ET.version });
    // The editor reopens from the server's copy, with its version for the next save.
    await waitFor(() => expect(screen.getByLabelText("Under the service name")).toHaveProperty("value", "Employment Tribunal"));
    expect(screen.getByLabelText("Under the service name").matches(":disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /Add jurisdiction/ })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const save = request.mock.calls.find(([endpoint, options]) => endpoint === "/admin/jurisdictions/ET" && options?.method === "PUT");
    expect(JSON.parse(String(save?.[1]?.body)).version).toBe("restored");
  });

  describe("by permission", () => {
    it("shows creating a jurisdiction only with jurisdiction.create", async () => {
      persona = SETTINGS_ONLY;
      serve({ jurisdictions: [IAC] });
      render(<JurisdictionsPanel />);

      expect(await screen.findByRole("button", { name: "IAC" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add jurisdiction/ })).toBeNull();
    });

    it("gives the settings but no say over administrators without jurisdiction_admin.assign", async () => {
      persona = SETTINGS_ONLY;
      serve({ jurisdictions: [IAC] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /Administrators of/ })).toBeNull();
      expect(request.mock.calls.some(([endpoint]) => String(endpoint).startsWith("/admin/users"))).toBe(false);
    });

    it("lets a holder of jurisdictions.manage edit the settings but not rename or switch off (needs jurisdiction.create)", async () => {
      persona = SETTINGS_ONLY;
      serve({ jurisdictions: [IAC] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));

      expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
      expect(screen.getByLabelText("Enabled").hasAttribute("disabled")).toBe(true);
      expect(screen.getByText(/Only a super administrator can rename a jurisdiction/)).toBeTruthy();
      // The settings stay theirs: template, recordings, wording.
      expect(screen.getByLabelText("Uses hearing recordings").hasAttribute("disabled")).toBe(false);
      await user.type(screen.getByLabelText("Under the service name"), "Words");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved IAC"));
      // What is sent is the name and enabled it already has, as the API asks.
      const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
      const sent = JSON.parse(String(put?.[1]?.body));
      expect(sent.name).toBe("Immigration and Asylum Chamber");
      expect(sent.enabled).toBe(true);
      expect(sent.settings.wording).toEqual({ "help.subtitle": "Words" });
    });

    it("lets a super administrator (jurisdiction.create) rename and switch off", async () => {
      persona = ME.jurisdictionSuperAdministrator;
      serve({ jurisdictions: [IAC] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));

      expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(false);
      expect(screen.getByLabelText("Enabled").hasAttribute("disabled")).toBe(false);
      expect(screen.queryByText(/Only a super administrator can rename/)).toBeNull();
    });

    it("explains a 403 permission_denied on save as the rename rule", async () => {
      persona = ME.jurisdictionSuperAdministrator;
      serve({ jurisdictions: [IAC] });
      const base = request.getMockImplementation() as typeof apiClient.request;
      request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
        options?.method === "PUT"
          ? { error: "Your role cannot do that", status: 403, code: "permission_denied" }
          : base(endpoint, options)
      );
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Only a super administrator can rename or switch off"))
      );
    });

    it("lets a super administrator appoint themselves with Add me (DIAAT-406)", async () => {
      persona = ME.jurisdictionSuperAdministrator;
      serve({ jurisdictions: [ET] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "ET" }));
      await user.click(await screen.findByRole("button", { name: "Add me" }));

      await waitFor(() =>
        expect(request.mock.calls.some(([endpoint]) => endpoint === "/admin/assignments")).toBe(true)
      );
      const post = request.mock.calls.find(([endpoint]) => endpoint === "/admin/assignments");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        user_id: ME.jurisdictionSuperAdministrator.user.id,
        jurisdiction: "ET",
        role: "JurisdictionAdministrator",
      });
    });

    it("lets a super administrator appoint themselves as a jurisdiction administrator (DIAAT-403)", async () => {
      persona = ME.jurisdictionSuperAdministrator;
      serve({ jurisdictions: [ET] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "ET" }));
      await user.type(await screen.findByLabelText("Sign-in email"), "someone@localhost.test");
      const add = screen.getByRole("button", { name: /Add administrator/ }) as HTMLButtonElement;
      expect(add.disabled).toBe(false);
      await user.click(add);

      await waitFor(() =>
        expect(request.mock.calls.some(([endpoint]) => endpoint === "/admin/assignments")).toBe(true)
      );
      const post = request.mock.calls.find(([endpoint]) => endpoint === "/admin/assignments");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        email: "someone@localhost.test",
        jurisdiction: "ET",
        role: "JurisdictionAdministrator",
      });
    });
  });
});
