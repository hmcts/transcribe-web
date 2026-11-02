import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
import { apiClient } from "@/lib/api-client";
import { jurisdictionContextValue, NEUTRAL } from "@/lib/jurisdiction-context";
import { DT, IAC } from "../jurisdiction-helpers";

// DIAAT-342: the admin area edits the legal wording of the jurisdiction the tab
// works in, says which, and explains each refusal.

let mockContext = jurisdictionContextValue({ ...DT, role: "admin" });
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => mockContext,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
vi.mock("@/lib/admin-access", () => ({
  getAdminRole: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/components/admin/jurisdictions-panel", () => ({
  JurisdictionsPanel: () => <div>Jurisdictions panel</div>,
}));
vi.mock("@/components/editor/admin-editor", () => ({
  AdminEditor: ({ value }: { value: string }) => <div>{value}</div>,
}));

import { toast } from "sonner";
import { getAdminRole } from "@/lib/admin-access";

const request = vi.mocked(apiClient.request);

// The sidebar asks whether the screen is a phone's.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const framework = (id: string, title: string, rank: number) => ({
  id,
  title,
  rank,
  content: `${title} text`,
  issues: [],
});
const wording = (overrides: Record<string, unknown> = {}) => ({
  jurisdiction: { code: "DT", name: "Decision Tribunal" },
  has_legal_wording: true,
  hearing_types: [
    {
      id: "face_to_face",
      title: "Face to face",
      hearing_title: "Hearing",
      hearing_description: "In person",
    },
  ],
  legal_frameworks: [framework("credibility", "Credibility", 1)],
  anonymity: { statuses: [] },
  ...overrides,
});

const asDt = (role: "admin" | "judge" = "admin") =>
  jurisdictionContextValue({ ...DT, role }, [{ ...DT, role }]);

function respondWith(body: unknown) {
  request.mockImplementation(async () => ({ data: body, status: 200 }));
}

