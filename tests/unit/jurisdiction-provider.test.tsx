import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ET, IAC } from "../jurisdiction-helpers";

// DIAAT-330: the tab's jurisdiction is loaded before any material, and decides
// what the user sees.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

import { apiClient } from "@/lib/api-client";
import type { MyJurisdictions } from "@/lib/jurisdiction-api";
import {
  getTabJurisdiction,
  setTabJurisdiction,
} from "@/lib/jurisdiction-session";
import {
  JurisdictionProvider,
  useJurisdiction,
  useWording,
} from "@/providers/jurisdiction";

function respond(body: MyJurisdictions) {
  vi.mocked(apiClient.request).mockResolvedValue({ data: body });
}

function Probe() {
  const { current, hasDecisionTemplate, hasHearingRecordings } =
    useJurisdiction();
  const wording = useWording();
  return (
    <div>
      <p>material for {current?.code}</p>
      <p>{wording("records.column_title")}</p>
      <p>template: {String(hasDecisionTemplate)}</p>
      <p>recordings: {String(hasHearingRecordings)}</p>
    </div>
  );
}

function renderProvider() {
  return render(
    <JurisdictionProvider>
      <Probe />
    </JurisdictionProvider>
  );
}

describe("JurisdictionProvider", () => {
  beforeEach(() => {
    pathname = "/";
    window.sessionStorage.clear();
    vi.mocked(apiClient.request).mockReset();
  });
  afterEach(() => window.sessionStorage.clear());

  it("shows nothing of the material until the jurisdiction is known", () => {
    vi.mocked(apiClient.request).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    );
    renderProvider();
    expect(screen.getByText("Loading your jurisdiction...")).toBeTruthy();
    expect(screen.queryByText(/material for/)).toBeNull();
  });

  it("gives the material the jurisdiction's wording and what it uses", async () => {
    respond({ status: "ready", current: IAC, jurisdictions: [IAC] });
    renderProvider();

    expect(await screen.findByText("material for IAC")).toBeTruthy();
    expect(screen.getByText("Hearing")).toBeTruthy();
    expect(screen.getByText("template: true")).toBeTruthy();
    expect(screen.getByText("recordings: true")).toBeTruthy();
    expect(apiClient.request).toHaveBeenCalledWith("/jurisdictions/me");
  });

  it("uses neutral wording for anything a jurisdiction does not set", async () => {
    respond({ status: "ready", current: ET, jurisdictions: [ET] });
    renderProvider();

    expect(await screen.findByText("material for ET")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.queryByText("Hearing")).toBeNull();
    expect(screen.getByText("template: false")).toBeTruthy();
    expect(screen.getByText("recordings: false")).toBeTruthy();
  });

  it("pins the tab to the jurisdiction it works in", async () => {
    respond({ status: "ready", current: ET, jurisdictions: [ET, IAC] });
    renderProvider();
    await screen.findByText("material for ET");
    expect(getTabJurisdiction()).toBe("ET");
  });

  it("shows a user with no jurisdiction how to ask for access, and nothing else", async () => {
    setTabJurisdiction("IAC");
    respond({ status: "no_jurisdiction", current: null, jurisdictions: [] });
    renderProvider();

    expect(
      await screen.findByRole("heading", {
        name: "You do not have access to Bench Notes yet",
      })
    ).toBeTruthy();
    const email = screen.getByRole("link", {
      name: /Email JudicialTranscribe@justice.gov.uk/,
    });
    expect(email.getAttribute("href")).toContain(
      "mailto:JudicialTranscribe@justice.gov.uk"
    );
    expect(screen.queryByText(/material for/)).toBeNull();
    expect(getTabJurisdiction()).toBeNull();
  });

  it("offers to try again when the jurisdiction cannot be loaded", async () => {
    vi.mocked(apiClient.request).mockRejectedValueOnce(new Error("network"));
    renderProvider();

    const retry = await screen.findByRole("button", { name: "Try again" });
    respond({ status: "ready", current: IAC, jurisdictions: [IAC] });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByText("material for IAC")).toBeTruthy()
    );
  });

  it.each([
    "/privacy",
    "/admin",
  ])("renders %s, which holds no one's material, without a jurisdiction", (page) => {
    pathname = page;
    vi.mocked(apiClient.request).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    );
    renderProvider();
    expect(screen.getByText("material for")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy(); // neutral, not anyone's wording
  });
});
