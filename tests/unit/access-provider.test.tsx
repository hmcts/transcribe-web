import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRequest, } from "@/lib/access/types";
import { ME } from "../access-helpers";

// DIAAT-373: who the user is and what they may do is loaded before anything
// else, and decides which screen they see.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  postContext: vi.fn(),
  postLeaveJurisdiction: vi.fn(),
  postRefreshSession: vi.fn(),
  fetchPublicJurisdictions: vi.fn(),
  fetchMyAccessRequests: vi.fn(),
  createAccessRequest: vi.fn(),
  withdrawAccessRequest: vi.fn(),
}));
vi.mock("@/lib/access/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/api")>()),
  ...api,
}));

import { AccessApiError } from "@/lib/access/api";
import { getTabContext, setTabContext } from "@/lib/jurisdiction-session";
import {
  onBeforeJurisdictionSwitch,
  stayInJurisdiction,
} from "@/lib/jurisdiction-switch";
import { AccessProvider, useAccess } from "@/providers/access";

function Probe() {
  const { status, can, active, assignments } = useAccess();
  return (
    <div>
      <p>status: {status}</p>
      <p>dictation: {String(can("dictation.use"))}</p>
      <p>admin: {String(can("admin.access"))}</p>
      <p>active: {active ? `${active.jurisdiction?.code ?? "-"}:${active.role}` : "none"}</p>
      <p>assignments: {assignments.length}</p>
    </div>
  );
}

function renderProvider() {
  return render(
    <AccessProvider>
      <Probe />
    </AccessProvider>
  );
}

const assign = vi.fn();

// Radix (the checkboxes and the jurisdiction menu) needs these in jsdom.
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  pathname = "/";
  window.sessionStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchPublicJurisdictions.mockResolvedValue([
    { code: "ET", name: "Employment Tribunal" },
    { code: "IAC", name: "Immigration and Asylum Chamber" },
  ]);
  api.fetchMyAccessRequests.mockResolvedValue([]);
  toast.success.mockReset();
  toast.error.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  stayInJurisdiction();
  window.sessionStorage.clear();
});

describe("loading who the user is", () => {
  it("shows nothing of the app until the API has answered", () => {
    api.fetchMe.mockReturnValue(new Promise(() => undefined));
    renderProvider();

    expect(screen.getByText("Loading your access...")).toBeTruthy();
    expect(screen.queryByText(/status:/)).toBeNull();
  });

  it.each([
    ["a judge", ME.judge, { dictation: "true", admin: "false", active: "ET:Judge", n: "1" }],
    [
      "a legal text manager",
      ME.legalTextManager,
      { dictation: "false", admin: "true", active: "IAC:LegalTextManager", n: "1" },
    ],
    [
      "a super administrator, whose role has no jurisdiction",
      ME.jurisdictionSuperAdministrator,
      { dictation: "false", admin: "true", active: "-:JurisdictionSuperAdministrator", n: "1" },
    ],
    [
      "a system administrator acting as one",
      ME.sysadminOnly,
      { dictation: "false", admin: "true", active: "-:SystemAdministrator", n: "1" },
    ],
    [
      "a system administrator who also holds roles, acting as a judge (DIAAT-403)",
      ME.sysadminMultiAsJudge,
      { dictation: "true", admin: "false", active: "ET:Judge", n: "3" },
    ],
  ])("lets %s in, with exactly the permissions the API returned", async (_n, me, want) => {
    api.fetchMe.mockResolvedValue(me);
    renderProvider();

    expect(await screen.findByText("status: ready")).toBeTruthy();
    expect(screen.getByText(`dictation: ${want.dictation}`)).toBeTruthy();
    expect(screen.getByText(`admin: ${want.admin}`)).toBeTruthy();
    expect(screen.getByText(`active: ${want.active}`)).toBeTruthy();
    expect(screen.getByText(`assignments: ${want.n}`)).toBeTruthy();
  });

  it("grants nothing the API did not list", async () => {
    api.fetchMe.mockResolvedValue({ ...ME.judge, permissions: ["app.access"] });
    renderProvider();

    expect(await screen.findByText("dictation: false")).toBeTruthy();
  });

  it("asks who this is without naming a context, then works in the one the API says", async () => {
    setTabContext({ jurisdiction: "IAC", role: "Stale" });
    let named: unknown = "not called";
    api.fetchMe.mockImplementation(async () => {
      named = getTabContext();
      return ME.judge;
    });
    renderProvider();

    await screen.findByText("status: ready");
    expect(named).toBeNull();
    expect(getTabContext()).toEqual({ jurisdiction: "ET", role: "Judge" });
  });

  it("names no context for a user who has not chosen one", async () => {
    setTabContext({ jurisdiction: "ET", role: "Judge" });
    api.fetchMe.mockResolvedValue(ME.choose);
    renderProvider();

    await screen.findByRole("heading", { name: /Choose where and as what/ });
    expect(getTabContext()).toBeNull();
  });

  it("offers to try again when the API cannot be reached", async () => {
    api.fetchMe.mockRejectedValueOnce(new AccessApiError("network"));
    renderProvider();

    const retry = await screen.findByRole("button", { name: "Try again" });
    api.fetchMe.mockResolvedValue(ME.judge);
    fireEvent.click(retry);
    expect(await screen.findByText("status: ready")).toBeTruthy();
  });

  it("renders pages that are nobody's material without a working context", () => {
    pathname = "/privacy";
    api.fetchMe.mockReturnValue(new Promise(() => undefined));
    renderProvider();

    expect(screen.getByText("status: loading")).toBeTruthy();
  });
});

