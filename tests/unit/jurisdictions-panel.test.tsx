import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JurisdictionsPanel } from "@/components/admin/jurisdictions-panel";
import {
  IAC_ADMIN_JURISDICTION,
  TAX_ADMIN_JURISDICTION,
} from "./helpers/document-content";

const api = vi.hoisted(() => ({
  fetchAdminJurisdictions: vi.fn(),
  createJurisdiction: vi.fn(),
  fetchJurisdictionAdmins: vi.fn(),
  addJurisdictionAdmin: vi.fn(),
  removeJurisdictionAdmin: vi.fn(),
}));
const mockFetchAdminUsers = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  ...api,
}));

vi.mock("@/lib/admin-users-api", () => ({
  fetchAdminUsers: mockFetchAdminUsers,
}));

// Radix Select cannot be driven from jsdom; a native select keeps the same contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      aria-label="Administrators of"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}));

const ADMIN = { user_id: "u1", email: "ltm@x.test", role: "LegalTextManager" };
const CANDIDATE = {
  id: "u2",
  email: "new@x.test",
  role: "LegalTextManager",
  has_completed_onboarding: true,
  created_datetime: "2025-01-01T00:00:00Z",
};

beforeEach(() => {
  api.fetchAdminJurisdictions.mockResolvedValue([
    IAC_ADMIN_JURISDICTION,
    TAX_ADMIN_JURISDICTION,
  ]);
  api.fetchJurisdictionAdmins.mockResolvedValue([ADMIN]);
  mockFetchAdminUsers.mockResolvedValue({ items: [CANDIDATE], total: 1 });
});

describe("Jurisdictions panel: create", () => {
  it("creates a jurisdiction and opens it", async () => {
    api.createJurisdiction.mockResolvedValue({
      id: "emp",
      name: "Employment Tribunal",
      has_legal_wording: false,
    });
    render(<JurisdictionsPanel />);
    await screen.findByLabelText("Administrators of");

    fireEvent.change(screen.getByLabelText("ID"), { target: { value: "emp" } });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Employment Tribunal" },
    });
    api.fetchAdminJurisdictions.mockResolvedValue([
      IAC_ADMIN_JURISDICTION,
      { ...TAX_ADMIN_JURISDICTION, id: "emp", name: "Employment Tribunal" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: /create jurisdiction/i })
    );

    await waitFor(() =>
      expect(api.createJurisdiction).toHaveBeenCalledWith({
        id: "emp",
        name: "Employment Tribunal",
      })
    );
    await waitFor(() =>
      expect(api.fetchJurisdictionAdmins).toHaveBeenLastCalledWith("emp")
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Created "Employment Tribunal"'
    );
  });

  it("rejects an id the API would refuse without calling it", async () => {
    render(<JurisdictionsPanel />);
    await screen.findByLabelText("Administrators of");

    fireEvent.change(screen.getByLabelText("ID"), {
      target: { value: "Bad Id" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.click(
      screen.getByRole("button", { name: /create jurisdiction/i })
    );

    expect(api.createJurisdiction).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("lowercase letters")
    );
  });

  it("shows the API's message when the id or name is taken", async () => {
    api.createJurisdiction.mockRejectedValue(
      new Error("A jurisdiction with this id or name already exists")
    );
    render(<JurisdictionsPanel />);
    await screen.findByLabelText("Administrators of");

    fireEvent.change(screen.getByLabelText("ID"), { target: { value: "tax" } });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Tax Tribunal" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create jurisdiction/i })
    );

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "A jurisdiction with this id or name already exists"
      )
    );
  });
});

