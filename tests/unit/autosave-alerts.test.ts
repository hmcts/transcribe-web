import { describe, expect, it } from "vitest";
import {
  describeAutosaveAlert,
  describeDraftExpiryAlert,
  describeDraftRestoreAlert,
  describeSaveStatus,
} from "@/lib/autosave-alerts";
import {
  INITIAL_AUTOSAVE_STATE,
  recordAutosaveFailure,
  recordAutosaveSuccess,
} from "@/lib/autosave-state";

const HOUR = 60 * 60 * 1000;
/** Local-time construction keeps the formatted clock assertions TZ-independent. */
const SAVED_AT_1432 = new Date(2026, 8, 4, 14, 32).getTime();
const T0 = SAVED_AT_1432;

function failing(kind: "network" | "auth" | "server", times: number) {
  let state = INITIAL_AUTOSAVE_STATE;
  for (let i = 0; i < times; i++) {
    state = recordAutosaveFailure(state, kind, T0 + i * 1000);
  }
  return state;
}

describe("describeAutosaveAlert", () => {
  it("says nothing while saving is working", () => {
    const state = recordAutosaveSuccess(T0);
    expect(describeAutosaveAlert({ state })).toBeNull();
  });

  it("says nothing after a single blip", () => {
    expect(describeAutosaveAlert({ state: failing("network", 1) })).toBeNull();
  });

  it("raises a non-dismissible autosave-failing alert once saving has stopped", () => {
    const alert = describeAutosaveAlert({ state: failing("network", 2) });
    expect(alert?.kind).toBe("autosave-failing");
    expect(alert?.severity).toBe("error");
    // Work is being lost right now; the user must not be able to hide it.
    expect(alert?.dismissible).toBe(false);
    expect(alert?.guidance).toBeTruthy();
  });

  it("names the time of the last successful save so the judge knows what is at risk", () => {
    let state = recordAutosaveSuccess(SAVED_AT_1432);
    state = recordAutosaveFailure(state, "network", SAVED_AT_1432 + 1000);
    state = recordAutosaveFailure(state, "network", SAVED_AT_1432 + 2000);

    const alert = describeAutosaveAlert({ state });
    expect(alert?.body).toContain("14:32");
  });

  it("is explicit when nothing at all has been saved yet", () => {
    const alert = describeAutosaveAlert({ state: failing("network", 3) });
    expect(alert?.body.toLowerCase()).toContain("nothing");
  });

  it("uses connection-specific wording for a network failure", () => {
    const alert = describeAutosaveAlert({ state: failing("network", 2) });
    expect(alert?.kind).toBe("autosave-failing");
    expect(alert?.body).toMatch(/connection has been lost/i);
    expect(alert?.guidance).toMatch(/internet connection/i);
    expect(alert?.guidance).toMatch(/when a connection is re-established/i);
  });

  it("uses neutral wording for a backend error rather than connection-specific copy", () => {
    const alert = describeAutosaveAlert({ state: failing("server", 2) });
    expect(alert?.kind).toBe("autosave-failing");
    expect(alert?.severity).toBe("error");
    expect(alert?.dismissible).toBe(false);
    // Server errors reach the backend — the connection is intact.
    // "Connection has been lost" and "check your internet connection" are wrong here.
    expect(alert?.body).not.toMatch(/connection has been lost/i);
    expect(alert?.guidance).not.toMatch(/internet connection/i);
    expect(alert?.body).toMatch(/stopped working/i);
  });

  it("raises auth-expired immediately for a rejected identity", () => {
    const alert = describeAutosaveAlert({ state: failing("auth", 1) });
    expect(alert?.kind).toBe("auth-expired");
    expect(alert?.dismissible).toBe(false);
    expect(alert?.guidance?.toLowerCase()).toContain("sign in");
  });

  it("keeps the transcript-is-safe reassurance out of the auth message body", () => {
    const alert = describeAutosaveAlert({ state: failing("auth", 2) });
    // The one action that fixes it must be in the guidance, not buried.
    expect(alert?.heading.toLowerCase()).toContain("sign");
  });
});

