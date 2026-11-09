import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersPanel } from "@/components/admin/users-panel";
import type { MeResponse } from "@/lib/access/types";
import type { AdminUser, RoleHistoryEntry } from "@/lib/admin-users-api";
import { apiClient } from "@/lib/api-client";
import { IAC_REF, ME } from "../access-helpers";

// DIAAT-385, DIAAT-391, DIAAT-394, DIAAT-374: Admin > Users. The roles on offer
// are the API's own list; the screen keeps none.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let persona: MeResponse = ME.jurisdictionAdministrator;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);

import { toast } from "sonner";

// Radix's checkbox (inside a form) measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
);

const request = vi.mocked(apiClient.request);

const withoutHistory = (me: MeResponse): MeResponse => ({
  ...me,
  permissions: me.permissions.filter((p) => p !== "role_audit.read"),
});

const ET = { code: "ET", name: "Employment Tribunal" };
const at = (id: string, role: string, jurisdiction = IAC_REF) => ({
  id,
  jurisdiction,
  role,
});
const person = (over: Partial<AdminUser> & Pick<AdminUser, "id" | "email">): AdminUser => ({
  name: null,
  is_active: true,
  pending: false,
  assignments: [],
  ...over,
});

const ANNA = person({
  id: "u-anna",
  email: "anna@example.test",
  name: "Anna Judge",
  assignments: [at("as-1", "Judge"), at("as-2", "LegalTextManager")],
});
const BOB = person({
  id: "u-bob",
  email: "bob@example.test",
  assignments: [at("as-3", "JurisdictionAdministrator")],
});
const GONE = person({ id: "u-gone", email: "gone@example.test", is_active: false });
const PENDING = person({
  id: "p-1",
  email: "later@example.test",
  pending: true,
  assignments: [at("as-4", "Judge")],
});
const ME_ROW = person({
  id: "u-1", // the signed-in user in tests/access-helpers
  email: "someone@localhost.test",
  assignments: [at("as-5", "JurisdictionAdministrator")],
});

interface Server {
  users: AdminUser[];
  roles: string[];
  history: RoleHistoryEntry[];
  refuse?: Record<string, { error: string; status: number; code?: string }>;
}

function serve(initial: Partial<Server> = {}) {
  const state: Server = {
    users: [ANNA, BOB, GONE, PENDING, ME_ROW],
    roles: ["Judge", "LegalTextManager"],
    history: [],
    ...initial,
  };
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const [path, query = ""] = endpoint.split("?");
    const params = new URLSearchParams(query);
    if (state.refuse?.[`${method} ${path}`]) return state.refuse[`${method} ${path}`];
    if (path === "/admin/roles") return { data: { roles: state.roles } };
    if (path === "/admin/jurisdictions") {
      return { data: [{ ...IAC_REF }, { ...ET }] };
    }
    if (path === "/admin/users" && method === "GET") {
      const search = (params.get("search") ?? "").toLowerCase();
      const size = Number(params.get("page_size") ?? 25);
      const page = Number(params.get("page") ?? 1);
      const rows = state.users.filter((u) => u.email.includes(search));
      return {
        data: {
          items: rows.slice((page - 1) * size, page * size),
          total: rows.length,
          page,
          page_size: size,
        },
      };
    }
    if (path === "/admin/assignments" && method === "POST") {
      return { data: { id: "new", jurisdiction: { code: body.jurisdiction }, role: body.role }, status: 201 };
    }
    if (path.startsWith("/admin/assignments/") && method === "DELETE") {
      const id = path.split("/").pop();
      state.users = state.users.map((u) => ({
        ...u,
        assignments: u.assignments.filter((a) => a.id !== id),
      }));
      return { data: undefined, status: 204 };
    }
    const toggle = path.match(/^\/admin\/users\/([^/]+)\/(deactivate|reactivate)$/);
    if (toggle && method === "POST") {
      state.users = state.users.map((u) =>
        u.id === toggle[1] ? { ...u, is_active: toggle[2] === "reactivate" } : u
      );
      return { data: undefined, status: 204 };
    }
    if (path === "/admin/role-history") {
      const size = Number(params.get("page_size") ?? 50);
      const page = Number(params.get("page") ?? 1);
      return {
        data: {
          items: state.history.slice((page - 1) * size, page * size),
          total: state.history.length,
        },
      };
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  });
  return state;
}

const calls = (method: string, path: string) =>
  request.mock.calls.filter(
    ([endpoint, o]) => (o?.method ?? "GET") === method && String(endpoint).split("?")[0] === path
  );

