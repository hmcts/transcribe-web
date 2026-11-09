import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
import { apiClient } from "@/lib/api-client";
import type { MeResponse } from "@/lib/access/types";
import { jurisdictionContextValue, NEUTRAL } from "@/lib/jurisdiction-context";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { ME } from "../access-helpers";
import { DT, IAC } from "../jurisdiction-helpers";

// DIAAT-342: the admin area edits the legal wording of the jurisdiction the tab
// works in, says which, and explains each refusal.

let mockContext = jurisdictionContextValue(DT);
// DIAAT-373: which tabs show follows the permissions the API returned.
let mockPersona: MeResponse = ME.legalTextManager;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => mockContext,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
vi.mock("@/components/admin/jurisdictions-panel", () => ({
  JurisdictionsPanel: () => <div>Jurisdictions panel</div>,
}));
vi.mock("@/components/editor/admin-editor", () => ({
  AdminEditor: ({ value }: { value: string }) => <div>{value}</div>,
}));

import { toast } from "sonner";

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

const asDt = () => jurisdictionContextValue(DT, [DT]);

function respondWith(body: unknown) {
  request.mockImplementation(async () => ({ data: body, status: 200 }));
}

describe("Admin area: legal wording of the active jurisdiction (DIAAT-342)", () => {
  beforeEach(() => {
    mockContext = asDt();
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    mockPersona = ME.legalTextManager;
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
    mockContext = jurisdictionContextValue(IAC);
    respondWith(wording({ jurisdiction: { code: "IAC", name: IAC.name } }));
    render(<AdminPage />);

    const banner = await screen.findByText(/Editing the legal wording of/);
    expect(banner.textContent).toContain(`${IAC.name} (IAC)`);
    expect(request).toHaveBeenCalledWith("/admin/document-content", undefined);
  });

  it("shows each tab only to a role holding its permission (DIAAT-384)", async () => {
    respondWith(wording());
    const tabsFor = async (persona: MeResponse) => {
      mockPersona = persona;
      const { unmount } = render(<AdminPage />);
      const names = (await screen.findAllByRole("tab")).map((t) =>
        (t.textContent ?? "").trim()
      );
      unmount();
      return names;
    };

    expect(await tabsFor(ME.legalTextManager)).toEqual([
      "Document Content",
      "Templates",
    ]);
    expect(await tabsFor(ME.jurisdictionAdministrator)).toEqual([
      "Templates",
      "Users",
      "Approvals",
      "Jurisdictions",
    ]);
    expect(await tabsFor(ME.jurisdictionSuperAdministrator)).toEqual([
      "Templates",
      "Users",
      "Approvals",
      "Jurisdictions",
    ]);
    expect(await tabsFor(ME.sysadminOnly)).toEqual([
      "Super administrators",
      "Feature flags",
    ]);
  });

  it("opens on the first tab the role has, and does not load legal wording for a role without it", async () => {
    mockPersona = ME.jurisdictionAdministrator;
    render(<AdminPage />);

    expect(await screen.findByRole("heading", { name: "Templates" })).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith(
      "/admin/document-content",
      undefined
    );
  });

  it("shows a placeholder, with no role list or change-role control, in the Users tab (DIAAT-375)", async () => {
    mockPersona = ME.jurisdictionAdministrator;
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(await screen.findByRole("tab", { name: /Users/ }));

    expect(
      await screen.findByText(/not available in this screen yet/)
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(request).not.toHaveBeenCalledWith("/admin/roles", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      expect.stringContaining("/admin/users"),
      expect.anything()
    );
  });

  it("shows the working jurisdictions panel to a role that manages jurisdictions", async () => {
    mockPersona = ME.jurisdictionSuperAdministrator;
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(await screen.findByRole("tab", { name: /Jurisdictions/ }));

    expect(await screen.findByText("Jurisdictions panel")).toBeTruthy();
  });

  it("says there is nothing to manage for a role with no admin permission", async () => {
    mockPersona = ME.judge;
    render(<AdminPage />);

    expect(await screen.findByText(/nothing to manage here/)).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("keeps the other tabs reachable when the legal wording is refused", async () => {
    mockPersona = {
      ...ME.legalTextManager,
      permissions: [...ME.legalTextManager.permissions, "users.manage"],
    };
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

// DIAAT-332: switching jurisdiction reloads the tab, so it waits for edits to be
// saved or discarded, and for a save to finish.
describe("Admin area and switching jurisdiction", () => {
  beforeEach(() => {
    mockContext = asDt();
    request.mockReset();
    mockPersona = ME.legalTextManager;
  });

  it("allows a switch while nothing is edited", async () => {
    respondWith(wording());
    render(<AdminPage />);
    await screen.findByDisplayValue("Hearing");

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it("stops a switch while an edit is unsaved, and allows it once the edit is undone", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);

    const title = await screen.findByDisplayValue("Hearing");
    await user.type(title, "!");
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });

    await user.type(title, "{Backspace}");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it("stops a switch for a legal framework issue typed but not yet added", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(
      await screen.findByRole("button", { name: "Credibility" })
    );
    await user.type(
      await screen.findByLabelText("New issue"),
      "Is it credible?"
    );

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });

  it("stops a switch while a save is under way, and allows it once saved", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);
    const title = await screen.findByDisplayValue("Hearing");
    await user.type(title, "!");

    let finishSave: (value: unknown) => void = () => undefined;
    let stored = wording();
    request.mockImplementation(
      async (_endpoint: string, options?: RequestInit) => {
        if (options?.method !== "PUT") return { data: stored, status: 200 };
        const sent = JSON.parse(String(options.body));
        await new Promise((resolve) => {
          finishSave = resolve;
        });
        stored = { ...stored, hearing_types: [sent] };
        return { data: sent, status: 200 };
      }
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });
    finishSave(undefined);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // Once the saved wording has been reloaded.
    await waitFor(() =>
      expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined()
    );
  });

  it("keeps stopping a switch while a save is under way after another entry is selected", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);
    const title = await screen.findByDisplayValue("Hearing");
    await user.type(title, "!");

    let finishSave: (value: unknown) => void = () => undefined;
    let stored = wording();
    request.mockImplementation(
      async (_endpoint: string, options?: RequestInit) => {
        if (options?.method !== "PUT") return { data: stored, status: 200 };
        const sent = JSON.parse(String(options.body));
        await new Promise((resolve) => {
          finishSave = resolve;
        });
        stored = { ...stored, hearing_types: [sent] };
        return { data: sent, status: 200 };
      }
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Credibility" }));
    await screen.findByLabelText("New issue");

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });
    finishSave(undefined);
    await waitFor(() =>
      expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined()
    );
  });

  it("stops a switch for an unsaved anonymity edit", async () => {
    respondWith(
      wording({
        anonymity: {
          statuses: [
            {
              id: "granted",
              title: "Granted",
              content: "c",
              identifier: "i",
              header: "Header",
              order_header: "OH",
              order_text: "OT",
            },
          ],
        },
      })
    );
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.click(await screen.findByRole("button", { name: "Granted" }));
    await user.type(await screen.findByDisplayValue("Header"), "!");

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });

  it("stops caring once the admin area is left", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    const { unmount } = render(<AdminPage />);
    await user.type(await screen.findByDisplayValue("Hearing"), "!");
    await expect(prepareForJurisdictionSwitch()).rejects.toBeDefined();

    unmount();

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });
});

