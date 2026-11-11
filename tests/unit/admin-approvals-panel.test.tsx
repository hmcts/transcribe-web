import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
import { ApprovalsPanel } from "@/components/admin/approvals-panel";
import type { MeResponse } from "@/lib/access/types";
import type { PendingAccessRequest } from "@/lib/admin-access-requests-api";
import { apiClient } from "@/lib/api-client";
import { jurisdictionContextValue } from "@/lib/jurisdiction-context";
import { DT } from "../jurisdiction-helpers";
import { ET_REF, IAC_REF, ME } from "../access-helpers";

// DIAAT-396, DIAAT-398: the approvals queue, and the link in the approvers' email
// (`/admin?tab=approvals&request=<id>`) that opens it on one request.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let persona: MeResponse = ME.jurisdictionAdministrator;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => jurisdictionContextValue(DT),
}));
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

import { toast } from "sonner";

const request = vi.mocked(apiClient.request);

const wanted = (
  id: string,
  email: string,
  jurisdiction = IAC_REF,
  roles = ["Judge"]
): PendingAccessRequest => ({
  id,
  jurisdiction,
  roles,
  status: "pending",
  created_at: "2026-11-03T09:00:00Z",
  decided_at: null,
  reason: null,
  requester: { id: `u-${id}`, email, name: null },
});
const R1 = wanted("r-1", "one@example.test");
const R2 = wanted("r-2", "two@example.test", ET_REF, ["Judge", "LegalTextManager"]);

function serve(initial: PendingAccessRequest[] = [R1, R2]) {
  let queue = [...initial];
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (endpoint === "/admin/access-requests?status=pending") return { data: queue };
    const decision = endpoint.match(/^\/admin\/access-requests\/([^/]+)\/(approve|reject)$/);
    if (decision && method === "POST") {
      queue = queue.filter((r) => r.id !== decision[1]);
      return { data: { ...R1, id: decision[1], status: decision[2] === "approve" ? "approved" : "rejected" } };
    }
    // The Admin page's other panels (the Jurisdictions tab stays mounted, DIAAT-344).
    if (endpoint === "/admin/jurisdictions/wording-keys") return { data: { keys: {} } };
    return { data: [] };
  });
}