beforeEach(() => {
  persona = ME.jurisdictionAdministrator;
  request.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("the people list", () => {
  it("shows each user with their roles per jurisdiction as chips, and who has not signed in yet", async () => {
    serve();
    render(<UsersPanel />);

    const anna = await screen.findByRole("list", { name: "Roles of anna@example.test" });
    expect(within(anna).getByText("Judge in IAC")).toBeTruthy();
    expect(within(anna).getByText("Legal text manager in IAC")).toBeTruthy();
    expect(screen.getByText("Anna Judge")).toBeTruthy();
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
    expect(screen.getByText("Deactivated")).toBeTruthy();
    expect(screen.getByText("No roles")).toBeTruthy();
  });

  it("says a change takes effect within a few minutes", async () => {
    serve();
    render(<UsersPanel />);
    expect(await screen.findByText(/takes effect for the person within a few minutes/)).toBeTruthy();
  });

  it("searches by email, from the first page", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);
    await screen.findByText("anna@example.test");

    await user.type(screen.getByLabelText("Search by email"), "bob");

    await waitFor(() => expect(screen.queryByText("anna@example.test")).toBeNull());
    expect(screen.getByText("bob@example.test")).toBeTruthy();
    expect(
      request.mock.calls.some(([e]) => String(e).startsWith("/admin/users?") && String(e).includes("search=bob") && String(e).includes("page=1"))
    ).toBe(true);
  });

  it("pages through a long list", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      person({ id: `u-${i}`, email: `user${String(i).padStart(2, "0")}@example.test` })
    );
    serve({ users: many });
    const user = userEvent.setup();
    render(<UsersPanel />);

    expect(await screen.findByText("user00@example.test")).toBeTruthy();
    expect(screen.getByText(/Page 1 of 2 \(30 in all\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("user29@example.test")).toBeTruthy();
    expect(screen.queryByText("user00@example.test")).toBeNull();
    expect(screen.getByText(/Page 2 of 2/)).toBeTruthy();
  });

  it("filters by jurisdiction when the caller works across several", async () => {
    persona = ME.jurisdictionSuperAdministrator;
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);
    await screen.findByText("anna@example.test");

    await user.selectOptions(await screen.findByLabelText("Filter by jurisdiction"), "ET");

    await waitFor(() =>
      expect(request.mock.calls.some(([e]) => String(e).includes("jurisdiction=ET"))).toBe(true)
    );
  });
});