describe("Admin area: legal wording of the active jurisdiction (DIAAT-342)", () => {
  beforeEach(() => {
    mockContext = asDt();
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(getAdminRole).mockResolvedValue(null);
  });

  it("shows which jurisdiction is being edited, and loads only that one's wording", async () => {
    respondWith(wording());
    render(<AdminPage />);

    const banner = await screen.findByText(/Editing the legal wording of/);
    expect(banner.textContent).toContain("Decision Tribunal (DT)");
    expect(screen.getByText("Credibility")).toBeTruthy();
    // One read, of the one route; the tab's jurisdiction travels as its header.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/admin/document-content", undefined);
    expect(screen.queryByText(/has no legal frameworks yet/)).toBeNull();
  });

  it("explains a jurisdiction with no legal frameworks, and that adding one turns them on", async () => {
    respondWith(wording({ has_legal_wording: false, legal_frameworks: [] }));
    render(<AdminPage />);

    expect(
      await screen.findByText(/Decision Tribunal has no legal frameworks yet/)
    ).toBeTruthy();
    expect(
      screen.getByText(/Judges are not asked for legal issues/)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add framework/ })).toBeTruthy();
  });

  it("warns that deleting the last legal framework removes legal issues for judges", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(
      await screen.findByRole("button", { name: "Credibility" })
    );
    await user.click(await screen.findByRole("button", { name: /Delete/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/last legal framework of Decision Tribunal/)
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/no longer asked for legal issues/)
    ).toBeTruthy();
  });

  it("does not warn when other legal frameworks remain", async () => {
    respondWith(
      wording({
        legal_frameworks: [
          framework("credibility", "Credibility", 1),
          framework("devaseelan", "Devaseelan", 2),
        ],
      })
    );
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(
      await screen.findByRole("button", { name: "Credibility" })
    );
    await user.click(await screen.findByRole("button", { name: /Delete/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/last legal framework/)).toBeNull();
  });

  it("saves to the same route as before", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(
      await screen.findByRole("button", { name: "Face to face" })
    );
    request.mockClear();
    request.mockImplementation(
      async (_endpoint: string, options?: RequestInit) =>
        options?.method === "PUT"
          ? { data: wording().hearing_types[0], status: 200 }
          : { data: wording(), status: 200 }
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      "/admin/document-content/hearing-types/face_to_face",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it.each([
    [
      "jurisdiction_not_available",
      403,
      "You do not belong to Decision Tribunal, or it is not available to you.",
    ],
    [
      "jurisdiction_admin_required",
      403,
      "Only an admin for Decision Tribunal can change its legal wording.",
    ],
    ["no_jurisdiction", 403, "You have not been added to a jurisdiction"],
    [
      "jurisdiction_choice_required",
      409,
      "Choose the jurisdiction you are working in",
    ],
  ])("explains %s, without offering a retry", async (code, status, text) => {
    request.mockResolvedValue({ error: "raw message", status, code });
    render(<AdminPage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(new RegExp(text))).toBeTruthy();
    expect(within(alert).queryByText("raw message")).toBeNull();
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/Editing the legal wording/)).toBeNull();
  });

  it("explains a jurisdiction without the decision template", async () => {
    request.mockResolvedValue({
      error: "Not available in this jurisdiction",
      status: 404,
    });
    render(<AdminPage />);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "Decision Tribunal does not use the decision document, so it has no legal wording to edit."
      )
    ).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers a retry for a failure that trying again could fix", async () => {
    request.mockResolvedValueOnce({
      error: "HTTP error! status: 500",
      status: 500,
    });
    request.mockResolvedValue({ data: wording(), status: 200 });
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(/Editing the legal wording of/)
    ).toBeTruthy();
  });

  it("says why a refused save was refused", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(
      await screen.findByRole("button", { name: "Face to face" })
    );
    request.mockResolvedValue({
      error: "Only an admin for DT can change its legal wording.",
      status: 403,
      code: "jurisdiction_admin_required",
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Only an admin for this jurisdiction can change its legal wording."
      )
    );
  });

  it("does not show another jurisdiction's wording if the server answers for one", async () => {
    respondWith(wording({ jurisdiction: { code: "IAC", name: "IAC" } }));
    render(<AdminPage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/answered for IAC, not DT/)).toBeTruthy();
    expect(screen.queryByText("Credibility")).toBeNull();
  });

  it("waits for the jurisdiction before asking for anything", () => {
    mockContext = NEUTRAL;
    render(<AdminPage />);

    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so, and asks for nothing, when the tab works in no jurisdiction", () => {
    mockContext = jurisdictionContextValue(null);
    render(<AdminPage />);

    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /not working in a jurisdiction yet/
    );
  });

  it("keeps the IAC's legal wording editor as it was", async () => {
    mockContext = jurisdictionContextValue({ ...IAC, role: "judge" });
    respondWith(wording({ jurisdiction: { code: "IAC", name: IAC.name } }));
    render(<AdminPage />);

    const banner = await screen.findByText(/Editing the legal wording of/);
    expect(banner.textContent).toContain(`${IAC.name} (IAC)`);
    expect(request).toHaveBeenCalledWith("/admin/document-content", undefined);
  });

  it("leaves the Users and Jurisdictions tabs to a system administrator", async () => {
    respondWith(wording());
    const { unmount } = render(<AdminPage />);
    await screen.findByText(/Editing the legal wording of/);
    expect(screen.queryByRole("tab", { name: /Users/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Jurisdictions/ })).toBeNull();
    unmount();

    vi.mocked(getAdminRole).mockResolvedValue("SystemAdministrator");
    render(<AdminPage />);
    expect(await screen.findByRole("tab", { name: /Users/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Jurisdictions/ })).toBeTruthy();
  });

  it("keeps the other tabs reachable when the legal wording is refused", async () => {
    vi.mocked(getAdminRole).mockResolvedValue("SystemAdministrator");
    request.mockResolvedValue({
      error: "x",
      status: 403,
      code: "jurisdiction_admin_required",
    });
    render(<AdminPage />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(await screen.findByRole("tab", { name: /Users/ })).toBeTruthy();
  });
});
