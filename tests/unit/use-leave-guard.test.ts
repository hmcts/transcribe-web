import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLeaveGuard } from "@/hooks/use-leave-guard";

describe("useLeaveGuard's history entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks on Back while guarding, and stays when the user says no", () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHook(() => useLeaveGuard(true, "Leave?"));
    expect(push).toHaveBeenCalledTimes(1); // the guard entry

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2); // back on the page
  });

  it("adds no history entry and leaves Back alone with history: false (DIAAT-414)", () => {
    const push = vi.spyOn(window.history, "pushState");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHook(() => useLeaveGuard(true, "Leave?", { history: false }));
    expect(push).not.toHaveBeenCalled();

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(confirm).not.toHaveBeenCalled();

    // A link in the app still asks.
    const link = document.createElement("a");
    link.href = "/help";
    document.body.appendChild(link);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(click);
    expect(confirm).toHaveBeenCalledWith("Leave?");
    expect(click.defaultPrevented).toBe(true);
    link.remove();
  });
});
