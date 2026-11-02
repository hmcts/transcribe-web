import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout";
import { getAdminAccessStatus } from "@/lib/admin-access";
import { jurisdictionContextValue, NEUTRAL } from "@/lib/jurisdiction-context";
import { DT, ET } from "../jurisdiction-helpers";

// DIAAT-342: the admin area is open to those with an admin app role, and to an
// admin of the jurisdiction they work in when it has legal wording to edit.

let mockContext = NEUTRAL;
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => mockContext,
}));
vi.mock("@/lib/admin-access", () => ({ getAdminAccessStatus: vi.fn() }));

const access = vi.mocked(getAdminAccessStatus);
const inJurisdiction = (base: typeof DT, role: "admin" | "judge") =>
  jurisdictionContextValue({ ...base, role }, [{ ...base, role }]);

function renderLayout() {
  return render(
    <AdminLayout>
      <p>Admin content</p>
    </AdminLayout>
  );
}

describe("AdminLayout access", () => {
  beforeEach(() => {
    access.mockReset();
    mockContext = NEUTRAL;
  });

  it("admits an admin app role, as before", async () => {
    access.mockResolvedValue("authorised");
    mockContext = inJurisdiction(DT, "judge");
    renderLayout();

    expect(await screen.findByText("Admin content")).toBeTruthy();
  });

  it("admits an admin of the jurisdiction with legal wording who holds no admin app role", async () => {
    access.mockResolvedValue("forbidden");
    mockContext = inJurisdiction(DT, "admin");
    renderLayout();

    expect(await screen.findByText("Admin content")).toBeTruthy();
  });

  it("does not admit a judge of that jurisdiction", async () => {
    access.mockResolvedValue("forbidden");
    mockContext = inJurisdiction(DT, "judge");
    renderLayout();

    expect(await screen.findByText("Access Denied")).toBeTruthy();
    expect(screen.queryByText("Admin content")).toBeNull();
  });

  it("does not admit an admin of a jurisdiction that has no legal wording", async () => {
    access.mockResolvedValue("forbidden");
    mockContext = inJurisdiction(ET, "admin");
    renderLayout();

    expect(await screen.findByText("Access Denied")).toBeTruthy();
  });

  it("waits for the jurisdiction before refusing", async () => {
    access.mockResolvedValue("forbidden");
    mockContext = NEUTRAL; // not loaded yet
    renderLayout();
    await vi.waitFor(() => expect(access).toHaveBeenCalled());

    expect(screen.getByText(/Verifying admin access/)).toBeTruthy();
    expect(screen.queryByText("Access Denied")).toBeNull();
  });

  it("refuses someone with no jurisdiction and no admin app role", async () => {
    access.mockResolvedValue("forbidden");
    mockContext = jurisdictionContextValue(null);
    renderLayout();

    expect(await screen.findByText("Access Denied")).toBeTruthy();
  });
});
