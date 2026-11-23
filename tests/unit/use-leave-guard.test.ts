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

  it("passes over its guard entry on the next Back once it stops guarding (DIAAT-414)", () => {
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, "confirm");
    const { rerender } = renderHook(
      ({ active }) => useLeaveGuard(active, "Leave?"),
      {
        initialProps: { active: true },
      }
    );

    rerender({ active: false });
    window.dispatchEvent(new PopStateEvent("popstate")); // lands on the guard entry
    expect(confirm).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1); // and leaves past it

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(back).toHaveBeenCalledTimes(1); // once only
  });

  it("guards again with the same entry when it is needed again", () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = renderHook(
      ({ active }) => useLeaveGuard(active, "Leave?"),
      {
        initialProps: { active: true },
      }
    );
    rerender({ active: false });
    rerender({ active: true });
    expect(push).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(back).not.toHaveBeenCalled(); // asked, and stayed
  });
});