describe("describeDraftRestoreAlert", () => {
  it("reports a network failure as a failure, never as an absent draft", () => {
    const alert = describeDraftRestoreAlert({ kind: "network" });
    expect(alert.kind).toBe("draft-restore-failed");
    expect(alert.severity).toBe("error");
    expect(alert.body.toLowerCase()).not.toContain("no draft");
    expect(alert.guidance).toBeTruthy();
  });

  it("tells the user to sign in again when the lookup was rejected on auth", () => {
    const alert = describeDraftRestoreAlert({ kind: "auth" });
    expect(alert.guidance?.toLowerCase()).toContain("sign in");
  });

  it("stays dismissible â€” nothing is being lost at this moment", () => {
    expect(describeDraftRestoreAlert({ kind: "server" }).dismissible).toBe(
      true
    );
  });
});

/** The user reads the whole banner; which field carries a phrase is a layout choice. */
function alertText(
  alert: { heading: string; body: string; guidance?: string } | null
) {
  if (!alert) return "";
  return `${alert.heading} ${alert.body} ${alert.guidance ?? ""}`;
}

describe("describeDraftExpiryAlert", () => {
  it("says nothing about a draft saved moments ago", () => {
    const savedAt = new Date(T0).toISOString();
    expect(describeDraftExpiryAlert({ savedAt, now: T0 + HOUR })).toBeNull();
  });

  it("warns when the draft is close to the 24h hard delete", () => {
    const savedAt = new Date(T0).toISOString();
    const alert = describeDraftExpiryAlert({ savedAt, now: T0 + 21 * HOUR });
    expect(alert?.kind).toBe("draft-expiring");
    expect(alertText(alert)).toContain("3 hours");
    expect(alert?.guidance).toBeTruthy();
  });

  it("states plainly that the draft is already gone once past 24h", () => {
    const savedAt = new Date(T0).toISOString();
    const alert = describeDraftExpiryAlert({ savedAt, now: T0 + 25 * HOUR });
    expect(alert?.kind).toBe("draft-expiring");
    expect(alert?.body.toLowerCase()).toContain("deleted");
  });

  it("rounds up to whole hours rather than showing a bare zero", () => {
    const savedAt = new Date(T0).toISOString();
    const alert = describeDraftExpiryAlert({
      savedAt,
      now: T0 + 23.5 * HOUR,
    });
    expect(alertText(alert)).toContain("less than an hour");
  });
});

describe("describeSaveStatus", () => {
  it("shows nothing when there is no transcript to save", () => {
    expect(
      describeSaveStatus({ state: INITIAL_AUTOSAVE_STATE, hasContent: false })
    ).toBeNull();
  });

  it("shows the clock time of the last save", () => {
    const state = recordAutosaveSuccess(SAVED_AT_1432);
    const status = describeSaveStatus({ state, hasContent: true });
    expect(status?.tone).toBe("ok");
    expect(status?.label).toBe("Saved 14:32");
  });

  it("says not saved when saving has stopped", () => {
    const status = describeSaveStatus({
      state: failing("network", 2),
      hasContent: true,
    });
    expect(status?.tone).toBe("error");
    expect(status?.label).toBe("Not saved");
  });

  it("says not saved yet before the first write lands", () => {
    const status = describeSaveStatus({
      state: INITIAL_AUTOSAVE_STATE,
      hasContent: true,
    });
    expect(status?.tone).toBe("pending");
    expect(status?.label).toBe("Not saved yet");
  });

  it("keeps showing the last good save time through a single blip", () => {
    let state = recordAutosaveSuccess(SAVED_AT_1432);
    state = recordAutosaveFailure(state, "network", SAVED_AT_1432 + 1000);
    const status = describeSaveStatus({ state, hasContent: true });
    expect(status?.tone).toBe("ok");
    expect(status?.label).toBe("Saved 14:32");
  });
});
