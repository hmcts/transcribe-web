import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";

// DIAAT-332, DIAAT-390: a user with several roles switches from the header, and
// can leave a jurisdiction. The tab's work is saved first; if it cannot be, the
// tab stays where it is.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  postContext: vi.fn(),
  postLeaveJurisdiction: vi.fn(),
  postRefreshSession: vi.fn(),
}));
vi.mock("@/lib/access/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/api")>()),
  ...api,
}));

import { ContextSwitcher } from "@/components/access/context-switcher";
import { AccessApiError } from "@/lib/access/api";
import { getTabContext } from "@/lib/jurisdiction-session";
import {
  holdJurisdictionSwitch,
  isLeavingForJurisdictionSwitch,
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
  prepareForJurisdictionSwitch,
  stayInJurisdiction,
} from "@/lib/jurisdiction-switch";
import { AccessProvider } from "@/providers/access";

const assign = vi.fn();

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

async function openSwitcher(me: MeResponse = ME.multiAsAdministrator) {
  api.fetchMe.mockResolvedValue(me);
  render(
    <AccessProvider>
      <ContextSwitcher />
    </AccessProvider>
  );
  const trigger = await screen.findByRole("button", {
    name: /Working in .* as .*\. Switch or leave/,
  });
  // Radix opens its menu on pointer down.
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

const chooseJudge = async () =>
  act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name: /Employment Tribunal: Judge/ }));
  });

