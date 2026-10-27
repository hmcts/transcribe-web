import { describe, expect, it } from "vitest";
import {
  getAutosaveRetryDelayMs,
  INITIAL_AUTOSAVE_STATE,
  isAutosaveFailing,
  isDraftNearingExpiry,
  LIVE_DRAFT_MAX_AGE_HOURS,
  millisecondsUntilDraftExpiry,
  recordAutosaveFailure,
  recordAutosaveSuccess,
} from "@/lib/autosave-state";

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

describe("autosave state transitions", () => {
  it("starts with nothing saved and nothing failing", () => {
    expect(INITIAL_AUTOSAVE_STATE.lastSavedAt).toBeNull();
    expect(INITIAL_AUTOSAVE_STATE.consecutiveFailures).toBe(0);
    expect(INITIAL_AUTOSAVE_STATE.failureKind).toBeNull();
    expect(INITIAL_AUTOSAVE_STATE.failingSince).toBeNull();
  });

  it("records the time of a successful save", () => {
    const next = recordAutosaveSuccess(T0);
    expect(next.lastSavedAt).toBe(T0);
  });

  it("counts consecutive failures and remembers the kind", () => {
    let state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "network", T0);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.failureKind).toBe("network");

    state = recordAutosaveFailure(state, "auth", T0 + 1000);
    expect(state.consecutiveFailures).toBe(2);
    // The most recent kind wins â€” an auth failure that follows a network blip
    // needs the re-authentication message, not the network one.
    expect(state.failureKind).toBe("auth");
  });

  it("anchors failingSince to the first failure of the run", () => {
    let state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "network", T0);
    state = recordAutosaveFailure(state, "network", T0 + 5000);
    state = recordAutosaveFailure(state, "network", T0 + 9000);
    expect(state.failingSince).toBe(T0);
  });

  it("clears the whole failure run once a save succeeds", () => {
    let state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "network", T0);
    state = recordAutosaveFailure(state, "network", T0 + 1000);
    state = recordAutosaveSuccess(T0 + 2000);

    expect(state.consecutiveFailures).toBe(0);
    expect(state.failureKind).toBeNull();
    expect(state.failingSince).toBeNull();
    expect(state.lastSavedAt).toBe(T0 + 2000);
  });

  it("keeps the previous successful save time while failing", () => {
    let state = recordAutosaveSuccess(T0);
    state = recordAutosaveFailure(state, "network", T0 + 3000);
    // The judge still needs to know how much work is at risk, which is
    // everything since this timestamp.
    expect(state.lastSavedAt).toBe(T0);
  });
});

describe("isAutosaveFailing", () => {
  it("stays quiet after a single blip so one dropped packet is not an alarm", () => {
    const state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "network", T0);
    expect(isAutosaveFailing(state)).toBe(false);
  });

  it("reports failing once a retry has also failed", () => {
    let state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "network", T0);
    state = recordAutosaveFailure(state, "network", T0 + 1000);
    expect(isAutosaveFailing(state)).toBe(true);
  });

  it("reports an auth failure immediately, because no retry will fix it", () => {
    const state = recordAutosaveFailure(INITIAL_AUTOSAVE_STATE, "auth", T0);
    expect(isAutosaveFailing(state)).toBe(true);
  });

  it("is false with no failures at all", () => {
    expect(isAutosaveFailing(INITIAL_AUTOSAVE_STATE)).toBe(false);
  });
});

describe("getAutosaveRetryDelayMs", () => {
  it("backs off exponentially from one second", () => {
    expect(getAutosaveRetryDelayMs(1)).toBe(1_000);
    expect(getAutosaveRetryDelayMs(2)).toBe(2_000);
    expect(getAutosaveRetryDelayMs(3)).toBe(4_000);
    expect(getAutosaveRetryDelayMs(4)).toBe(8_000);
  });

  it("caps the delay so a long outage still retries regularly", () => {
    expect(getAutosaveRetryDelayMs(10)).toBe(30_000);
    expect(getAutosaveRetryDelayMs(100)).toBe(30_000);
  });

  it("treats a non-positive attempt count as the first attempt", () => {
    expect(getAutosaveRetryDelayMs(0)).toBe(1_000);
    expect(getAutosaveRetryDelayMs(-1)).toBe(1_000);
  });
});

describe("draft expiry", () => {
  it("mirrors the backend's 24h _LIVE_DRAFT_MAX_AGE", () => {
    expect(LIVE_DRAFT_MAX_AGE_HOURS).toBe(24);
  });

  it("counts down from the last save, not from now", () => {
    const savedAt = new Date(T0).toISOString();
    expect(millisecondsUntilDraftExpiry(savedAt, T0 + HOUR)).toBe(23 * HOUR);
  });

  it("reports a fresh draft as not nearing expiry", () => {
    const savedAt = new Date(T0).toISOString();
    expect(isDraftNearingExpiry(savedAt, T0 + HOUR)).toBe(false);
  });

  it("warns once the draft is inside the last few hours of its life", () => {
    const savedAt = new Date(T0).toISOString();
    expect(isDraftNearingExpiry(savedAt, T0 + 21 * HOUR)).toBe(true);
  });

  it("still warns for a draft already past its expiry, which reads as gone", () => {
    const savedAt = new Date(T0).toISOString();
    expect(isDraftNearingExpiry(savedAt, T0 + 30 * HOUR)).toBe(true);
  });

  it("does not warn on an unparseable timestamp", () => {
    expect(isDraftNearingExpiry("not-a-date", T0)).toBe(false);
  });
});