describe("Jurisdictions panel: administrators", () => {
  it("lists the selected jurisdiction's administrators", async () => {
    render(<JurisdictionsPanel />);

    expect(await screen.findByText("ltm@x.test")).toBeTruthy();
    expect(api.fetchJurisdictionAdmins).toHaveBeenCalledWith("iac");
  });

  it("shows each jurisdiction's own administrators when switching", async () => {
    render(<JurisdictionsPanel />);
    await screen.findByText("ltm@x.test");
    api.fetchJurisdictionAdmins.mockResolvedValue([]);

    fireEvent.change(screen.getByLabelText("Administrators of"), {
      target: { value: "tax" },
    });

    expect(await screen.findByText("No administrators yet.")).toBeTruthy();
    expect(screen.queryByText("ltm@x.test")).toBeNull();
    expect(api.fetchJurisdictionAdmins).toHaveBeenLastCalledWith("tax");
  });

  it("finds a user by email and assigns them", async () => {
    api.addJurisdictionAdmin.mockResolvedValue({
      user_id: "u2",
      email: "new@x.test",
      role: "LegalTextManager",
    });
    render(<JurisdictionsPanel />);
    await screen.findByText("ltm@x.test");

    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "new@" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const result = (await screen.findByText("new@x.test")).closest("li");
    fireEvent.click(
      within(result as HTMLElement).getByRole("button", { name: "Assign" })
    );

    await waitFor(() =>
      expect(api.addJurisdictionAdmin).toHaveBeenCalledWith("iac", "u2")
    );
    expect(mockFetchAdminUsers).toHaveBeenCalledWith(1, 5, "new@");
    expect(api.fetchJurisdictionAdmins).toHaveBeenCalledTimes(2);
  });

  it("does not offer to assign someone who is already an administrator", async () => {
    mockFetchAdminUsers.mockResolvedValue({
      items: [{ ...CANDIDATE, id: "u1", email: "ltm@x.test" }],
      total: 1,
    });
    render(<JurisdictionsPanel />);
    await screen.findByText("ltm@x.test");

    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "ltm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const assigned = await screen.findByRole("button", { name: "Assigned" });
    expect((assigned as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes an administrator", async () => {
    api.removeJurisdictionAdmin.mockResolvedValue(undefined);
    render(<JurisdictionsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove ltm@x.test" })
    );

    await waitFor(() =>
      expect(api.removeJurisdictionAdmin).toHaveBeenCalledWith("iac", "u1")
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("Removed ltm@x.test");
  });

  it("reports a failed removal", async () => {
    api.removeJurisdictionAdmin.mockRejectedValue(
      new Error("User is not an admin of this jurisdiction")
    );
    render(<JurisdictionsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove ltm@x.test" })
    );

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "User is not an admin of this jurisdiction"
      )
    );
  });
});

describe("Jurisdictions panel: overlapping refreshes", () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const adminB = { user_id: "u2", email: "b@x.test", role: "LegalTextManager" };

  it("keeps the newest list when an older refresh arrives last", async () => {
    api.fetchJurisdictionAdmins.mockResolvedValue([ADMIN, adminB]);
    api.removeJurisdictionAdmin.mockResolvedValue(undefined);
    render(<JurisdictionsPanel />);
    await screen.findByText("b@x.test");

    // Refresh after removing A (still lists B) and after removing B (empty).
    const afterRemovingA = deferred<(typeof ADMIN)[]>();
    const afterRemovingB = deferred<(typeof ADMIN)[]>();
    api.fetchJurisdictionAdmins
      .mockReturnValueOnce(afterRemovingA.promise)
      .mockReturnValueOnce(afterRemovingB.promise);
    fireEvent.click(screen.getByRole("button", { name: "Remove ltm@x.test" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove b@x.test" }));
    await waitFor(() =>
      expect(api.removeJurisdictionAdmin).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(api.fetchJurisdictionAdmins).toHaveBeenCalledTimes(3)
    );

    // The newer refresh lands first, the older one last.
    await act(async () => afterRemovingB.resolve([]));
    await act(async () => afterRemovingA.resolve([adminB]));

    expect(await screen.findByText("No administrators yet.")).toBeTruthy();
    expect(screen.queryByText("b@x.test")).toBeNull();
  });

  it("ignores a late response after the jurisdiction changes", async () => {
    const slowIac = deferred<(typeof ADMIN)[]>();
    api.fetchJurisdictionAdmins.mockReturnValueOnce(slowIac.promise);
    render(<JurisdictionsPanel />);
    const picker = await screen.findByLabelText("Administrators of");
    api.fetchJurisdictionAdmins.mockResolvedValueOnce([adminB]);

    fireEvent.change(picker, { target: { value: "tax" } });
    expect(await screen.findByText("b@x.test")).toBeTruthy();
    await act(async () => slowIac.resolve([ADMIN]));

    expect(screen.queryByText("ltm@x.test")).toBeNull();
    expect(screen.getByText("b@x.test")).toBeTruthy();
  });
});
