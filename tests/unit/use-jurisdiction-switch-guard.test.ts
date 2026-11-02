import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";

// DIAAT-332: a switch reloads the tab; a component stops it while a request is in
// progress or it holds changes not saved, and not otherwise.

describe("useJurisdictionSwitchGuard", () => {
  it("stops a switch while busy, then while unsaved, and lets it through after", async () => {
    const { rerender, unmount } = renderHook((state) => useJurisdictionSwitchGuard(state), {
      initialProps: { busy: true, unsaved: true },
    });
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "busy" });

    rerender({ busy: false, unsaved: true });
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({ step: "unsaved_changes" });

    rerender({ busy: false, unsaved: false });
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();

    rerender({ busy: true, unsaved: false });
    unmount();
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });
});