describe("the roles on offer come from the API", () => {
  it("never offers JurisdictionAdministrator when the API does not list it", async () => {
    serve({ roles: ["Judge", "LegalTextManager"] });
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    expect(await within(form).findByLabelText("Judge")).toBeTruthy();
    expect(within(form).getByLabelText("Legal text manager")).toBeTruthy();
    expect(within(form).queryByLabelText(/Jurisdiction administrator/i)).toBeNull();
    expect(within(form).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("offers it when the API lists it (a super administrator)", async () => {
    persona = ME.jurisdictionSuperAdministrator;
    serve({ roles: ["Judge", "LegalTextManager", "JurisdictionAdministrator"] });
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    expect(await within(form).findByLabelText("Jurisdiction administrator")).toBeTruthy();
    expect(within(form).getAllByRole("checkbox")).toHaveLength(3);
  });

  it("offers exactly what the list says, whatever that is (no list of its own)", async () => {
    serve({ roles: ["Judge"] });
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await within(form).findByLabelText("Judge");
    expect(within(form).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("offers no way to remove a role the API does not let the caller assign", async () => {
    serve({ roles: ["Judge", "LegalTextManager"] });
    render(<UsersPanel />);

    const bob = await screen.findByRole("list", { name: "Roles of bob@example.test" });
    expect(within(bob).getByText("Jurisdiction administrator in IAC")).toBeTruthy();
    expect(within(bob).queryByRole("button")).toBeNull();
    const anna = screen.getByRole("list", { name: "Roles of anna@example.test" });
    expect(within(anna).getAllByRole("button")).toHaveLength(2);
  });

  it("lets a caller whose list includes it remove that role", async () => {
    persona = ME.jurisdictionSuperAdministrator;
    serve({ roles: ["Judge", "LegalTextManager", "JurisdictionAdministrator"] });
    render(<UsersPanel />);

    const bob = await screen.findByRole("list", { name: "Roles of bob@example.test" });
    await waitFor(() => expect(within(bob).getAllByRole("button")).toHaveLength(1));
  });

  it("shows the API's reason when the roles cannot be loaded", async () => {
    serve({ refuse: { "GET /admin/roles": { error: "Needs admin.access", status: 403 } } });
    render(<UsersPanel />);

    expect(await screen.findByText("Needs admin.access")).toBeTruthy();
  });
});

describe("adding a user", () => {
  it("adds by email with several roles: one assignment for each, to the working jurisdiction", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), "New.Person@Example.test");
    await user.click(await within(form).findByLabelText("Judge"));
    await user.click(within(form).getByLabelText("Legal text manager"));
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(calls("POST", "/admin/assignments")).toHaveLength(2));
    const bodies = calls("POST", "/admin/assignments").map(([, o]) => JSON.parse(String(o?.body)));
    expect(bodies).toEqual([
      { user_id: null, email: "new.person@example.test", jurisdiction: "IAC", role: "Judge" },
      { user_id: null, email: "new.person@example.test", jurisdiction: "IAC", role: "LegalTextManager" },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Added new.person@example.test to IAC as judge, legal text manager"
    );
    expect((within(form).getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("");
  });

  it("will not add without a person, a role and a jurisdiction", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    const add = () => within(form).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    await user.type(within(form).getByLabelText("Sign-in email"), "not-an-email");
    await user.click(await within(form).findByLabelText("Judge"));
    expect(add().disabled).toBe(true);
    await user.type(within(form).getByLabelText("Sign-in email"), "@example.test");
    expect(add().disabled).toBe(false);
  });

  it("picks someone who has already signed in, and adds by their id", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), "gone");
    await user.click(await within(form).findByRole("button", { name: /gone@example.test/ }));
    expect((within(form).getByLabelText("Sign-in email") as HTMLInputElement).value).toBe("gone@example.test");
    await user.click(await within(form).findByLabelText("Judge"));
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(calls("POST", "/admin/assignments")).toHaveLength(1));
    expect(JSON.parse(String(calls("POST", "/admin/assignments")[0][1]?.body))).toEqual({
      user_id: "u-gone",
      email: null,
      jurisdiction: "IAC",
      role: "Judge",
    });
  });

  it("keeps a refused role ticked and shows the API's reason, and still adds the others", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) => {
      if (endpoint === "/admin/assignments" && JSON.parse(String(options?.body)).role === "LegalTextManager") {
        return { error: "You cannot give that role", status: 403, code: "assignment_not_allowed" };
      }
      return base(endpoint, options);
    });
    const user = userEvent.setup();
    render(<UsersPanel />);

    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), "x@example.test");
    await user.click(await within(form).findByLabelText("Judge"));
    await user.click(within(form).getByLabelText("Legal text manager"));
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Legal text manager was not added: You cannot give that role")
    );
    expect(toast.success).toHaveBeenCalledWith("Added x@example.test to IAC as judge");
    expect(within(form).getByLabelText("Legal text manager").getAttribute("aria-checked")).toBe("true");
    expect(within(form).getByLabelText("Judge").getAttribute("aria-checked")).toBe("false");
  });
});

