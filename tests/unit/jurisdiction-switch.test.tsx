import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ET, IAC } from "../jurisdiction-helpers";

// DIAAT-332: a judge in several jurisdictions switches from the header. The tab's
// work is saved first; if it cannot be, the tab stays where it is.

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { JurisdictionSwitcher } from "@/components/jurisdiction/jurisdiction-switcher";
import { apiClient } from "@/lib/api-client";
import { getTabJurisdiction } from "@/lib/jurisdiction-session";
import {
  isLeavingForJurisdictionSwitch,
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
  prepareForJurisdictionSwitch,
  stayInJurisdiction,
} from "@/lib/jurisdiction-switch";
import { JurisdictionProvider } from "@/providers/jurisdiction";

const assign = vi.fn();

function serve(jurisdictions = [IAC, ET]) {
  vi.mocked(apiClient.request).mockImplementation(async (endpoint) => {
    if (endpoint === "/jurisdictions/active") {
      return { data: { status: "ready", current: ET, jurisdictions } };
    }
    return { data: { status: "ready", current: IAC, jurisdictions } };
  });
}

async function openSwitcher() {
  render(
    <JurisdictionProvider>
      <JurisdictionSwitcher />
    </JurisdictionProvider>
  );
  const trigger = await screen.findByRole("button", {
    name: "Jurisdiction: Immigration and Asylum Chamber. Switch jurisdiction",
  });
  // Radix opens its menu on pointer down.
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

describe("switching jurisdiction", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(apiClient.request).mockReset();
    toastError.mockReset();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stayInJurisdiction();
  });

  it("is not offered to a judge in one jurisdiction", async () => {
    serve([IAC]);
    render(
      <JurisdictionProvider>
        <JurisdictionSwitcher />
        <p>loaded</p>
      </JurisdictionProvider>
    );
    await screen.findByText("loaded");
    expect(screen.queryByRole("button", { name: /switch jurisdiction/i })).toBeNull();
  });

  it("saves the tab's work, records the choice, then reloads the tab in the other jurisdiction", async () => {
    serve();
    const order: string[] = [];
    const unregister = onBeforeJurisdictionSwitch(async () => {
      order.push("saved");
    });
    try {
      await openSwitcher();
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
      });

      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith("/?switched-jurisdiction=ET")
      );
      // Saved before the switch, and again just before leaving.
      expect(order).toEqual(["saved", "saved"]);
      // Stays disabled while the tab reloads.
      expect(
        (screen.getByRole("button", { name: /switch jurisdiction/i }) as HTMLButtonElement).disabled
      ).toBe(true);
      expect(apiClient.request).toHaveBeenCalledWith("/jurisdictions/active", {
        method: "PUT",
        body: JSON.stringify({ code: "ET" }),
      });
      // Until it has reloaded, the tab's requests still name the IAC: a late
      // save cannot land in the ET.
      expect(getTabJurisdiction()).toBe("IAC");
      expect(isLeavingForJurisdictionSwitch()).toBe(true);
    } finally {
      unregister();
    }
  });

  it("says the work is saved when only the switch failed", async () => {
    vi.mocked(apiClient.request).mockImplementation(async (endpoint) => {
      // apiClient.request returns a refusal; it never throws.
      if (endpoint === "/jurisdictions/active") return { error: "Not one of your jurisdictions", status: 403 };
      return { data: { status: "ready", current: IAC, jurisdictions: [IAC, ET] } };
    });
    await openSwitcher();
    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain("Your work is saved, but the switch did not work");
    expect(assign).not.toHaveBeenCalled();
    expect(getTabJurisdiction()).toBe("IAC");
  });

  it("waits for a submission in progress", async () => {
    serve();
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new JurisdictionSwitchError("busy");
    });
    try {
      await openSwitcher();
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
      });

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toBe(
        "Wait for your submission or upload to finish, then switch jurisdiction."
      );
      expect(apiClient.request).not.toHaveBeenCalledWith("/jurisdictions/active", expect.anything());
    } finally {
      unregister();
    }
  });

  it("stays put, and says why, when the work cannot be saved", async () => {
    serve();
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new Error("save failed");
    });
    try {
      await openSwitcher();
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
      });

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain(
        "Your work could not be saved, so you are still working in Immigration and Asylum Chamber"
      );
      expect(assign).not.toHaveBeenCalled();
      expect(apiClient.request).not.toHaveBeenCalledWith("/jurisdictions/active", expect.anything());
      expect(getTabJurisdiction()).toBe("IAC");
    } finally {
      unregister();
    }
  });
});

describe("a switch whose final save fails", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(apiClient.request).mockReset();
    toastError.mockReset();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stayInJurisdiction();
  });

  it("puts the remembered choice back, as the user is told they have not moved", async () => {
    serve();
    let saves = 0;
    const unregister = onBeforeJurisdictionSwitch(async () => {
      saves += 1;
      if (saves === 2) throw new Error("save failed");
    });
    try {
      await openSwitcher();
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
      });

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain("you are still working in Immigration and Asylum Chamber");
      const chosen = vi
        .mocked(apiClient.request)
        .mock.calls.filter(([endpoint]) => endpoint === "/jurisdictions/active")
        .map(([, options]) => JSON.parse(String(options?.body)).code);
      expect(chosen).toEqual(["ET", "IAC"]);
      expect(assign).not.toHaveBeenCalled();
      expect(getTabJurisdiction()).toBe("IAC");
    } finally {
      unregister();
    }
  });

  it("says what to do with work that is never saved", async () => {
    serve();
    const unregister = onBeforeJurisdictionSwitch(async () => {
      throw new JurisdictionSwitchError("unsaved");
    });
    try {
      await openSwitcher();
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Employment Tribunal" }));
      });

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(String(toastError.mock.calls[0][0])).toContain("Copy them out or remove them");
      expect(assign).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
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
});

describe("a tab reloaded by a switch", () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset());

  it("ignores the parameter on a link, which no switch in this tab left", async () => {
    window.sessionStorage.setItem("benchnotes-jurisdiction", "IAC");
    window.history.replaceState(null, "", "/?switched-jurisdiction=ET");
    serve();
    render(
      <JurisdictionProvider>
        <p>loaded</p>
      </JurisdictionProvider>
    );

    await screen.findByText("loaded");
    expect(getTabJurisdiction()).toBe("IAC");
    expect(window.location.search).toBe("");
  });

  it("works in the jurisdiction it was reloaded with, and drops it from the address", async () => {
    window.sessionStorage.setItem("benchnotes-jurisdiction", "IAC");
    window.sessionStorage.setItem("benchnotes-switching-to", "ET");
    window.history.replaceState(null, "", "/?switched-jurisdiction=ET&id=abc");
    vi.mocked(apiClient.request).mockImplementation(async () => ({
      data: {
        status: "ready",
        current: getTabJurisdiction() === "ET" ? ET : IAC,
        jurisdictions: [IAC, ET],
      },
    }));
    render(
      <JurisdictionProvider>
        <p>loaded</p>
      </JurisdictionProvider>
    );

    await screen.findByText("loaded");
    expect(getTabJurisdiction()).toBe("ET");
    expect(window.location.search).toBe("?id=abc");
    window.history.replaceState(null, "", "/");
  });
});
