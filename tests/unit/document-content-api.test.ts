import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchJurisdictions,
  fetchUserDocumentContent,
} from "@/lib/document-content-api";
import { IAC_CONTENT, IAC_NAME, TAX_CONTENT } from "./helpers/document-content";

const mockRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiClient: { request: mockRequest },
}));

beforeEach(() => {
  mockRequest.mockReset();
});

describe("fetchUserDocumentContent", () => {
  it("asks for the default jurisdiction when none is named", async () => {
    mockRequest.mockResolvedValue({ data: IAC_CONTENT });

    await fetchUserDocumentContent();

    expect(mockRequest).toHaveBeenCalledWith("/document-content", {
      cache: "no-store",
    });
  });

  it("asks for the jurisdiction the form names, never cached", async () => {
    mockRequest.mockResolvedValue({ data: TAX_CONTENT });

    const content = await fetchUserDocumentContent("Tax Tribunal");

    expect(content.has_legal_wording).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith(
      "/document-content?jurisdiction=Tax%20Tribunal",
      { cache: "no-store" }
    );
  });

  it("throws the API's message for an unknown jurisdiction", async () => {
    mockRequest.mockResolvedValue({ error: "Jurisdiction not found" });

    await expect(fetchUserDocumentContent("Nowhere")).rejects.toThrow(
      "Jurisdiction not found"
    );
  });
});

describe("fetchJurisdictions", () => {
  it("returns the options for the jurisdiction select", async () => {
    const options = [
      { id: "iac", name: IAC_NAME, has_legal_wording: true },
      { id: "tax", name: "Tax Tribunal", has_legal_wording: false },
    ];
    mockRequest.mockResolvedValue({ data: options });

    await expect(fetchJurisdictions()).resolves.toEqual(options);
    expect(mockRequest).toHaveBeenCalledWith("/jurisdictions", {
      cache: "no-store",
    });
  });
});