describe("removing a role", () => {
  it("asks first, then removes that assignment by id", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Remove Judge in IAC from anna@example.test" }));
    expect(calls("DELETE", "/admin/assignments/as-1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Remove role" }));

    await waitFor(() => expect(calls("DELETE", "/admin/assignments/as-1")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Removed Judge from anna@example.test");
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Roles of anna@example.test" })).queryByText("Judge in IAC")
      ).toBeNull()
    );
  });

  it("can be called off", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Remove Judge in IAC from anna@example.test" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("DELETE", "/admin/assignments/as-1")).toHaveLength(0);
  });

  it("shows the API's reason when the removal is refused", async () => {
    serve({ refuse: { "DELETE /admin/assignments/as-1": { error: "You cannot remove that role", status: 403 } } });
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Remove Judge in IAC from anna@example.test" }));
    await user.click(screen.getByRole("button", { name: "Remove role" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot remove that role"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("deactivating and reactivating", () => {
  it("deactivates after a confirmation, and reactivates at once", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Deactivate anna@example.test" }));
    expect(calls("POST", "/admin/users/u-anna/deactivate")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Confirm deactivate" }));
    await waitFor(() => expect(calls("POST", "/admin/users/u-anna/deactivate")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Deactivated anna@example.test");

    await user.click(await screen.findByRole("button", { name: "Reactivate gone@example.test" }));
    await waitFor(() => expect(calls("POST", "/admin/users/u-gone/reactivate")).toHaveLength(1));
  });

  it("offers nobody the chance to deactivate themselves, and nobody who has not signed in", async () => {
    serve();
    render(<UsersPanel />);

    await screen.findByText(/someone@localhost.test/);
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Deactivate someone@localhost.test/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Deactivate later@example.test/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Deactivate anna@example.test" })).toBeTruthy();
  });

  it("offers it only for people whose every role the caller may assign (the API refuses the rest)", async () => {
    // bob is a jurisdiction administrator: not in this caller's list, so 403 assignment_not_allowed.
    serve({ roles: ["Judge", "LegalTextManager"] });
    const { unmount } = render(<UsersPanel />);
    await screen.findByText("bob@example.test");
    expect(screen.queryByRole("button", { name: "Deactivate bob@example.test" })).toBeNull();
    expect(screen.getByRole("button", { name: "Deactivate anna@example.test" })).toBeTruthy();
    unmount();

    serve({ roles: ["Judge", "LegalTextManager", "JurisdictionAdministrator"] });
    render(<UsersPanel />);
    expect(await screen.findByRole("button", { name: "Deactivate bob@example.test" })).toBeTruthy();
  });
});

describe("refusals about who a role goes to", () => {
  async function addAs(email: string, role = "Judge") {
    const user = userEvent.setup();
    render(<UsersPanel />);
    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), email);
    await user.click(await within(form).findByLabelText(role === "Judge" ? "Judge" : "Legal text manager"));
    return { user, form };
  }

  it("does not offer to give yourself a role: a note instead, and Add stays off (typed email)", async () => {
    serve();
    const { form } = await addAs("Someone@Localhost.test");

    expect(within(form).getByText("You cannot give yourself a role. Ask another administrator to add you.")).toBeTruthy();
    expect((within(form).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls("POST", "/admin/assignments")).toHaveLength(0);
  });

  it("does the same for yourself picked from the list of people who have signed in", async () => {
    serve();
    const user = userEvent.setup();
    render(<UsersPanel />);
    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), "someone@loc");
    await user.click(await within(form).findByRole("button", { name: /someone@localhost.test/ }));
    await user.click(await within(form).findByLabelText("Judge"));

    expect(within(form).getByText(/You cannot give yourself a role/)).toBeTruthy();
    expect((within(form).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the holder of jurisdiction_super_admin.assign give themselves a role (the API excepts them)", async () => {
    persona = ME.sysadminOnly;
    serve({ roles: ["JurisdictionAdministrator", "JurisdictionSuperAdministrator"] });
    const user = userEvent.setup();
    render(<UsersPanel />);
    const form = await screen.findByRole("region", { name: "Add a user or give roles" });
    await user.type(within(form).getByLabelText("Sign-in email"), "someone@localhost.test");

    expect(within(form).queryByText(/You cannot give yourself a role/)).toBeNull();
  });

  it("says why when the API refuses a role for yourself anyway (403 assignment_not_allowed)", async () => {
    // A caller the web cannot tell is themselves (their email differs in the form).
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      endpoint === "/admin/assignments"
        ? { error: "You cannot give yourself a role.", status: 403, code: "assignment_not_allowed" }
        : base(endpoint, options)
    );
    const { user, form } = await addAs("x@example.test");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    // Not known to be themselves: the API's own words are shown.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Judge was not added: You cannot give yourself a role.")
    );
  });

  it("explains an ambiguous email (409) and says to pick the person from the list", async () => {
    serve({
      refuse: {
        "POST /admin/assignments": {
          error: "More than one user has signed in with that email address: choose the person from the user list.",
          status: 409,
          code: "ambiguous_email",
        },
      },
    });
    const { user, form } = await addAs("twin@example.test");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Judge was not added: More than one person has signed in with that email address.*Choose the person from the list/)
      )
    );
    // What was refused stays ticked so it can be tried again with the person picked.
    expect(within(form).getByLabelText("Judge").getAttribute("aria-checked")).toBe("true");
  });

  it("explains a disabled jurisdiction (409)", async () => {
    serve({
      refuse: {
        "POST /admin/assignments": {
          error: "That jurisdiction is disabled: nobody can be given a role there.",
          status: 409,
          code: "jurisdiction_disabled",
        },
      },
    });
    const { user, form } = await addAs("new@example.test");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("That jurisdiction is switched off"))
    );
  });
});