describe("a user who must choose, on an approval link (DIAAT-396)", () => {
  it("lands on the link as it was, tab and request included, once they have chosen", async () => {
    vi.stubGlobal("location", {
      ...window.location,
      assign,
      pathname: "/admin",
      search: "?tab=approvals&request=r1",
    });
    api.fetchMe.mockResolvedValue(ME.choose);
    api.postContext.mockResolvedValue(ME.multiAsAdministrator);
    renderProvider();

    await userEvent.click(
      await screen.findByRole("button", { name: /Immigration and Asylum Chamber as/ })
    );

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin?tab=approvals&request=r1"));
  });
});

describe("a user who must choose (DIAAT-390)", () => {
  it("is shown every pair, and nothing else, until they choose", async () => {
    api.fetchMe.mockResolvedValue(ME.choose);
    renderProvider();

    expect(
      await screen.findByRole("heading", { name: "Choose where and as what you are working" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Employment Tribunal as judge/ })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Immigration and Asylum Chamber as jurisdiction administrator/,
      })
    ).toBeTruthy();
    expect(screen.queryByText(/status:/)).toBeNull();
  });

  it("saves the tab's work, chooses the pair with the server, then reloads on the home page", async () => {
    api.fetchMe.mockResolvedValue(ME.choose);
    api.postContext.mockResolvedValue(ME.multiAsAdministrator);
    const order: string[] = [];
    const unregister = onBeforeJurisdictionSwitch(async () => {
      order.push("saved");
    });
    try {
      renderProvider();
      await userEvent.click(
        await screen.findByRole("button", { name: /Immigration and Asylum Chamber as/ })
      );

      await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
      expect(api.postContext).toHaveBeenCalledWith({
        jurisdiction: "IAC",
        role: "JurisdictionAdministrator",
      });
      expect(order).toEqual(["saved", "saved"]);
      // Chosen with the server, but this tab takes the context only when it has reloaded (a cancelled
      // reload must not leave it saving into the new one): it had none, and still has none.
      expect(getTabContext()).toBeNull();
    } finally {
      unregister();
    }
  });

  it("says so, and lets them choose again, when the choice fails", async () => {
    api.fetchMe.mockResolvedValue(ME.choose);
    api.postContext.mockRejectedValue(new AccessApiError("no", 403, "context_not_available"));
    renderProvider();

    await userEvent.click(
      await screen.findByRole("button", { name: /Employment Tribunal as/ })
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Employment Tribunal as/ }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("a user with no access yet (DIAAT-384, DIAAT-396)", () => {
  it("is shown the request form, and nothing else", async () => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    renderProvider();

    expect(
      await screen.findByRole("heading", { name: "You do not have access to BenchNotes yet" })
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ask for access" })).toBeTruthy();
    expect(screen.queryByText(/status:/)).toBeNull();
    expect(api.fetchPublicJurisdictions).toHaveBeenCalled();
  });

  it("sends a request for the jurisdiction and roles chosen, then lists it as pending", async () => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    const created: AccessRequest = {
      id: "r-1",
      jurisdiction: { code: "ET", name: "Employment Tribunal" },
      roles: ["Judge", "LegalTextManager"],
      status: "pending",
      created_at: "2026-11-09T10:00:00Z",
      decided_at: null,
      reason: null,
    };
    api.createAccessRequest.mockResolvedValue(created);
    renderProvider();
    const user = userEvent.setup();

    const send = await screen.findByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("combobox", { name: "Jurisdiction" }));
    await user.click(await screen.findByRole("option", { name: "Employment Tribunal" }));
    await user.click(screen.getByRole("checkbox", { name: /^Judge/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Legal text manager/ }));
    api.fetchMyAccessRequests.mockResolvedValue([created]);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(api.createAccessRequest).toHaveBeenCalledWith({
        jurisdiction: "ET",
        roles: ["Judge", "LegalTextManager"],
      })
    );
    expect(await screen.findByRole("heading", { name: "Request pending" })).toBeTruthy();
    expect(screen.getByText(/Employment Tribunal: Judge, Legal text manager/)).toBeTruthy();
  });

  it("shows the API's reason when a request is refused", async () => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    api.createAccessRequest.mockRejectedValue(
      new AccessApiError("You already asked for this.", 409)
    );
    renderProvider();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("combobox", { name: "Jurisdiction" }));
    await user.click(await screen.findByRole("option", { name: "Employment Tribunal" }));
    await user.click(screen.getByRole("checkbox", { name: /^Judge/ }));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect((await screen.findByRole("alert")).textContent).toBe("You already asked for this.");
  });

  it.each([
    ["too_many_pending_requests", 409, "You already have 5 requests waiting to be decided: withdraw one first.", /Withdraw one of them, then ask again/],
    ["jurisdiction_not_found", 404, "There is no such jurisdiction.", /There is no such jurisdiction\./],
  ])("says plainly what to do for a refusal with code %s", async (code, status, apiMessage, shown) => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    api.createAccessRequest.mockRejectedValue(new AccessApiError(apiMessage, status, code));
    renderProvider();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("combobox", { name: "Jurisdiction" }));
    await user.click(await screen.findByRole("option", { name: "Employment Tribunal" }));
    await user.click(screen.getByRole("checkbox", { name: /^Judge/ }));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(shown);
  });

  it("lists pending requests, withdraws one, and shows decided ones as such", async () => {
    const pending: AccessRequest = {
      id: "r-2",
      jurisdiction: { code: "IAC", name: "Immigration and Asylum Chamber" },
      roles: ["Judge"],
      status: "pending",
      created_at: "2026-11-09T10:00:00Z",
      decided_at: null,
      reason: null,
    };
    const rejected: AccessRequest = {
      ...pending,
      id: "r-3",
      status: "rejected",
      reason: "Not a member of this tribunal.",
    };
    api.fetchMe.mockResolvedValue({ ...ME.noAccess, pending_requests: [pending] });
    api.fetchMyAccessRequests.mockResolvedValue([pending, rejected]);
    api.withdrawAccessRequest.mockResolvedValue({ ...pending, status: "withdrawn" });
    renderProvider();

    expect(await screen.findByRole("heading", { name: "Request pending" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Earlier requests" })).toBeTruthy();
    expect(screen.getByText("Not a member of this tribunal.")).toBeTruthy();

    api.fetchMyAccessRequests.mockResolvedValue([{ ...pending, status: "withdrawn" }, rejected]);
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Withdraw request for Immigration and Asylum Chamber/,
      })
    );
    await waitFor(() => expect(api.withdrawAccessRequest).toHaveBeenCalledWith("r-2"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Request pending" })).toBeNull());
  });

  it("checks again, and moves on once a request has been approved", async () => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    api.postRefreshSession.mockResolvedValue(ME.judge);
    renderProvider();

    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));

    expect(await screen.findByText("status: ready")).toBeTruthy();
    expect(getTabContext()).toEqual({ jurisdiction: "ET", role: "Judge" });
  });

  it("says nothing has changed when the check finds nothing", async () => {
    api.fetchMe.mockResolvedValue(ME.noAccess);
    api.postRefreshSession.mockResolvedValue(ME.noAccess);
    renderProvider();

    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));

    await waitFor(() => expect(toast.message).toHaveBeenCalledWith("Nothing has changed yet."));
    expect(screen.queryByText(/status:/)).toBeNull();
  });
});

