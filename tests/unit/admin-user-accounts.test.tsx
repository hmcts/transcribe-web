import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserAccountsPanel } from "@/components/admin/user-accounts-panel";
import type { MeResponse } from "@/lib/access/types";
import type { AdminUser, RoleHistoryEntry } from "@/lib/admin-users-api";
import { apiClient } from "@/lib/api-client";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { ET_REF, IAC_REF, ME } from "../access-helpers";

// DIAAT-406: Admin > User accounts, the super administrator's. Every account,
// deactivated or reactivated (never one's own), with each person's role history
// across all jurisdictions.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let persona: MeResponse = ME.jurisdictionSuperAdministrator;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);

import { toast } from "sonner";

const request = vi.mocked(apiClient.request);

const user = (
  over: Partial<AdminUser> & Pick<AdminUser, "id" | "email">
): AdminUser => ({
  name: null,
  is_active: true,
  pending: false,
  assignments: [],
  ...over,
});

const ADMIN = user({
  id: "u-admin",
  email: "admin@example.test",
  name: "An Administrator",
  assignments: [
    { id: "a-1", jurisdiction: IAC_REF, role: "JurisdictionAdministrator" },
  ],
});
const MANY = user({ id: "u-many", email: "many@example.test" });
const GONE = user({
  id: "u-gone",
  email: "gone@example.test",
  is_active: false,
});
const LATER = user({ id: "p-1", email: "later@example.test", pending: true });
const SELF = user({ id: "u-1", email: "someone@localhost.test" });

const HISTORY: RoleHistoryEntry[] = [
  {
    id: "h-1",
    timestamp: "2026-11-02T10:30:00Z",
    actor: { id: "u-x", email: "boss@example.test" },
    actor_context: { jurisdiction: "ET", role: "JurisdictionAdministrator" },
    target: { id: "u-many", email: "many@example.test" },
    change: "assignment.added",
    jurisdiction: "ET",
    role: "Judge",
  },
  {
    id: "h-2",
    timestamp: "2026-11-01T10:30:00Z",
    actor: { id: "u-y", email: "other@example.test" },
    actor_context: { jurisdiction: "IAC", role: "JurisdictionAdministrator" },
    target: { id: "u-many", email: "many@example.test" },
    change: "assignment.added",
    jurisdiction: "IAC",
    role: "LegalTextManager",
  },
];

function serve(users: AdminUser[] = [ADMIN, MANY, GONE, LATER, SELF]) {
  let state = users;
  request.mockImplementation(
    async (endpoint: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      const [path, query = ""] = endpoint.split("?");
      const params = new URLSearchParams(query);
      if (path === "/admin/users" && method === "GET") {
        const search = (params.get("search") ?? "").toLowerCase();
        const rows = state.filter((u) => u.email.includes(search));
        return {
          data: { items: rows, total: rows.length, page: 1, page_size: 25 },
        };
      }
      const toggle = path.match(
        /^\/admin\/users\/([^/]+)\/(deactivate|reactivate)$/
      );
      if (toggle && method === "POST") {
        state = state.map((u) =>
          u.id === toggle[1]
            ? { ...u, is_active: toggle[2] === "reactivate" }
            : u
        );
        return { data: undefined, status: 204 };
      }
      if (path === "/admin/role-history") {
        const who = params.get("user");
        const items = HISTORY.filter((e) => !who || e.target?.id === who);
        return { data: { items, total: items.length } };
      }
      return { error: `unexpected ${method} ${endpoint}`, status: 500 };
    }
  );
}

const calls = (method: string, path: string) =>
  request.mock.calls.filter(
    ([endpoint, o]) =>
      (o?.method ?? "GET") === method && String(endpoint).split("?")[0] === path
  );