describe("the role-change history", () => {
  const entry = (over: Partial<RoleHistoryEntry> = {}): RoleHistoryEntry => ({
    id: "h-1",
    timestamp: "2026-11-02T10:30:00Z",
    actor: { id: "u-bob", email: "bob@example.test" },
    actor_context: { jurisdiction: "IAC", role: "JurisdictionAdministrator" },
    target: { id: "u-anna", email: "anna@example.test" },
    change: "assignment.added",
    jurisdiction: "IAC",
    role: "Judge",
    ...over,
  });

  it("is hidden, and never asked for, without role_audit.read", async () => {
    persona = withoutHistory(ME.jurisdictionAdministrator);
    serve();
    render(<UsersPanel />);

    await screen.findByText("anna@example.test");
    expect(screen.queryByRole("button", { name: "Role history" })).toBeNull();
    expect(calls("GET", "/admin/role-history")).toHaveLength(0);
  });

  it("shows who changed what, in which role, newest first, with role_audit.read", async () => {
    serve({
      history: [
        entry(),
        entry({ id: "h-2", change: "user.deactivated", role: null, target: { id: "u-gone", email: "gone@example.test" } }),
        entry({ id: "h-3", change: "access_request.approved", actor_context: null }),
      ],
    });
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Role history" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Role given")).toBeTruthy();
    expect(within(table).getByText("Deactivated")).toBeTruthy();
    expect(within(table).getByText("Request approved")).toBeTruthy();
    expect(within(table).getAllByText("anna@example.test").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("as jurisdiction administrator in IAC").length).toBeGreaterThan(0);
    expect(calls("GET", "/admin/role-history")).toHaveLength(1);
  });

  it("shows a change made through the system administrator's own permissions (actor.id null) without breaking", async () => {
    serve({
      history: [
        entry({ id: "h-sys", actor: { id: null, email: "system administrator" }, actor_context: null }),
        entry({ id: "h-sys2", actor: { id: null, email: "sysadmin@example.test" }, actor_context: null }),
        entry({ id: "h-norm", actor: { id: "u-bob", email: "bob@example.test" } }),
      ],
    });
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Role history" }));

    const table = await screen.findByRole("table");
    // The API's marker (not an address) reads as words; an address it did give is shown.
    expect(within(table).getByText("System administrator")).toBeTruthy();
    expect(within(table).queryByText("system administrator")).toBeNull();
    expect(within(table).getByText("sysadmin@example.test")).toBeTruthy();
    expect(within(table).getByText("bob@example.test")).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("does not crash on a row with no actor or target at all", async () => {
    serve({
      history: [
        { ...entry({ id: "h-odd" }), actor: undefined, target: undefined } as unknown as RoleHistoryEntry,
      ],
    });
    const user = userEvent.setup();
    render(<UsersPanel />);

    await user.click(await screen.findByRole("button", { name: "Role history" }));

    expect(await screen.findByText("System administrator")).toBeTruthy();
    expect(screen.getByText("Role given")).toBeTruthy();
  });

  it("says so when nothing has been recorded, and shows the API's reason on a refusal", async () => {
    serve({ history: [] });
    const user = userEvent.setup();
    render(<UsersPanel />);
    await user.click(await screen.findByRole("button", { name: "Role history" }));
    expect(await screen.findByText("No role changes have been recorded.")).toBeTruthy();

    serve({ refuse: { "GET /admin/role-history": { error: "Needs role_audit.read", status: 403 } } });
    await user.click(screen.getByRole("button", { name: "People" }));
    await user.click(screen.getByRole("button", { name: "Role history" }));
    expect(await screen.findByText("Needs role_audit.read")).toBeTruthy();
  });
});

describe("what the Users screen never says", () => {
  it("has no system administrator anywhere, in the lists, the form or the history", async () => {
    persona = ME.jurisdictionSuperAdministrator;
    serve({
      roles: ["Judge", "LegalTextManager", "JurisdictionAdministrator"],
      history: [{
        id: "h-1",
        timestamp: "2026-11-02T10:30:00Z",
        actor: { id: "u-bob", email: "bob@example.test" },
        actor_context: { jurisdiction: null, role: "JurisdictionSuperAdministrator" },
        target: { id: "u-anna", email: "anna@example.test" },
        change: "assignment.added",
        jurisdiction: "IAC",
        role: "JurisdictionAdministrator",
      }],
    });
    const user = userEvent.setup();
    const { container } = render(<UsersPanel />);
    await screen.findByText("anna@example.test");
    await screen.findByLabelText("Jurisdiction administrator");
    expect(container.textContent).not.toMatch(/system ?administrator|sysadmin/i);

    await user.click(screen.getByRole("button", { name: "Role history" }));
    await screen.findByText("Role given");
    expect(container.textContent).not.toMatch(/system ?administrator|sysadmin/i);
  });
});
