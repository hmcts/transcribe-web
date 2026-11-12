import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ET_REF, IAC_REF, ME, SSCS_REF } from "../access-helpers";

// DIAAT-406: a user who already holds roles asks for access to another jurisdiction,
// or another role in one of theirs, with the same request as a user with none.

let persona: MeResponse = ME.manyJurisdictions;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => persona)
);
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({
  fetchPublicJurisdictions: vi.fn(),
  fetchMyAccessRequests: vi.fn(),
  createAccessRequest: vi.fn(),
  withdrawAccessRequest: vi.fn(),
}));
vi.mock("@/lib/access/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/api")>()),
  ...api,
}));

import RequestAccessPage from "@/app/request-access/page";
import { AccessApiError } from "@/lib/access/api";

class ResizeObserverStub {
  observe() {
    /* not needed in jsdom */
  }
  unobserve() {
    /* not needed in jsdom */
  }
  disconnect() {
    /* not needed in jsdom */
  }
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => undefined;

async function choose(jurisdiction: string) {
  const user = userEvent.setup();
  render(<RequestAccessPage />);
  await user.click(
    await screen.findByRole("combobox", { name: "Jurisdiction" })
  );
  await user.click(await screen.findByRole("option", { name: jurisdiction }));
  return user;
}

const checkbox = (name: RegExp) =>
  screen.getByRole("checkbox", { name }) as HTMLButtonElement;

describe("asking for more access while holding roles (DIAAT-406)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    persona = ME.manyJurisdictions;
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchPublicJurisdictions.mockResolvedValue([
      ET_REF,
      IAC_REF,
      SSCS_REF,
      { code: "UT", name: "Upper Tribunal" },
    ]);
    api.fetchMyAccessRequests.mockResolvedValue([]);
  });

  it("asks for roles in a jurisdiction the user is not in yet", async () => {
    api.createAccessRequest.mockResolvedValue({
      id: "r-1",
      jurisdiction: { code: "UT", name: "Upper Tribunal" },
      roles: ["Judge", "LegalTextManager"],
      status: "pending",
      created_at: "2026-11-12T10:00:00Z",
      decided_at: null,
      reason: null,
    });
    const user = await choose("Upper Tribunal");
    await user.click(checkbox(/^Judge/));
    await user.click(checkbox(/^Legal text manager/));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(api.createAccessRequest).toHaveBeenCalledWith({
        jurisdiction: "UT",
        roles: ["Judge", "LegalTextManager"],
      })
    );
  });

  it("does not offer a role the user already holds in that jurisdiction", async () => {
    const user = await choose("Immigration and Asylum Chamber");

    expect(checkbox(/^Judge \(you have this role there\)/).disabled).toBe(true);
    expect(checkbox(/^Legal text manager/).disabled).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Send request",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    await user.click(checkbox(/^Legal text manager/));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() =>
      expect(api.createAccessRequest).toHaveBeenCalledWith({
        jurisdiction: "IAC",
        roles: ["LegalTextManager"],
      })
    );
  });

  it("has nothing left to ask for where the user holds both roles", async () => {
    await choose("Employment Tribunal");

    expect(checkbox(/^Judge/).disabled).toBe(true);
    expect(checkbox(/^Legal text manager/).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Send request",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("says plainly that a role is already held, if the API answers 409 already_assigned", async () => {
    api.createAccessRequest.mockRejectedValue(
      new AccessApiError("Already assigned", 409, "already_assigned")
    );
    const user = await choose("Upper Tribunal");
    await user.click(checkbox(/^Judge/));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "You already have that role in that jurisdiction"
    );
  });

  it("lists the user's pending requests, which they can withdraw", async () => {
    api.fetchMyAccessRequests.mockResolvedValue([
      {
        id: "r-2",
        jurisdiction: { code: "UT", name: "Upper Tribunal" },
        roles: ["Judge"],
        status: "pending",
        created_at: "2026-11-12T10:00:00Z",
        decided_at: null,
        reason: null,
      },
    ]);
    render(<RequestAccessPage />);

    expect(
      await screen.findByRole("heading", { name: "Request pending" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Withdraw request for Upper Tribunal",
      })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });
});
