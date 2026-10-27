import { describe, expect, it } from "vitest";
import {
  RECORD_ALERT_PRIORITY,
  type RecordAlert,
  type RecordAlertKind,
  selectMostSevereAlert,
} from "@/lib/record-alerts";

function alertOf(kind: RecordAlertKind): RecordAlert {
  return {
    kind,
    severity: "error",
    heading: kind,
    body: kind,
    dismissible: false,
  };
}

describe("selectMostSevereAlert", () => {
  it("returns null when nothing is wrong", () => {
    expect(selectMostSevereAlert([])).toBeNull();
    expect(selectMostSevereAlert([null, undefined])).toBeNull();
  });

  it("returns the only alert when there is one", () => {
    const alert = alertOf("autosave-failing");
    expect(selectMostSevereAlert([null, alert, undefined])).toBe(alert);
  });

  it("prefers a capture failure over a save failure", () => {
    // The ordering rule that matters once DIAAT-296 lands: if nothing is
    // reaching the transcript there is nothing to save, so pointing the user at
    // the save path would send them looking in the wrong place.
    const capture = alertOf("speech-failed");
    const save = alertOf("autosave-failing");

    expect(selectMostSevereAlert([save, capture])).toBe(capture);
    expect(selectMostSevereAlert([capture, save])).toBe(capture);
  });

  it("prefers a live failure over one already survived", () => {
    const live = alertOf("autosave-failing");
    const historic = alertOf("speech-failed-earlier");

    expect(selectMostSevereAlert([historic, live])).toBe(live);
  });

  it("prefers re-authentication over a failing autosave", () => {
    // A failing autosave caused by an expired token is fixed by signing in
    // again, so that instruction has to be the one on screen.
    expect(
      selectMostSevereAlert([
        alertOf("autosave-failing"),
        alertOf("auth-expired"),
      ])?.kind
    ).toBe("auth-expired");
  });

  it("prefers a failing autosave over a failed restore lookup", () => {
    // A restore lookup that failed is a question we could not answer; a failing
    // autosave is work being lost as the user speaks. The live loss wins.
    expect(
      selectMostSevereAlert([
        alertOf("draft-restore-failed"),
        alertOf("autosave-failing"),
      ])?.kind
    ).toBe("autosave-failing");
  });

  it("prefers a failed restore lookup over the expiry warning", () => {
    // "We could not check for your draft" is actionable now; "your draft
    // expires in 3 hours" can wait behind it.
    expect(
      selectMostSevereAlert([
        alertOf("draft-expiring"),
        alertOf("draft-restore-failed"),
      ])?.kind
    ).toBe("draft-restore-failed");
  });

  it("prefers any active problem over the gap-check notice", () => {
    expect(
      selectMostSevereAlert([
        alertOf("speech-interrupted"),
        alertOf("speech-recovering"),
      ])?.kind
    ).toBe("speech-recovering");
  });

  it("is order-independent", () => {
    const kinds: RecordAlertKind[] = [
      "speech-interrupted",
      "draft-expiring",
      "speech-no-content",
      "autosave-failing",
    ];
    const forwards = selectMostSevereAlert(kinds.map(alertOf));
    const backwards = selectMostSevereAlert([...kinds].reverse().map(alertOf));

    expect(forwards?.kind).toBe(backwards?.kind);
    expect(forwards?.kind).toBe("speech-no-content");
  });

  it("gives every kind a distinct priority so ties cannot happen", () => {
    const priorities = Object.values(RECORD_ALERT_PRIORITY);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});
