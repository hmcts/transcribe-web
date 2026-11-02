import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
import type { AdminJurisdiction } from "@/lib/admin-api";
import { AdminApiError } from "@/lib/admin-api";
import type { DocumentContent } from "@/lib/editor-contracts";
import {
  IAC_ADMIN_JURISDICTION,
  IAC_CONTENT,
  TAX_ADMIN_JURISDICTION,
  TAX_CONTENT,
} from "./helpers/document-content";

const api = vi.hoisted(() => ({
  fetchAdminJurisdictions: vi.fn(),
  fetchDocumentContent: vi.fn(),
  updateHearingType: vi.fn(),
  createHearingType: vi.fn(),
  deleteHearingType: vi.fn(),
  updateLegalFramework: vi.fn(),
  createLegalFramework: vi.fn(),
  deleteLegalFramework: vi.fn(),
  updateAnonymityStatus: vi.fn(),
}));
const mockGetAdminRole = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  ...api,
}));

vi.mock("@/lib/admin-access", () => ({ getAdminRole: mockGetAdminRole }));

vi.mock("@/lib/admin-users-api", () => ({
  VALID_ROLES: ["Normal"],
  fetchAdminRoles: vi.fn().mockResolvedValue([]),
  fetchAdminUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  updateUserRole: vi.fn(),
  deleteAdminUser: vi.fn(),
}));

vi.mock("@/components/admin/jurisdictions-panel", () => ({
  JurisdictionsPanel: () => <div>Jurisdictions panel</div>,
}));

// The rich-text editor is not what is under test.
vi.mock("@/components/editor/admin-editor", () => ({
  AdminEditor: ({
    value,
    editable = true,
  }: {
    value: string;
    editable?: boolean;
  }) => (
    <div data-testid="rich-editor" data-editable={String(editable)}>
      {value}
    </div>
  ),
}));

// Radix Select cannot be driven from jsdom; a native select keeps the same contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      aria-label="Jurisdiction"
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
  toast: { error: mockToastError, success: vi.fn() },
}));

class ResizeObserverMock {
  observe() {
    // No-op for jsdom.
  }

  unobserve() {
    // No-op for jsdom.
  }

  disconnect() {
    // No-op for jsdom.
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
);
Element.prototype.scrollIntoView = vi.fn();

const contents: Record<string, DocumentContent> = {
  iac: IAC_CONTENT,
  tax: TAX_CONTENT,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const notFound = () => new AdminApiError("Jurisdiction not found", 404);

const renderPage = async (jurisdictions: AdminJurisdiction[]) => {
  api.fetchAdminJurisdictions.mockResolvedValue(jurisdictions);
  render(<AdminPage />);
};

beforeEach(() => {
  mockGetAdminRole.mockResolvedValue("LegalTextManager");
  api.fetchDocumentContent.mockImplementation(async (id: string) => {
    const content = contents[id];
    if (!content) throw notFound();
    return content;
  });
  api.updateHearingType.mockImplementation(async (_j, _id, data) => data);
});

describe("Admin wording editor: which jurisdictions", () => {
  it("opens the only jurisdiction directly, with no picker", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);

    expect(
      await screen.findByRole("button", { name: "Face to face" })
    ).toBeTruthy();
    expect(api.fetchDocumentContent).toHaveBeenCalledTimes(1);
    expect(api.fetchDocumentContent).toHaveBeenCalledWith("iac");
    expect(screen.queryByLabelText("Jurisdiction")).toBeNull();
    expect(screen.getByText(IAC_ADMIN_JURISDICTION.name)).toBeTruthy();
  });

  it("offers a picker only for the jurisdictions the API returns", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION, TAX_ADMIN_JURISDICTION]);

    const picker = (await screen.findByLabelText(
      "Jurisdiction"
    )) as HTMLSelectElement;

    expect(Array.from(picker.options).map((o) => o.value)).toEqual([
      "iac",
      "tax",
    ]);
    expect(api.fetchDocumentContent).toHaveBeenCalledWith("iac");
  });

  it("shows a clear empty state when no jurisdiction is assigned", async () => {
    await renderPage([]);

    expect(await screen.findByText("No jurisdiction assigned")).toBeTruthy();
    expect(screen.getByText(/Ask a system administrator/)).toBeTruthy();
    expect(api.fetchDocumentContent).not.toHaveBeenCalled();
  });

  it("offers a retry when the jurisdictions cannot be loaded", async () => {
    api.fetchAdminJurisdictions.mockRejectedValueOnce(new Error("boom"));
    api.fetchAdminJurisdictions.mockResolvedValueOnce([IAC_ADMIN_JURISDICTION]);
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: "Face to face" })
    ).toBeTruthy();
  });
});