describe("Admin area: saves and deletes while requests are pending", () => {
  beforeEach(() => {
    mockContext = asDt();
    request.mockReset();
    vi.mocked(toast.success).mockClear();
    mockPersona = ME.legalTextManager;
  });

  const hearingType = (id: string, title: string) => ({
    id,
    title,
    hearing_title: `${title} hearing`,
    hearing_description: `${title} description`,
  });

  it("selects from the refreshed wording after deleting the selected item, not the deleted one", async () => {
    const before = wording({
      hearing_types: [
        hearingType("first", "First"),
        hearingType("second", "Second"),
      ],
    });
    const after = wording({ hearing_types: [hearingType("second", "Second")] });
    let finishReload: () => void = () => undefined;
    let deleted = false;
    request.mockImplementation(
      async (_endpoint: string, options?: RequestInit) => {
        if (options?.method === "DELETE") {
          deleted = true;
          return { data: null, status: 204 };
        }
        if (options?.method === "PUT") {
          return { data: JSON.parse(String(options.body)), status: 200 };
        }
        if (!deleted) return { data: before, status: 200 };
        await new Promise<void>((resolve) => {
          finishReload = resolve;
        });
        return { data: after, status: 200 };
      }
    );
    const user = userEvent.setup();
    render(<AdminPage />);

    await screen.findByDisplayValue("First hearing");
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("First hearing")).toBeNull()
    );
    finishReload();

    await screen.findByDisplayValue("Second hearing");
    request.mockClear();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/admin/document-content/hearing-types/second",
        expect.objectContaining({ method: "PUT" })
      )
    );
    expect(request).not.toHaveBeenCalledWith(
      "/admin/document-content/hearing-types/first",
      expect.anything()
    );
  });

  it("keeps what was typed while a save was under way, as unsaved", async () => {
    respondWith(wording());
    const user = userEvent.setup();
    render(<AdminPage />);
    const title = await screen.findByDisplayValue("Hearing");
    await user.type(title, "!");

    let finishSave: () => void = () => undefined;
    let stored = wording();
    request.mockImplementation(
      async (_endpoint: string, options?: RequestInit) => {
        if (options?.method !== "PUT") return { data: stored, status: 200 };
        const sent = JSON.parse(String(options.body));
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
        stored = { ...stored, hearing_types: [sent] };
        return { data: sent, status: 200 };
      }
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(title, "?");
    finishSave();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByDisplayValue("Hearing!?")).toBeTruthy()
    );
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });
});
