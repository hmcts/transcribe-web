import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
import { FeatureFlagsPanel } from "@/components/admin/feature-flags-panel";
import type { MeResponse } from "@/lib/access/types";
import type { FeatureFlag } from "@/lib/admin-feature-flags-api";
import { apiClient } from "@/lib/api-client";
import { jurisdictionContextValue } from "@/lib/jurisdiction-context";
import { DT } from "../jurisdiction-helpers";
import { ME } from "../access-helpers";

// DIAAT-392: Admin > Feature flags, for feature_flags.manage.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
let persona: MeResponse = ME.sysadminOnly;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);
vi.mock("@/providers/jurisdiction", () => ({
  useJurisdiction: () => jurisdictionContextValue(DT),
}));
vi.mock("@/components/admin/jurisdictions-panel", () => ({
  JurisdictionsPanel: () => <div>Jurisdictions panel</div>,
}));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

import { toast } from "sonner";

const request = vi.mocked(apiClient.request);

const dictation = (value: boolean, over: Partial<FeatureFlag> = {}): FeatureFlag => ({
  name: "dictation_enabled",
  value,
  description: "Live dictation",
  updated_at: null,
  updated_by: null,
  ...over,
});

function serve(initial: FeatureFlag[] = [dictation(true)]) {
  let flags = initial;
  request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (endpoint === "/admin/feature-flags") return { data: { flags } };
    if (endpoint === "/admin/feature-flags/dictation_enabled" && method === "PUT") {
      const { value } = JSON.parse(String(options?.body));
      flags = [dictation(value, { updated_at: "2026-11-05T12:00:00Z", updated_by: "oleg@example.test" })];
      return { data: { flags } };
    }
    if (endpoint === "/flags") return { data: { dictation_enabled: true } };
    throw new Error(`Unexpected ${method} ${endpoint}`);
  });
}

beforeEach(() => {
  persona = ME.sysadminOnly;
  request.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Feature flags", () => {
  it("lists each flag with what it does and its state", async () => {
    serve([dictation(true, { updated_at: "2026-11-05T12:00:00Z", updated_by: "oleg@example.test" })]);
    render(<FeatureFlagsPanel />);

    expect(await screen.findByText("dictation_enabled")).toBeTruthy();
    expect(screen.getByText("Live dictation")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "dictation_enabled" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/by oleg@example.test/)).toBeTruthy();
  });

  it("switches a flag with PUT {value}, and shows what the API now has", async () => {
    serve();
    const user = userEvent.setup();
    render(<FeatureFlagsPanel />);

    await user.click(await screen.findByRole("switch", { name: "dictation_enabled" }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "dictation_enabled" }).getAttribute("aria-checked")).toBe("false")
    );
    const put = request.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(put?.[0]).toBe("/admin/feature-flags/dictation_enabled");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ value: false });
    expect(toast.success).toHaveBeenCalledWith("dictation_enabled is now off");
  });

  it("leaves the switch where the API has it, and says why, when a change is refused", async () => {
    serve();
    const base = request.getMockImplementation() as typeof apiClient.request;
    request.mockImplementation(async (endpoint, options) =>
      options?.method === "PUT" ? { error: "Needs feature_flags.manage", status: 403 } : base(endpoint, options)
    );
    const user = userEvent.setup();
    render(<FeatureFlagsPanel />);

    await user.click(await screen.findByRole("switch", { name: "dictation_enabled" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Needs feature_flags.manage"));
    expect(screen.getByRole("switch", { name: "dictation_enabled" }).getAttribute("aria-checked")).toBe("true");
  });

  it("offers a retry when the flags cannot be loaded", async () => {
    serve();
    request.mockResolvedValueOnce({ error: "Unavailable", status: 503 });
    const user = userEvent.setup();
    render(<FeatureFlagsPanel />);

    expect(await screen.findByText("Unavailable")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("dictation_enabled")).toBeTruthy();
  });
});

describe("the Feature flags tab", () => {
  it("is there for feature_flags.manage and for nobody else", async () => {
    serve();
    const tabsFor = async (me: MeResponse) => {
      persona = me;
      const { unmount } = render(<AdminPage />);
      const names = (await screen.findAllByRole("tab")).map((t) => t.textContent?.trim());
      unmount();
      return names;
    };

    expect(await tabsFor(ME.sysadminOnly)).toContain("Feature flags");
    request.mockClear();
    for (const other of [ME.jurisdictionAdministrator, ME.jurisdictionSuperAdministrator, ME.legalTextManager]) {
      expect(await tabsFor(other)).not.toContain("Feature flags");
    }
    // A role without the permission never asks for the flags.
    expect(request.mock.calls.some(([e]) => String(e).startsWith("/admin/feature-flags"))).toBe(false);
  });
});