describe("Admin wording editor: switching jurisdiction", () => {
  it("loads the chosen jurisdiction's wording and shows none of the previous", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION, TAX_ADMIN_JURISDICTION]);
    expect(
      await screen.findByRole("button", { name: "Face to face" })
    ).toBeTruthy();
    const tax = deferred<DocumentContent>();
    api.fetchDocumentContent.mockReturnValueOnce(tax.promise);

    fireEvent.change(screen.getByLabelText("Jurisdiction"), {
      target: { value: "tax" },
    });

    // While Tax loads, nothing of the IAC remains on screen.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Face to face" })).toBeNull()
    );
    expect(screen.queryByRole("button", { name: "Credibility" })).toBeNull();
    await act(async () => tax.resolve(TAX_CONTENT));
    expect(
      await screen.findByRole("button", { name: "Tax hearing" })
    ).toBeTruthy();
    expect(api.fetchDocumentContent).toHaveBeenLastCalledWith("tax");
  });

  it("drops a slow response for a jurisdiction the admin has already left", async () => {
    const slowIac = deferred<DocumentContent>();
    api.fetchDocumentContent.mockImplementation((id: string) =>
      id === "iac" ? slowIac.promise : Promise.resolve(contents[id])
    );
    await renderPage([IAC_ADMIN_JURISDICTION, TAX_ADMIN_JURISDICTION]);
    const picker = await screen.findByLabelText("Jurisdiction");

    fireEvent.change(picker, { target: { value: "tax" } });
    expect(
      await screen.findByRole("button", { name: "Tax hearing" })
    ).toBeTruthy();
    await act(async () => slowIac.resolve(IAC_CONTENT));

    expect(screen.getByRole("button", { name: "Tax hearing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Face to face" })).toBeNull();
  });
});

describe("Admin wording editor: saving", () => {
  it("saves to the jurisdiction the editor is open on", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION, TAX_ADMIN_JURISDICTION]);
    fireEvent.change(await screen.findByLabelText("Jurisdiction"), {
      target: { value: "tax" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Tax hearing" }));

    fireEvent.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(api.updateHearingType).toHaveBeenCalledWith(
        "tax",
        "tax_hearing",
        TAX_CONTENT.hearing_types[0]
      )
    );
  });

  it("deletes from the jurisdiction the editor is open on", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Face to face" })
    );
    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    api.deleteHearingType.mockResolvedValue(undefined);

    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      })
    );

    await waitFor(() =>
      expect(api.deleteHearingType).toHaveBeenCalledWith("iac", "face_to_face")
    );
  });

  it("warns that deleting the last legal framework removes the legal issues step", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(await screen.findByRole("button", { name: "Credibility" }));

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    expect(await screen.findByText(/last legal framework/i)).toBeTruthy();
  });

  it("explains what adding the first legal framework does when there is none", async () => {
    await renderPage([TAX_ADMIN_JURISDICTION]);
    await screen.findByRole("button", { name: "Tax hearing" });

    expect(
      screen.getByText(
        /judges for this jurisdiction have no legal issues step/i
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));

    expect(
      await screen.findByText(
        /Saving its first legal framework gives its judges/
      )
    ).toBeTruthy();
  });
});

describe("Admin wording editor: read only", () => {
  const readOnlyIac = { ...IAC_ADMIN_JURISDICTION, can_edit: false };

  it("shows the wording without Save, Delete or add actions", async () => {
    await renderPage([readOnlyIac]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Face to face" })
    );

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(
      screen.getByText(/view this jurisdiction.s wording but not edit/)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add hearing type/i })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /add framework/i })).toBeNull();
    expect(
      screen.getByDisplayValue("Face to face hearing").matches(":disabled")
    ).toBe(true);
    for (const editor of screen.getAllByTestId("rich-editor")) {
      expect(editor.dataset.editable).toBe("false");
    }
  });

  it("is editable for an admin who can edit", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Face to face" })
    );

    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Admin wording editor: jurisdiction not found", () => {
  it("shows that the jurisdiction is not available when its wording returns 404", async () => {
    api.fetchDocumentContent.mockRejectedValue(notFound());
    await renderPage([IAC_ADMIN_JURISDICTION]);

    expect(await screen.findByText("Jurisdiction not available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Face to face" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("reloads the jurisdictions the admin may open from that state", async () => {
    api.fetchDocumentContent.mockRejectedValueOnce(notFound());
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload jurisdictions" })
    );

    expect(
      await screen.findByRole("button", { name: "Face to face" })
    ).toBeTruthy();
    expect(api.fetchAdminJurisdictions).toHaveBeenCalledTimes(2);
  });

  it("leaves the editor when a save finds the jurisdiction gone", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Face to face" })
    );
    api.updateHearingType.mockRejectedValue(notFound());

    fireEvent.click(await screen.findByRole("button", { name: /save/i }));

    expect(await screen.findByText("Jurisdiction not available")).toBeTruthy();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("reports an ordinary failed save without leaving the editor", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Face to face" })
    );
    api.updateHearingType.mockRejectedValue(
      new AdminApiError("Hearing type not found", 404)
    );

    fireEvent.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Hearing type not found")
    );
    expect(screen.queryByText("Jurisdiction not available")).toBeNull();
  });
});

describe("Admin tabs", () => {
  it("hides the SystemAdministrator tabs from a Legal Text Manager", async () => {
    await renderPage([IAC_ADMIN_JURISDICTION]);
    await screen.findByRole("button", { name: "Face to face" });

    expect(screen.queryByRole("tab", { name: /jurisdictions/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /users/i })).toBeNull();
  });

  it("shows the Jurisdictions tab to a SystemAdministrator", async () => {
    mockGetAdminRole.mockResolvedValue("SystemAdministrator");
    await renderPage([IAC_ADMIN_JURISDICTION]);

    expect(
      await screen.findByRole("tab", { name: /jurisdictions/i })
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: /users/i })).toBeTruthy();
  });
});