beforeEach(() => {
  persona = ME.jurisdictionSuperAdministrator;
  request.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("user accounts (DIAAT-406)", () => {
  it("lists every account with its state, whatever its roles", async () => {
    serve();
    render(<UserAccountsPanel />);

    expect(await screen.findByText("admin@example.test")).toBeTruthy();
    expect(screen.getByText("An Administrator")).toBeTruthy();
    expect(screen.getByText("Deactivated")).toBeTruthy();
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
    expect(screen.getAllByText("Active").length).toBe(3);
  });

  it("searches by email", async () => {
    serve();
    const u = userEvent.setup();
    render(<UserAccountsPanel />);
    await screen.findByText("admin@example.test");

    await u.type(screen.getByLabelText("Search by email"), "many");

    await waitFor(() =>
      expect(screen.queryByText("admin@example.test")).toBeNull()
    );
    expect(screen.getByText("many@example.test")).toBeTruthy();
    expect(
      request.mock.calls.some(([e]) => String(e).includes("search=many"))
    ).toBe(true);
  });

  it("deactivates an administrator only once confirmed, and reactivates at once", async () => {
    serve();
    const u = userEvent.setup();
    render(<UserAccountsPanel />);

    await u.click(
      await screen.findByRole("button", {
        name: "Deactivate admin@example.test",
      })
    );
    expect(calls("POST", "/admin/users/u-admin/deactivate")).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: "Confirm deactivate" }));
    await waitFor(() =>
      expect(calls("POST", "/admin/users/u-admin/deactivate")).toHaveLength(1)
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Deactivated admin@example.test"
    );

    await u.click(
      await screen.findByRole("button", {
        name: "Reactivate gone@example.test",
      })
    );
    await waitFor(() =>
      expect(calls("POST", "/admin/users/u-gone/reactivate")).toHaveLength(1)
    );
  });

  it("holds a context switch while a change is in flight, then shows the list as searched meanwhile", async () => {
    serve();
    const served = request.getMockImplementation();
    if (!served) throw new Error("serve() sets an implementation");
    let finish: () => void = () => undefined;
    request.mockImplementation(
      async (endpoint: string, options?: RequestInit) => {
        if ((options?.method ?? "GET") === "POST") {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
        return served(endpoint, options);
      }
    );
    const u = userEvent.setup();
    render(<UserAccountsPanel />);

    await u.click(
      await screen.findByRole("button", {
        name: "Reactivate gone@example.test",
      })
    );
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });

    await u.type(screen.getByLabelText("Search by email"), "many");
    await waitFor(() =>
      expect(screen.queryByText("admin@example.test")).toBeNull()
    );
    finish();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Reactivated gone@example.test"
      )
    );
    await waitFor(() =>
      expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined()
    );
    const lastList = calls("GET", "/admin/users").at(-1)?.[0];
    expect(String(lastList)).toContain("search=many");
    expect(screen.queryByText("admin@example.test")).toBeNull();
    expect(screen.getByText("many@example.test")).toBeTruthy();
  });

  it("can call a deactivation off", async () => {
    serve();
    const u = userEvent.setup();
    render(<UserAccountsPanel />);

    await u.click(
      await screen.findByRole("button", {
        name: "Deactivate many@example.test",
      })
    );
    await u.click(screen.getByRole("button", { name: "Keep" }));

    expect(
      screen.queryByRole("button", { name: "Confirm deactivate" })
    ).toBeNull();
    expect(calls("POST", "/admin/users/u-many/deactivate")).toHaveLength(0);
  });

  it("offers no deactivation of your own account, nor of one not signed in yet", async () => {
    serve();
    render(<UserAccountsPanel />);
    await screen.findByText("someone@localhost.test");

    expect(
      screen.queryByRole("button", {
        name: "Deactivate someone@localhost.test",
      })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Deactivate later@example.test" })
    ).toBeNull();
  });

  it("shows the API's reason when a deactivation is refused", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      String(endpoint).endsWith("/deactivate")
        ? {
            error: "You cannot deactivate yourself",
            status: 403,
            code: "cannot_deactivate_self",
          }
        : base(endpoint, options)
    );
    const u = userEvent.setup();
    render(<UserAccountsPanel />);

    await u.click(
      await screen.findByRole("button", {
        name: "Deactivate many@example.test",
      })
    );
    await u.click(screen.getByRole("button", { name: "Confirm deactivate" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You cannot deactivate yourself")
    );
  });

  it("shows one person's role history across all jurisdictions, and goes back", async () => {
    serve();
    const u = userEvent.setup();
    render(<UserAccountsPanel />);

    await u.click(
      await screen.findByRole("button", {
        name: "Role history of many@example.test",
      })
    );

    expect(
      await screen.findByRole("heading", {
        name: "Role change history of many@example.test",
      })
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([e]) =>
            String(e).startsWith("/admin/role-history?") &&
            String(e).includes("user=u-many")
        )
      ).toBe(true)
    );
    const table = await screen.findByRole("table");
    expect(within(table).getByText(ET_REF.code)).toBeTruthy();
    expect(within(table).getByText(IAC_REF.code)).toBeTruthy();

    await u.click(
      screen.getByRole("button", { name: "Back to user accounts" })
    );
    expect(await screen.findByText("admin@example.test")).toBeTruthy();
  });

  it("offers no role history without role_audit.read", async () => {
    persona = {
      ...ME.jurisdictionSuperAdministrator,
      permissions: ME.jurisdictionSuperAdministrator.permissions.filter(
        (p) => p !== "role_audit.read"
      ),
    };
    serve();
    render(<UserAccountsPanel />);
    await screen.findByText("admin@example.test");

    expect(
      screen.queryByRole("button", { name: /Role history of/ })
    ).toBeNull();
  });
});
