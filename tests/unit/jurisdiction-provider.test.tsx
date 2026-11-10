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
  const { current, hasDecisionTemplate, hasHearingRecordings, resolved } =
    useJurisdiction();
  const wording = useWording();
  return (
    <div>
      <p>material for {current?.code}</p>
      <p>{wording("records.column_title")}</p>
      <p>template: {String(hasDecisionTemplate)}</p>
      <p>recordings: {String(hasHearingRecordings)}</p>
      <p>resolved: {String(resolved)}</p>
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

  it("tells the admin area when the jurisdiction has settled, even if there is none (DIAAT-342)", async () => {
    pathname = "/admin"; // opens without a jurisdiction
    let answer: (value: { data: MyJurisdictions }) => void = () => undefined;
    vi.mocked(apiClient.request).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    renderProvider();
    expect(screen.getByText("resolved: false")).toBeTruthy();

    answer({ data: { status: "no_jurisdiction", current: null, jurisdictions: [] } });
    expect(await screen.findByText("resolved: true")).toBeTruthy();
    expect(screen.getByText("material for")).toBeTruthy();
  });

  it("tells the admin area when the jurisdiction could not be loaded", async () => {
    pathname = "/admin";
    vi.mocked(apiClient.request).mockResolvedValue({ error: "down" });
    renderProvider();

    expect(await screen.findByText("resolved: true")).toBeTruthy();
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

  it("asks a judge in several jurisdictions to choose, then works in their choice (DIAAT-332)", async () => {
    vi.mocked(apiClient.request).mockImplementation(async (endpoint, options) => {
      if (endpoint === "/jurisdictions/active") {
        expect(options?.method).toBe("PUT");
        expect(JSON.parse(String(options?.body))).toEqual({ code: "ET" });
        return { data: { status: "ready", current: ET, jurisdictions: [ET, IAC] } };
      }
      // Before the choice, then after it (the tab now names the ET).
      return getTabJurisdiction() === "ET"
        ? { data: { status: "ready", current: ET, jurisdictions: [ET, IAC] } }
        : {
            data: {
              status: "choose",
              current: null,
              jurisdictions: [
                { code: "ET", name: "Employment Tribunal", role: "judge" },
                { code: "IAC", name: "Immigration and Asylum Chamber", role: "judge" },
              ],
            },
          };
    });
    renderProvider();

    expect(await screen.findByRole("heading", { name: "Choose your jurisdiction" })).toBeTruthy();
    expect(screen.queryByText(/material for/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Employment Tribunal" }));

    expect(await screen.findByText("material for ET")).toBeTruthy();
    expect(getTabJurisdiction()).toBe("ET");
  });

  it("says so, and lets them choose again, when a choice fails", async () => {
    vi.mocked(apiClient.request).mockImplementation(async (endpoint) => {
      if (endpoint === "/jurisdictions/active") throw new Error("network");
      return {
        data: {
          status: "choose",
          current: null,
          jurisdictions: [{ code: "ET", name: "Employment Tribunal", role: "judge" }],
        },
      };
    });
    renderProvider();

    fireEvent.click(await screen.findByRole("button", { name: "Employment Tribunal" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Employment Tribunal" }) as HTMLButtonElement).disabled
    ).toBe(false);
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