beforeEach(() => {
  persona = ME.jurisdictionAdministrator;
  search = "";
  request.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the approvals queue", () => {
  it("lists the pending requests the API returns, with who asked, where and for which roles", async () => {
    serve();
    render(<ApprovalsPanel />);

    const list = await screen.findByRole("list", { name: "Requests waiting for a decision" });
    const first = within(list).getAllByRole("listitem")[0];
    expect(within(first).getByText("one@example.test")).toBeTruthy();
    expect(within(first).getByText("Immigration and Asylum Chamber")).toBeTruthy();
    expect(within(first).getByText("Judge")).toBeTruthy();
    const second = within(list).getAllByRole("listitem")[1];
    expect(within(second).getByText("Legal text manager")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("/admin/access-requests?status=pending", expect.anything());
  });

  it("approves with a reason, and the request leaves the queue", async () => {
    serve();
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await user.type(await screen.findAllByLabelText("Reason (optional)").then((l) => l[0]), "Known to us");
    await user.click(screen.getByRole("button", { name: "Approve the request from one@example.test" }));

    await waitFor(() => expect(screen.queryByText("one@example.test")).toBeNull());
    const post = request.mock.calls.find(([e]) => e === "/admin/access-requests/r-1/approve");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ reason: "Known to us" });
    expect(toast.success).toHaveBeenCalledWith("Approved the request from one@example.test");
    expect(screen.getByText("two@example.test")).toBeTruthy();
  });

  it("rejects without a reason, which is sent as null", async () => {
    serve();
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await user.click(await screen.findByRole("button", { name: "Reject the request from two@example.test" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rejected the request from two@example.test"));
    const post = request.mock.calls.find(([e]) => e === "/admin/access-requests/r-2/reject");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ reason: null });
  });

  it("keeps the request and shows the API's reason when the decision is refused", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      options?.method === "POST"
        ? { error: "That request has already been decided", status: 409 }
        : base(endpoint, options)
    );
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await user.click(await screen.findByRole("button", { name: "Approve the request from one@example.test" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That request has already been decided"));
    expect(screen.getByText("one@example.test")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says when nothing is waiting, and offers a retry when the queue cannot be loaded", async () => {
    serve([]);
    const { unmount } = render(<ApprovalsPanel />);
    expect(await screen.findByText("No requests are waiting.")).toBeTruthy();
    unmount();

    request.mockResolvedValueOnce({ error: "Needs access.approve", status: 403 });
    const user = userEvent.setup();
    render(<ApprovalsPanel />);
    expect(await screen.findByText("Needs access.approve")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No requests are waiting.")).toBeTruthy();
  });
});

describe("the API's newer refusals (own_request, jurisdiction_disabled)", () => {
  // The signed-in fixture user is u-1 (tests/access-helpers.ts).
  const OWN: PendingAccessRequest = {
    ...wanted("r-own", "someone@localhost.test"),
    requester: { id: "u-1", email: "someone@localhost.test", name: null },
  };

  it("offers no Approve or Reject on the caller's own request, and says why; others keep theirs", async () => {
    serve([OWN, R1]);
    render(<ApprovalsPanel />);

    const own = (await screen.findByText("someone@localhost.test")).closest("li") as HTMLElement;
    expect(within(own).getByText("This is your own request. Another administrator has to decide it.")).toBeTruthy();
    expect(within(own).queryByRole("button")).toBeNull();
    expect(within(own).queryByLabelText("Reason (optional)")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve the request from one@example.test" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /someone@localhost.test/ })).toBeNull();
  });

  it("shows plain words when the API still answers 403 own_request (the user list was not current)", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      options?.method === "POST"
        ? { error: "You cannot decide your own access request.", status: 403, code: "own_request" }
        : base(endpoint, options)
    );
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await user.click(await screen.findByRole("button", { name: "Approve the request from one@example.test" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This is your own request. Another administrator has to decide it.")
    );
    expect(screen.getByText("one@example.test")).toBeTruthy();
  });

  it("says the jurisdiction is switched off when approving into a disabled one, and keeps the request to reject", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      options?.method === "POST" && endpoint.endsWith("/approve")
        ? { error: "That jurisdiction is disabled: nobody can be given a role there.", status: 409, code: "jurisdiction_disabled" }
        : base(endpoint, options)
    );
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await user.click(await screen.findByRole("button", { name: "Approve the request from one@example.test" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("switched off"))
    );
    expect(screen.getByRole("button", { name: "Reject the request from one@example.test" })).toBeTruthy();
  });
});

describe("the deep link /admin?tab=approvals&request=<id> (DIAAT-398)", () => {
  it("highlights that request in the queue, and only that one", async () => {
    serve();
    render(<ApprovalsPanel highlightRequestId="r-2" />);

    const second = (await screen.findByText("two@example.test")).closest("li") as HTMLElement;
    const first = screen.getByText("one@example.test").closest("li") as HTMLElement;
    expect(second.getAttribute("data-highlighted")).toBe("true");
    expect(second.getAttribute("aria-current")).toBe("true");
    expect(first.getAttribute("data-highlighted")).toBeNull();
    expect(first.getAttribute("aria-current")).toBeNull();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.queryByText(/not waiting for your decision/)).toBeNull();
  });

  it("says so, and highlights nothing, when the request is not in the caller's queue", async () => {
    serve();
    render(<ApprovalsPanel highlightRequestId="r-unknown" />);

    expect(await screen.findByText(/That request is not waiting for your decision/)).toBeTruthy();
    expect(document.querySelector("[data-highlighted]")).toBeNull();
    // It does not say whether such a request exists.
    expect(screen.queryByText(/r-unknown/)).toBeNull();
  });

  it("says what was decided, not that the request is missing, once the linked request is decided here", async () => {
    serve();
    const user = userEvent.setup();
    render(<ApprovalsPanel highlightRequestId="r-1" />);

    await user.click(await screen.findByRole("button", { name: "Approve the request from one@example.test" }));

    expect(await screen.findByText("You approved that request.")).toBeTruthy();
    expect(screen.queryByText(/not waiting for your decision/)).toBeNull();
  });

  it("opens the Approvals tab on the Admin page, and highlights the request", async () => {
    serve();
    search = "tab=approvals&request=r-1";
    render(<AdminPage />);

    const item = (await screen.findByText("one@example.test")).closest("li") as HTMLElement;
    expect(item.getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByRole("tab", { name: /Approvals/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the first tab the caller has when the link names one they do not", async () => {
    persona = ME.legalTextManager; // no access.approve: no Approvals tab
    serve();
    search = "tab=approvals&request=r-1";
    render(<AdminPage />);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).not.toContain("Approvals");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining("access-requests"), expect.anything());
  });

  it("carries only the request id: the page asks the API for the queue and trusts nothing else in the link", async () => {
    serve();
    search = "tab=approvals&request=r-1&jurisdiction=IAC&role=Judge&approve=1";
    render(<AdminPage />);

    await screen.findByText("one@example.test");
    expect(request.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(0);
    expect(request).toHaveBeenCalledWith("/admin/access-requests?status=pending", expect.anything());
  });
});
