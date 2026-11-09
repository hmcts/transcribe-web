import { beforeEach, describe, expect, it, vi } from "vitest";

// DIAAT-374: the role list is read in the shape the API sends, `{"roles": [...]}`
// (authz contract, section 3), and never as `undefined`.
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

import { apiClient } from "@/lib/api-client";
import { fetchAdminRoles } from "@/lib/admin-users-api";

const request = vi.mocked(apiClient.request);

describe("fetchAdminRoles", () => {
  beforeEach(() => request.mockReset());

  it("asks GET /admin/roles and returns the list from {roles: [...]}", async () => {
    request.mockResolvedValue({ data: { roles: ["Judge", "LegalTextManager"] }, status: 200 });

    await expect(fetchAdminRoles()).resolves.toEqual(["Judge", "LegalTextManager"]);

    expect(request).toHaveBeenCalledWith("/admin/roles", { method: "GET", cache: "no-store" });
  });

  it("returns an empty list when the caller may assign none", async () => {
    request.mockResolvedValue({ data: { roles: [] }, status: 200 });

    await expect(fetchAdminRoles()).resolves.toEqual([]);
  });

  it.each([
    ["the bare array the API used to send", ["Judge", "LegalTextManager"]],
    ["an object without roles", {}],
    ["roles that is not a list", { roles: "Judge" }],
    ["roles with something other than text in it", { roles: ["Judge", 7] }],
    ["nothing", undefined],
  ])("throws, rather than returning undefined, for %s", async (_what, data) => {
    request.mockResolvedValue({ data, status: 200 } as never);

    await expect(fetchAdminRoles()).rejects.toThrow(/not in the expected shape/);
  });

  it("throws the API's reason when it refuses", async () => {
    request.mockResolvedValue({ error: "Forbidden", status: 403 });

    await expect(fetchAdminRoles()).rejects.toThrow("Forbidden");
  });
});