describe("switching context", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => undefined;
    pathname = "/";
    window.sessionStorage.clear();
    for (const fn of Object.values(api)) fn.mockReset();
    toastError.mockReset();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign, pathname });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stayInJurisdiction();
  });

  it("is not offered to a user with no role", async () => {
    api.fetchMe.mockResolvedValue(ME.sysadminOnly);
    render(
      <AccessProvider>
        <ContextSwitcher />
        <p>loaded</p>
      </AccessProvider>
    );
    await screen.findByText("loaded");
    expect(screen.queryByRole("button", { name: /Switch or leave/ })).toBeNull();
  });

  it("offers a user with one pair no other pair, only leaving and signing out", async () => {
    await openSwitcher(ME.judge);

    expect(screen.queryByRole("menuitem", { name: /: Jurisdiction/ })).toBeNull();
    expect(await screen.findByRole("menuitem", { name: "Leave Employment Tribunal" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("saves the tab's work, switches with the server, then reloads the tab in the new context", async () => {
    api.postContext.mockResolvedValue(ME.multiAsJudge);
    const order: string[] = [];
    const unregister = onBeforeJurisdictionSwitch(async () => {
      order.push("saved");
    });
    try {
      await openSwitcher();
      const before = getTabContext();
      await chooseJudge();

      await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
      // Saved before the switch, and again just before leaving.
      expect(order).toEqual(["saved", "saved"]);
      // Stays disabled while the tab reloads.
      expect(
        (screen.getByRole("button", { name: /Switch or leave/ }) as HTMLButtonElement).disabled
      ).toBe(true);
      expect(api.postContext).toHaveBeenCalledWith({ jurisdiction: "ET", role: "Judge" });
      // The tab keeps its old context until the document really reloads: the recorder's "leave this
      // page?" prompt can be cancelled, and a tab that had taken the new context would then autosave
      // its old page's work into it. Such a tab is refused by the API (409) and asks to reload.
      expect(getTabContext()).toEqual(before);
      expect(isLeavingForJurisdictionSwitch()).toBe(true);
    } finally {
      unregister();
    }
  });

  it("says the work is saved when only the switch failed", async () => {
    api.postContext.mockRejectedValue(new AccessApiError("Not yours", 403, "context_not_available"));
    await openSwitcher();
    await chooseJudge();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Your work is saved, but the change did not work"
    );
    expect(assign).not.toHaveBeenCalled();
    // Nothing changed: the tab still names the context it works in.
    expect(getTabContext()).toEqual({
      jurisdiction: "IAC",
      role: "JurisdictionAdministrator",
    });
  });

  it("waits for a submission in progress", async () => {
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new JurisdictionSwitchError("busy");
    });
    try {
      await openSwitcher();
      await chooseJudge();

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toBe(
        "Wait for what you are submitting, uploading or saving to finish, then switch."
      );
      expect(api.postContext).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("stays put, and says why, when the work cannot be saved", async () => {
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new Error("save failed");
    });
    try {
      await openSwitcher();
      await chooseJudge();

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain(
        "Your work could not be saved, so you are still working in Immigration and Asylum Chamber: Jurisdiction administrator"
      );
      expect(assign).not.toHaveBeenCalled();
      expect(api.postContext).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("stays on the Admin page when the new context may use it, and leaves it when not", async () => {
    pathname = "/admin";
    vi.stubGlobal("location", { ...window.location, assign, pathname });
    api.postContext.mockResolvedValue(ME.multiAsJudge);
    await openSwitcher();
    await chooseJudge();

    // A judge has no admin permission: home.
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });
});

describe("a switch whose final save fails", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => undefined;
    window.sessionStorage.clear();
    for (const fn of Object.values(api)) fn.mockReset();
    toastError.mockReset();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stayInJurisdiction();
  });

  it("puts the session's context back, as the user is told they have not moved", async () => {
    api.postContext.mockResolvedValue(ME.multiAsJudge);
    let saves = 0;
    const unregister = onBeforeJurisdictionSwitch(async () => {
      saves += 1;
      if (saves === 2) throw new Error("save failed");
    });
    try {
      await openSwitcher();
      await chooseJudge();

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain("you are still working in Immigration and Asylum Chamber");
      expect(api.postContext.mock.calls.map(([pair]) => pair)).toEqual([
        { jurisdiction: "ET", role: "Judge" },
        { jurisdiction: "IAC", role: "JurisdictionAdministrator" },
      ]);
      expect(assign).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("says what to do with work that is never saved", async () => {
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new JurisdictionSwitchError("unsaved");
    });
    try {
      await openSwitcher();
      await chooseJudge();

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain("Copy them out or remove them");
      expect(assign).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});

describe("leaving a jurisdiction (DIAAT-390)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => undefined;
    window.sessionStorage.clear();
    for (const fn of Object.values(api)) fn.mockReset();
    toastError.mockReset();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stayInJurisdiction();
  });

  it("asks first, then leaves with the server and reloads on the home page", async () => {
    api.postLeaveJurisdiction.mockResolvedValue(ME.judge);
    await openSwitcher();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Leave Immigration and Asylum Chamber" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("lose every role you hold in Immigration and Asylum Chamber");
    expect(api.postLeaveJurisdiction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(api.postLeaveJurisdiction).toHaveBeenCalledWith("IAC");
  });

  it("does nothing when the user cancels", async () => {
    await openSwitcher();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Leave Immigration and Asylum Chamber" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(api.postLeaveJurisdiction).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("work to finish before a switch", () => {
  it("runs every registered handler until it is unregistered", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const unregisterFirst = onBeforeJurisdictionSwitch(first);
    const unregisterSecond = onBeforeJurisdictionSwitch(second);

    await prepareForJurisdictionSwitch();
    unregisterFirst();
    await prepareForJurisdictionSwitch();
    unregisterSecond();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("stops a switch while held work runs, whether it succeeds or fails", async () => {
    let succeed: (value: string) => void = () => undefined;
    const held = holdJurisdictionSwitch(
      new Promise<string>((resolve) => {
        succeed = resolve;
      })
    );
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });
    succeed("saved");
    await expect(held).resolves.toBe("saved");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();

    let fail: (reason: Error) => void = () => undefined;
    const failing = holdJurisdictionSwitch(
      new Promise<never>((_, reject) => {
        fail = reject;
      })
    );
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });
    fail(new Error("refused"));
    await expect(failing).rejects.toThrow("refused");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });
});
