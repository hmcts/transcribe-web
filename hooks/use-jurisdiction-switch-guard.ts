import { useEffect, useRef } from "react";
import {
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
} from "@/lib/jurisdiction-switch";

/**
 * Stop a jurisdiction switch (DIAAT-332), which reloads the tab, while this
 * component is `busy` (a request in progress, which the reload would cancel)
 * or has `unsaved` changes (which the reload would lose).
 */
export function useJurisdictionSwitchGuard({
  busy,
  unsaved,
}: {
  busy: boolean;
  unsaved: boolean;
}): void {
  const state = useRef({ busy, unsaved });
  state.current = { busy, unsaved };
  useEffect(
    () =>
      onBeforeJurisdictionSwitch(async () => {
        if (state.current.busy) throw new JurisdictionSwitchError("busy");
        if (state.current.unsaved) {
          throw new JurisdictionSwitchError("unsaved_changes");
        }
      }),
    []
  );
}
