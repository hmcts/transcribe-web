import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";
import { ET, IAC } from "../jurisdiction-helpers";

// DIAAT-330: the material of the jurisdiction the user works in is loaded before
// any page that is about material, and decides what the user sees. DIAAT-373:
// which jurisdiction that is comes from the access provider.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/access/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/api")>()),
  fetchCurrentJurisdiction: vi.fn(),
}));

let mockPersona: MeResponse = ME.judge;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);

import { AccessApiError, fetchCurrentJurisdiction } from "@/lib/access/api";
import {
  JurisdictionProvider,
  useJurisdiction,
  useWording,
} from "@/providers/jurisdiction";

const fetchCurrent = vi.mocked(fetchCurrentJurisdiction);

function Probe() {
  const { current, hasDecisionTemplate, hasHearingRecordings, resolved, jurisdictions } =
    useJurisdiction();
  const wording = useWording();
  return (
    <div>
      <p>material for {current?.code}</p>
      <p>{wording("records.column_title")}</p>
      <p>template: {String(hasDecisionTemplate)}</p>
      <p>recordings: {String(hasHearingRecordings)}</p>
      <p>resolved: {String(resolved)}</p>
      <p>jurisdictions: {jurisdictions.map((j) => j.code).join(",")}</p>
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

const inIac = (): MeResponse => ({
  ...ME.judge,
  assignments: [{ jurisdiction: { code: "IAC", name: IAC.name }, role: "Judge" }],
  active: { jurisdiction: { code: "IAC", name: IAC.name }, role: "Judge" },
});

describe("JurisdictionProvider", () => {
  beforeEach(() => {
    pathname = "/";
    mockPersona = ME.judge;
    fetchCurrent.mockReset();
  });

  it("shows nothing of the material until the jurisdiction is known", () => {
    fetchCurrent.mockReturnValue(
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
    mockPersona = ME.jurisdictionSuperAdministrator; // a global role: no jurisdiction
    renderProvider();

    expect(await screen.findByText("resolved: true")).toBeTruthy();
    expect(screen.getByText("material for")).toBeTruthy();
    expect(fetchCurrent).not.toHaveBeenCalled();
  });

  it("waits for the jurisdiction in the admin area, which opens before it", async () => {
    pathname = "/admin";
    let answer: (value: typeof ET) => void = () => undefined;
    fetchCurrent.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    renderProvider();
    expect(screen.getByText("resolved: false")).toBeTruthy();

    answer(ET);
    expect(await screen.findByText("resolved: true")).toBeTruthy();
    expect(screen.getByText("material for ET")).toBeTruthy();
  });

  it("tells the admin area when the jurisdiction could not be loaded", async () => {
    pathname = "/admin";
    fetchCurrent.mockRejectedValue(new AccessApiError("down", 500));
    renderProvider();

    expect(await screen.findByText("resolved: true")).toBeTruthy();
  });

  it("gives the material the jurisdiction's wording and what it uses", async () => {
    mockPersona = inIac();
    fetchCurrent.mockResolvedValue(IAC);
    renderProvider();

    expect(await screen.findByText("material for IAC")).toBeTruthy();
    expect(screen.getByText("Hearing")).toBeTruthy();
    expect(screen.getByText("template: true")).toBeTruthy();
    expect(screen.getByText("recordings: true")).toBeTruthy();
    expect(screen.getByText("jurisdictions: IAC")).toBeTruthy();
  });

  it("uses neutral wording for anything a jurisdiction does not set", async () => {
    fetchCurrent.mockResolvedValue(ET);
    renderProvider();

    expect(await screen.findByText("material for ET")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.queryByText("Hearing")).toBeNull();
    expect(screen.getByText("template: false")).toBeTruthy();
    expect(screen.getByText("recordings: false")).toBeTruthy();
  });

  it("works with neutral material when the API has no material for this context", async () => {
    fetchCurrent.mockRejectedValue(new AccessApiError("Not found", 404));
    renderProvider();

    expect(await screen.findByText("resolved: true")).toBeTruthy();
    expect(screen.getByText("template: false")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers to try again when the jurisdiction cannot be loaded", async () => {
    fetchCurrent.mockRejectedValueOnce(new AccessApiError("network"));
    renderProvider();

    const retry = await screen.findByRole("button", { name: "Try again" });
    fetchCurrent.mockResolvedValue(IAC);
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
    fetchCurrent.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    );
    renderProvider();
    expect(screen.getByText("material for")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy(); // neutral, not anyone's wording
  });
});