describe("checking again while a switch is under way (DIAAT-406)", () => {
  function SwitchThenCheck() {
    const { assignments, switchContext, checkAgain } = useAccess();
    const [checked, setChecked] = useState("");
    const target = assignments.find((a) => a.role === "JurisdictionAdministrator");
    return (
      <div>
        <button type="button" onClick={() => target && void switchContext(target).catch(() => undefined)}>
          switch
        </button>
        <button
          type="button"
          onClick={async () => setChecked((await checkAgain())?.active?.role ?? "none")}
        >
          check
        </button>
        <p>checked: {checked}</p>
      </div>
    );
  }

  it("does not refresh the session, so the context the switch chose is kept", async () => {
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/", search: "" });
    api.fetchMe.mockResolvedValue(ME.multiAsAdministrator);
    let finish: (me: unknown) => void = () => undefined;
    api.postContext.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(
      <AccessProvider>
        <SwitchThenCheck />
      </AccessProvider>
    );

    await userEvent.click(await screen.findByRole("button", { name: "switch" }));
    await userEvent.click(screen.getByRole("button", { name: "check" }));

    expect(await screen.findByText(/checked: \S/)).toBeTruthy();
    expect(api.postRefreshSession).not.toHaveBeenCalled();
    finish(ME.multiAsAdministrator);
    await waitFor(() => expect(assign).toHaveBeenCalled());
  });
});

