import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  addJurisdictionAdmin,
  createHearingType,
  createJurisdiction,
  createLegalFramework,
  deleteHearingType,
  deleteLegalFramework,
  fetchAdminJurisdictions,
  fetchDocumentContent,
  fetchJurisdictionAdmins,
  isJurisdictionNotFound,
  removeJurisdictionAdmin,
  updateAnonymityStatus,
  updateHearingType,
  updateLegalFramework,
} from "@/lib/admin-api";
import {
  IAC_ADMIN_JURISDICTION,
  IAC_CONTENT,
  TAX_CONTENT,
} from "./helpers/document-content";

const mockRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiClient: { request: mockRequest },
}));

const hearingType = IAC_CONTENT.hearing_types[0];
const legalFramework = IAC_CONTENT.legal_frameworks[0];
const anonymityStatus = IAC_CONTENT.anonymity.statuses[0];

beforeEach(() => {
  mockRequest.mockReset();
});

describe("admin wording reads", () => {
  it("lists only what the API returns for this admin", async () => {
    mockRequest.mockResolvedValue({ data: [IAC_ADMIN_JURISDICTION] });

    await expect(fetchAdminJurisdictions()).resolves.toEqual([
      IAC_ADMIN_JURISDICTION,
    ]);
    expect(mockRequest).toHaveBeenCalledWith("/admin/jurisdictions", {
      method: "GET",
      cache: "no-store",
    });
  });

  it("reads one jurisdiction's wording from its scoped route", async () => {
    mockRequest.mockResolvedValue({ data: TAX_CONTENT });

    const content = await fetchDocumentContent("tax");

    expect(content.jurisdiction.id).toBe("tax");
    expect(content.has_legal_wording).toBe(false);
    expect(mockRequest.mock.calls[0][0]).toBe(
      "/admin/jurisdictions/tax/document-content"
    );
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("escapes the jurisdiction id in the path", async () => {
    mockRequest.mockResolvedValue({ data: IAC_CONTENT });

    await fetchDocumentContent("a/b");

    expect(mockRequest.mock.calls[0][0]).toBe(
      "/admin/jurisdictions/a%2Fb/document-content"
    );
  });

  it("rejects a response without the jurisdiction fields", async () => {
    const { jurisdiction: _jurisdiction, ...legacy } = IAC_CONTENT;
    mockRequest.mockResolvedValue({ data: legacy });

    await expect(fetchDocumentContent("iac")).rejects.toThrow(
      /invalid document content response/
    );
  });
});

describe("admin wording writes go to the scoped routes", () => {
  beforeEach(() => {
    mockRequest.mockImplementation(async (_endpoint: string, options) => ({
      data: options?.body ? JSON.parse(options.body) : undefined,
    }));
  });

  const base = "/admin/jurisdictions/tax/document-content";

  it("hearing types", async () => {
    await updateHearingType("tax", hearingType.id, hearingType);
    await createHearingType("tax", hearingType);
    await deleteHearingType("tax", hearingType.id);

    expect(mockRequest.mock.calls.map(([url, o]) => [url, o.method])).toEqual([
      [`${base}/hearing-types/${hearingType.id}`, "PUT"],
      [`${base}/hearing-types`, "POST"],
      [`${base}/hearing-types/${hearingType.id}`, "DELETE"],
    ]);
  });

  it("legal frameworks", async () => {
    await updateLegalFramework("tax", legalFramework.id, legalFramework);
    await createLegalFramework("tax", legalFramework);
    await deleteLegalFramework("tax", legalFramework.id);

    expect(mockRequest.mock.calls.map(([url, o]) => [url, o.method])).toEqual([
      [`${base}/legal-frameworks/${legalFramework.id}`, "PUT"],
      [`${base}/legal-frameworks`, "POST"],
      [`${base}/legal-frameworks/${legalFramework.id}`, "DELETE"],
    ]);
  });

  it("anonymity statuses", async () => {
    await updateAnonymityStatus("tax", anonymityStatus.id, anonymityStatus);

    expect(mockRequest.mock.calls[0][0]).toBe(
      `${base}/anonymity-statuses/${anonymityStatus.id}`
    );
    expect(mockRequest.mock.calls[0][1].method).toBe("PUT");
  });

  it("never uses the deprecated unscoped routes", async () => {
    await updateHearingType("iac", hearingType.id, hearingType);
    await createLegalFramework("iac", legalFramework);
    await deleteLegalFramework("iac", legalFramework.id);
    await updateAnonymityStatus("iac", anonymityStatus.id, anonymityStatus);

    for (const [url] of mockRequest.mock.calls) {
      expect(url).toMatch(/^\/admin\/jurisdictions\/iac\/document-content/);
    }
  });
});

describe("jurisdiction not found", () => {
  it("is recognised from a 404 on a read", async () => {
    mockRequest.mockResolvedValue({
      error: "Jurisdiction not found",
      status: 404,
    });

    const error = await fetchDocumentContent("other").catch((e) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(isJurisdictionNotFound(error)).toBe(true);
  });

  it("is recognised from a 404 on a write and on a delete", async () => {
    mockRequest.mockResolvedValue({
      error: "Jurisdiction not found",
      status: 404,
    });

    const saveError = await updateHearingType(
      "other",
      hearingType.id,
      hearingType
    ).catch((e) => e);
    const deleteError = await deleteHearingType("other", hearingType.id).catch(
      (e) => e
    );

    expect(isJurisdictionNotFound(saveError)).toBe(true);
    expect(isJurisdictionNotFound(deleteError)).toBe(true);
  });

  it("is not confused with a missing item, a 403 or a plain Error", async () => {
    mockRequest.mockResolvedValue({
      error: "Hearing type not found",
      status: 404,
    });
    const missingItem = await updateHearingType(
      "iac",
      hearingType.id,
      hearingType
    ).catch((e) => e);

    expect(isJurisdictionNotFound(missingItem)).toBe(false);
    expect(
      isJurisdictionNotFound(new AdminApiError("Jurisdiction not found", 403))
    ).toBe(false);
    expect(isJurisdictionNotFound(new Error("Jurisdiction not found"))).toBe(
      false
    );
  });
});

describe("jurisdictions and their admins", () => {
  it("creates a jurisdiction", async () => {
    mockRequest.mockResolvedValue({
      data: { id: "tax", name: "Tax Tribunal", has_legal_wording: false },
    });

    await expect(
      createJurisdiction({ id: "tax", name: "Tax Tribunal" })
    ).resolves.toMatchObject({ id: "tax", has_legal_wording: false });
    expect(mockRequest).toHaveBeenCalledWith("/admin/jurisdictions", {
      method: "POST",
      body: JSON.stringify({ id: "tax", name: "Tax Tribunal" }),
    });
  });

  it("lists, assigns and removes a jurisdiction's admins", async () => {
    const admin = { user_id: "u1", email: "a@x.test", role: "LegalTextManager" };
    mockRequest
      .mockResolvedValueOnce({ data: [admin] })
      .mockResolvedValueOnce({ data: admin })
      .mockResolvedValueOnce({ data: undefined });

    await expect(fetchJurisdictionAdmins("tax")).resolves.toEqual([admin]);
    await expect(addJurisdictionAdmin("tax", "u1")).resolves.toEqual(admin);
    await removeJurisdictionAdmin("tax", "u1");

    expect(mockRequest.mock.calls.map(([url, o]) => [url, o?.method])).toEqual([
      ["/admin/jurisdictions/tax/admins", "GET"],
      ["/admin/jurisdictions/tax/admins/u1", "PUT"],
      ["/admin/jurisdictions/tax/admins/u1", "DELETE"],
    ]);
  });

  it("surfaces a failed removal", async () => {
    mockRequest.mockResolvedValue({
      error: "User is not an admin of this jurisdiction",
      status: 404,
    });

    await expect(removeJurisdictionAdmin("tax", "u1")).rejects.toThrow(
      "User is not an admin of this jurisdiction"
    );
  });
});
