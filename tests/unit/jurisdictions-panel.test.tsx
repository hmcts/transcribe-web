import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionsPanel } from "@/components/admin/jurisdictions-panel";
import type * as api from "@/lib/admin-jurisdictions-api";
import { apiClient } from "@/lib/api-client";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { ME } from "../access-helpers";

// DIAAT-356, DIAAT-394: whoever may manage jurisdictions adds one and edits its
// settings from the admin area, because nobody may run a command on the cluster.
// Who administers a jurisdiction is a role assignment (DIAAT-373), not a setting.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

let persona = ME.jurisdictionSuperAdministrator;
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
  const adminList = [...admins];
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

  describe("by permission", () => {
    it("shows creating a jurisdiction only with jurisdiction.create", async () => {
      persona = ME.jurisdictionAdministrator; // jurisdictions.manage, not jurisdiction.create
      serve({ jurisdictions: [IAC] });
      render(<JurisdictionsPanel />);

      expect(await screen.findByRole("button", { name: "IAC" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add jurisdiction/ })).toBeNull();
    });

    it("gives a jurisdiction administrator the settings but no say over administrators", async () => {
      persona = ME.jurisdictionAdministrator; // no jurisdiction_admin.assign
      serve({ jurisdictions: [IAC] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /Administrators of/ })).toBeNull();
      expect(request.mock.calls.some(([endpoint]) => String(endpoint).startsWith("/admin/users"))).toBe(false);
    });

    it("lets a jurisdiction administrator edit the settings but not rename or switch off (needs jurisdiction.create)", async () => {
      persona = ME.jurisdictionAdministrator;
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

    it("does not offer a super administrator to appoint themselves as a jurisdiction administrator", async () => {
      // jurisdiction_admin.assign without jurisdiction_super_admin.assign: a super administrator.
      persona = ME.jurisdictionSuperAdministrator;
      serve({ jurisdictions: [ET] });
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "ET" }));
      await user.type(await screen.findByLabelText("Sign-in email"), "someone@localhost.test");

      expect(screen.getByText(/You cannot give yourself a role/)).toBeTruthy();
      expect((screen.getByRole("button", { name: /Add administrator/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("gives whoever assigns administrators but cannot manage jurisdictions only the names and the administrators", async () => {
      persona = ME.sysadminOnly; // jurisdiction_admin.assign, no jurisdictions.manage or jurisdiction.create
      serve({ admins: [] });
      const base = request.getMockImplementation() as typeof apiClient.request;
      request.mockImplementation(async (endpoint: string, options?: RequestInit) =>
        endpoint === "/jurisdictions/public"
          ? { data: [{ code: "IAC", name: "Immigration and Asylum Chamber" }] }
          : base(endpoint, options)
      );
      const user = userEvent.setup();
      render(<JurisdictionsPanel />);

      await user.click(await screen.findByRole("button", { name: "IAC" }));
      expect(await screen.findByRole("heading", { name: "Administrators of IAC" })).toBeTruthy();
      // The admin list and the settings are not theirs, and are never asked for.
      expect(screen.queryByRole("button", { name: /Add jurisdiction/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(request.mock.calls.some(([endpoint]) => String(endpoint).startsWith("/admin/jurisdictions"))).toBe(false);
    });
  });
});
