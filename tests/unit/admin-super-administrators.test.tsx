import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperAdministratorsPanel } from "@/components/admin/super-administrators-panel";
import type { MeResponse } from "@/lib/access/types";
import type { AdminUser } from "@/lib/admin-users-api";
import { apiClient } from "@/lib/api-client";
import { ME } from "../access-helpers";

// DIAAT-385, DIAAT-394: the screen where a system administrator assigns and
// removes the global super administrator role, including to themselves.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let persona: MeResponse = ME.sysadminOnly;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);

import { toast } from "sonner";

const request = vi.mocked(apiClient.request);

const SUPER = "JurisdictionSuperAdministrator";
const holder = (id: string, email: string, assignmentId: string): AdminUser => ({
  id,
  email,
  name: null,
  is_active: true,
  pending: false,
  can_set_active: true,
  assignments: [{ id: assignmentId, jurisdiction: null, role: SUPER }],
});

function serve(initial: AdminUser[] = [holder("u-9", "chief@example.test", "as-9")]) {
  let holders = [...initial];
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    const [path] = endpoint.split("?");
    if (path === "/admin/users" && method === "GET") {
      return { data: { items: holders, total: holders.length, page: 1, page_size: 100 } };
    }
    if (path === "/admin/assignments" && method === "POST") {
      const body = JSON.parse(String(options?.body));
      holders = [
        ...holders,
        holder(body.user_id ?? "u-new", body.email ?? "someone@localhost.test", `as-${holders.length + 10}`),
      ];
      return { data: { id: "new", jurisdiction: null, role: SUPER }, status: 201 };
    }
    if (path.startsWith("/admin/assignments/") && method === "DELETE") {
      const id = path.split("/").pop();
      holders = holders.filter((h) => h.assignments[0].id !== id);
      return { data: undefined, status: 204 };
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  });
}

beforeEach(() => {
  persona = ME.sysadminOnly;
  request.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Super administrators", () => {
  it("lists who holds the role, asking the API for that role and no jurisdiction", async () => {
    serve();
    render(<SuperAdministratorsPanel />);

    expect(await screen.findByText("chief@example.test")).toBeTruthy();
    const call = request.mock.calls.find(([e]) => String(e).startsWith("/admin/users"));
    const params = new URLSearchParams(String(call?.[0]).split("?")[1]);
    expect(params.get("role")).toBe(SUPER);
    expect(params.has("jurisdiction")).toBe(false);
  });

  it("keeps only the holders of that role, whatever else the API sent", async () => {
    serve([
      holder("u-9", "chief@example.test", "as-9"),
      {
        id: "u-8",
        email: "judge@example.test",
        name: null,
        is_active: true,
        pending: false,
        can_set_active: true,
        assignments: [{ id: "as-8", jurisdiction: { code: "ET", name: "Employment Tribunal" }, role: "Judge" }],
      },
    ]);
    render(<SuperAdministratorsPanel />);

    expect(await screen.findByText("chief@example.test")).toBeTruthy();
    expect(screen.queryByText("judge@example.test")).toBeNull();
  });

  it("adds a super administrator by email, with no jurisdiction", async () => {
    serve();
    const user = userEvent.setup();
    render(<SuperAdministratorsPanel />);

    await user.type(await screen.findByLabelText("Sign-in email"), "New@Example.test");
    await user.click(screen.getByRole("button", { name: "Add super administrator" }));

    expect(await screen.findByText("new@example.test")).toBeTruthy();
    const post = request.mock.calls.find(([e]) => e === "/admin/assignments");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      user_id: null,
      email: "new@example.test",
      jurisdiction: null,
      role: SUPER,
    });
    expect(toast.success).toHaveBeenCalledWith("new@example.test is now a super administrator");
  });

  it("lets the person using the screen add themselves", async () => {
    serve([]);
    const user = userEvent.setup();
    render(<SuperAdministratorsPanel />);

    await user.click(await screen.findByRole("button", { name: "Add me" }));

    const post = await waitFor(() => {
      const found = request.mock.calls.find(([e]) => e === "/admin/assignments");
      expect(found).toBeTruthy();
      return found;
    });
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      user_id: "u-1",
      email: null,
      jurisdiction: null,
      role: SUPER,
    });
    expect(await screen.findByText("(you)")).toBeTruthy();
  });

  it("removes one after a deliberate second click, including oneself", async () => {
    serve([holder("u-1", "someone@localhost.test", "as-1"), holder("u-9", "chief@example.test", "as-9")]);
    const user = userEvent.setup();
    render(<SuperAdministratorsPanel />);

    await user.click(await screen.findByRole("button", { name: "Remove someone@localhost.test as a super administrator" }));
    expect(request.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(screen.queryByText(/someone@localhost.test/)).toBeNull());
    expect(request).toHaveBeenCalledWith("/admin/assignments/as-1", { method: "DELETE" });
    expect(screen.getByText("chief@example.test")).toBeTruthy();
  });

  it("shows the API's reason when it refuses", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      endpoint === "/admin/assignments"
        ? { error: "You cannot give that role", status: 403, code: "assignment_not_allowed" }
        : base(endpoint, options)
    );
    const user = userEvent.setup();
    render(<SuperAdministratorsPanel />);

    await user.type(await screen.findByLabelText("Sign-in email"), "x@example.test");
    await user.click(screen.getByRole("button", { name: "Add super administrator" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot give that role"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("never shows a system administrator, in the list or the copy", async () => {
    serve();
    const { container } = render(<SuperAdministratorsPanel />);
    await screen.findByText("chief@example.test");
    const region = screen.getByRole("region", { name: "Who can manage every jurisdiction" });
    expect(within(region).getAllByRole("row")).toHaveLength(2); // header and one holder
    expect(container.textContent).not.toMatch(/system ?administrator|sysadmin/i);
  });
});