describe("a browser that is not signed in", () => {
  it("is offered the seeded personas in local development", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "true");
    api.fetchMe.mockRejectedValue(new AccessApiError("no", 401));
    renderProvider();

    expect(await screen.findByRole("heading", { name: "Sign in as a persona" })).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /judge-et/ })[0].getAttribute("href")
    ).toContain("/auth/dev-login?persona=judge-et");
  });

  it("is not offered personas without dev login mode", async () => {
    api.fetchMe.mockRejectedValue(new AccessApiError("no", 401));
    renderProvider();

    expect(await screen.findByText(/You are not signed in|Signing you in/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in as a persona" })).toBeNull();
    expect(screen.queryByTestId("dev-persona-picker")).toBeNull();
  });

  it("is never offered personas in a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "true");
    vi.stubEnv("NODE_ENV", "production");
    api.fetchMe.mockRejectedValue(new AccessApiError("no", 401));
    renderProvider();

    await screen.findByText(/You are not signed in|Signing you in/);
    expect(screen.queryByRole("heading", { name: "Sign in as a persona" })).toBeNull();
  });
});

describe("a tab whose context was changed elsewhere (409 context_changed)", () => {
  it("asks to reload, rather than reloading and losing what is typed", async () => {
    api.fetchMe.mockResolvedValue(ME.judge);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload, assign });
    renderProvider();
    await screen.findByText("status: ready");

    await act(async () => {
      const response = await fetch("/api/anything");
      expect(response.status).toBe(409);
    });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload this tab" }));
    expect(reload).toHaveBeenCalled();
    // The tab keeps its old context until the document really reloads: the recorder's "leave this
    // page?" prompt can be cancelled, and a tab without its context headers would then save into
    // the other tab's new context. The reloaded page adopts the session's (load clears it).
    expect(getTabContext()).toEqual({ jurisdiction: "ET", role: "Judge" });
  });

  it("is not triggered by a 409 for anything else", async () => {
    api.fetchMe.mockResolvedValue(ME.judge);
    renderProvider();
    await screen.findByText("status: ready");

    await act(async () => {
      await fetch("/api/other-conflict");
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("other-conflict")
          ? new Response(JSON.stringify({ detail: { code: "edit_conflict" } }), { status: 409 })
          : new Response(JSON.stringify({ detail: { code: "context_changed" } }), { status: 409 })
      )
    );
  });
});

describe("refusals about who the user is (the API's 403 codes, DIAAT-373)", () => {
  const refuse = (code: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: { code, message: "x" } }), { status: 403 }))
    );

  it("shows that the account was deactivated, with a way to sign out, when the API says so", async () => {
    api.fetchMe.mockResolvedValue(ME.judge);
    refuse("user_deactivated"); // before the provider, which watches fetch as it finds it
    renderProvider();
    await screen.findByText("status: ready");

    await act(async () => {
      await fetch("/api/anything");
    });

    expect(await screen.findByRole("heading", { name: "Your account has been deactivated" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign out" }).getAttribute("href")).toBe("/auth/logout");
    expect(screen.queryByText("status: ready")).toBeNull();
  });

  it("shows the deactivated screen, not 'could not load', when asking who this is is refused", async () => {
    api.fetchMe.mockRejectedValue(new AccessApiError("This account has been deactivated.", 403, "user_deactivated"));
    renderProvider();

    expect(await screen.findByRole("heading", { name: "Your account has been deactivated" })).toBeTruthy();
    expect(screen.queryByText("BenchNotes could not load")).toBeNull();
  });

  it("asks who the user is again when the session has no context but this tab thinks it has one", async () => {
    api.fetchMe.mockResolvedValueOnce(ME.judge);
    refuse("context_required");
    renderProvider();
    await screen.findByText("status: ready");

    api.fetchMe.mockResolvedValue(ME.choose);
    await act(async () => {
      await fetch("/api/anything");
    });

    expect(await screen.findByRole("heading", { name: /Choose where and as what/ })).toBeTruthy();
    expect(api.fetchMe).toHaveBeenCalledTimes(2);
  });

  it("does not ask again when this tab already knows it has no context", async () => {
    api.fetchMe.mockResolvedValue(ME.choose);
    refuse("context_required");
    renderProvider();
    await screen.findByRole("heading", { name: /Choose where and as what you are working/ });

    await act(async () => {
      await fetch("/api/anything");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(api.fetchMe).toHaveBeenCalledTimes(1);
  });
});
