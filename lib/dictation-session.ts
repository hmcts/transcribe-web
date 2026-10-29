/**
 * Dictation session telemetry (OBS-4, DIAAT-278 / DIAAT-300).
 *
 * One dictation session (from the first start until it is submitted or the page
 * is left) is one journey, `dictation.session`, with a random UUID. Every event
 * goes through the relay (`lib/telemetry-relay`) and is validated against the
 * backend's allowlist (transcribe-api `runtime/browser_telemetry.py`): names, durations,
 * counts, controlled codes and IDs only, never transcript or form content.
 *
 * Timings carried as durations:
 * - `speech.session_started`: recording requested -> Speech SDK session ready;
 * - `speech.first_result`: recording requested -> first transcript text;
 * - `dictation.resume_first_result`: resume -> first text after it.
 *
 * A session starts when recording is first requested (restoring a draft,
 * autosave or a typed-only submission do not start one; their events then carry
 * no journey) and ends once, with `dictation.session_ended` and an outcome:
 * `dictation.no_transcript`, `autosave.failed`, `speech.unhealthy`,
 * `submission.failed`, or success.
 */

import {
  installRelayLifecycle,
  type RelayEvent,
  type TelemetryRelay,
  telemetryRelay,
} from "@/lib/telemetry-relay";

export const JOURNEY_DICTATION_SESSION = "dictation.session";

export type DictationEndReason = "submitted" | "page_hidden" | "left_page";
export type LiveDraftFailureKindName = "network" | "auth" | "server";

/** Speech SDK session IDs are 32 hex characters; anything else is left out. */
function speechSessionId(value: string | undefined): string | undefined {
  return value && /^[0-9a-fA-F]{32}$/.test(value) ? value : undefined;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers: RFC 4122 v4 layout from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

interface SessionState {
  id: string;
  startedAt: number;
  requestedAt: number;
  resumedAt: number | null;
  paused: boolean;
  firstResultSeen: boolean;
  segments: number;
  speechSessions: number;
  autosaveFailures: number;
  autosaveStalled: boolean;
  unhealthy: boolean;
  submissionFailed: boolean;
}

export interface DictationSessionTelemetry {
  recordingRequested(input: {
    sessionIndex: number;
    reconnectAttempt: number;
  }): void;
  tokenFetched(input: {
    ok: boolean;
    status?: number;
    durationMs: number;
  }): void;
  speechSessionStarted(input: {
    sessionId?: string;
    sessionIndex: number;
    reconnectAttempt: number;
  }): void;
  firstText(input: { sessionId?: string; sessionIndex: number }): void;
  segmentCaptured(): void;
  /** The user stopped recording (a pause until resumed, submitted or left). */
  recordingPaused(): void;
  speechSessionStopped(input: {
    sessionId?: string;
    sessionIndex: number;
    durationMs: number;
    segmentsCaptured: number;
    userInitiated: boolean;
  }): void;
  speechCanceled(input: {
    sessionId?: string;
    sessionIndex: number;
    reason: string;
    errorCode?: string;
    collapsesInWindow: number;
  }): void;
  speechUnhealthy(input: {
    collapsesInWindow: number;
    windowSeconds: number;
    reason?: string;
    errorCode?: string;
  }): void;
  noSpeechWarning(input: { elapsedSeconds: number }): void;
  autosaveFailed(input: {
    kind: LiveDraftFailureKindName;
    status?: number;
    consecutiveFailures: number;
    secondsSinceLastSave: number | null;
    trigger: string;
  }): void;
  autosaveStalled(input: {
    kind: LiveDraftFailureKindName;
    consecutiveFailures: number;
    secondsSinceLastSave: number | null;
  }): void;
  autosaveRecovered(input: {
    consecutiveFailures: number;
    outageSeconds: number;
  }): void;
  restoreFinished(input: {
    ok: boolean;
    kind?: LiveDraftFailureKindName;
    status?: number;
  }): void;
  submissionFinished(input: {
    ok: boolean;
    status?: number;
    /** Overrides the code derived from the status (e.g. an invalid response). */
    errorCode?: string;
    mode: string;
    transcriptionId?: string;
    durationMs: number;
  }): void;
  sessionEnded(reason: DictationEndReason): void;
  /** The event `sessionEnded("page_hidden")` would send now, without ending the
   * session (kept in case the page is killed while hidden). */
  pendingEnd(): RelayEvent | null;
  /** Forget the running session without an event (it was ended elsewhere). */
  discardSession(): void;
}

/**
 * The session's overall outcome. A transcript that was never captured is always
 * a failure. Otherwise a successful submission means nothing was lost, whatever
 * went wrong on the way (autosave, Speech, an earlier failed submission).
 */
function endEvent(
  state: SessionState,
  reason: DictationEndReason,
  at: number
): RelayEvent {
  let outcome: "success" | "failure" | "error" = "success";
  let code: string | undefined;
  if (state.segments === 0) {
    outcome = "failure";
    code = "dictation.no_transcript";
  } else if (reason !== "submitted") {
    if (state.autosaveStalled) {
      outcome = "error";
      code = "autosave.failed";
    } else if (state.unhealthy) {
      outcome = "error";
      code = "speech.unhealthy";
    } else if (state.submissionFailed) {
      outcome = "error";
      code = "submission.failed";
    }
  }
  return {
    name: "dictation.session_ended",
    attributes: {
      "hmcts.outcome": outcome,
      "hmcts.error.code": code,
      "dictation.end_reason": reason,
      "dictation.segments_captured": state.segments,
      "dictation.speech_sessions": state.speechSessions,
      "dictation.autosave_failures": state.autosaveFailures,
    },
    durationMs: at - state.startedAt,
    journey: { type: JOURNEY_DICTATION_SESSION, id: state.id },
  };
}

export function createDictationSessionTelemetry(
  relay: TelemetryRelay,
  now: () => number = Date.now,
  newId: () => string = randomId
): DictationSessionTelemetry {
  let session: SessionState | null = null;

  /** Start a session if none is running. Only a recording request does this. */
  const start = (): SessionState => {
    if (session === null) {
      const at = now();
      session = {
        id: newId(),
        startedAt: at,
        requestedAt: at,
        resumedAt: null,
        paused: false,
        firstResultSeen: false,
        segments: 0,
        speechSessions: 0,
        autosaveFailures: 0,
        autosaveStalled: false,
        unhealthy: false,
        submissionFailed: false,
      };
    }
    return session;
  };

  const emit = (
    name: string,
    attributes?: RelayEvent["attributes"],
    durationMs?: number,
    state: SessionState | null = session
  ) => {
    relay.emit({
      name,
      attributes,
      durationMs,
      journey: state
        ? { type: JOURNEY_DICTATION_SESSION, id: state.id }
        : undefined,
    });
  };

  return {
    recordingRequested({ sessionIndex, reconnectAttempt }) {
      const state = start();
      state.requestedAt = now();
      state.firstResultSeen = false;
      if (reconnectAttempt === 0 && state.paused) {
        state.paused = false;
        state.resumedAt = state.requestedAt;
        emit("dictation.resumed");
      }
      emit("dictation.session_requested", {
        "dictation.session_index": sessionIndex,
        "dictation.reconnect_attempt": reconnectAttempt,
      });
    },

    tokenFetched({ ok, status, durationMs }) {
      emit(
        "speech.token_fetched",
        ok
          ? { "hmcts.outcome": "success" }
          : {
              "hmcts.outcome": "error",
              "hmcts.error.code": status ? `http.${status}` : "network",
            },
        durationMs
      );
    },

    speechSessionStarted({ sessionId, sessionIndex, reconnectAttempt }) {
      const state = session;
      if (state) state.speechSessions += 1;
      emit(
        "speech.session_started",
        {
          "speech.session_id": speechSessionId(sessionId),
          "dictation.session_index": sessionIndex,
          "dictation.reconnect_attempt": reconnectAttempt,
        },
        state ? now() - state.requestedAt : undefined
      );
    },

    firstText({ sessionId, sessionIndex }) {
      // Timings are relative to the session's request: none without a session
      // (e.g. late results after the session was submitted).
      const state = session;
      if (state === null || state.firstResultSeen) return;
      state.firstResultSeen = true;
      const at = now();
      emit(
        "speech.first_result",
        {
          "speech.session_id": speechSessionId(sessionId),
          "dictation.session_index": sessionIndex,
        },
        at - state.requestedAt
      );
      if (state.resumedAt !== null) {
        emit("dictation.resume_first_result", undefined, at - state.resumedAt);
        state.resumedAt = null;
      }
    },

    segmentCaptured() {
      if (session) session.segments += 1;
    },

    recordingPaused() {
      const state = session;
      if (state === null || state.paused) return;
      state.paused = true;
      state.resumedAt = null;
      emit("dictation.paused");
    },

    speechSessionStopped({
      sessionId,
      sessionIndex,
      durationMs,
      segmentsCaptured,
      userInitiated,
    }) {
      emit(
        "speech.session_stopped",
        {
          "speech.session_id": speechSessionId(sessionId),
          "dictation.session_index": sessionIndex,
          "dictation.segments_captured": segmentsCaptured,
          "dictation.user_initiated": userInitiated,
        },
        durationMs
      );
    },

    speechCanceled({
      sessionId,
      sessionIndex,
      reason,
      errorCode,
      collapsesInWindow,
    }) {
      emit("speech.canceled", {
        "speech.session_id": speechSessionId(sessionId),
        "dictation.session_index": sessionIndex,
        "speech.cancel_reason": reason,
        "speech.error_code": errorCode,
        "dictation.collapses_in_window": collapsesInWindow,
      });
    },

    speechUnhealthy({ collapsesInWindow, windowSeconds, reason, errorCode }) {
      if (session) session.unhealthy = true;
      emit("speech.unhealthy", {
        "dictation.collapses_in_window": collapsesInWindow,
        "dictation.window_seconds": windowSeconds,
        "speech.cancel_reason": reason,
        "speech.error_code": errorCode,
      });
    },

    noSpeechWarning({ elapsedSeconds }) {
      emit("dictation.no_speech_warning", {
        "dictation.elapsed_seconds": elapsedSeconds,
      });
    },

    autosaveFailed({
      kind,
      status,
      consecutiveFailures,
      secondsSinceLastSave,
      trigger,
    }) {
      if (session) session.autosaveFailures += 1;
      emit("live_draft.save_failed", {
        "live_draft.failure_kind": kind,
        "http.response.status_code": status,
        "live_draft.consecutive_failures": consecutiveFailures,
        "live_draft.seconds_since_last_save": secondsSinceLastSave,
        "live_draft.trigger": trigger,
      });
    },

    autosaveStalled({ kind, consecutiveFailures, secondsSinceLastSave }) {
      if (session) session.autosaveStalled = true;
      emit("live_draft.autosave_stalled", {
        "live_draft.failure_kind": kind,
        "live_draft.consecutive_failures": consecutiveFailures,
        "live_draft.seconds_since_last_save": secondsSinceLastSave,
      });
    },

    autosaveRecovered({ consecutiveFailures, outageSeconds }) {
      if (session) session.autosaveStalled = false;
      emit("live_draft.save_recovered", {
        "live_draft.consecutive_failures": consecutiveFailures,
        "live_draft.outage_seconds": outageSeconds,
      });
    },

    restoreFinished({ ok, kind, status }) {
      emit(
        "live_draft.restore_finished",
        ok
          ? { "hmcts.outcome": "success" }
          : {
              "hmcts.outcome": kind === "auth" ? "failure" : "error",
              "hmcts.error.code": `live_draft.restore_${kind ?? "server"}`,
              "live_draft.failure_kind": kind,
              "http.response.status_code": status,
            }
      );
    },

    submissionFinished({
      ok,
      status,
      errorCode,
      mode,
      transcriptionId,
      durationMs,
    }) {
      const state = session;
      if (state) state.submissionFailed = !ok;
      emit(
        "dictation.submission_finished",
        ok
          ? {
              "hmcts.outcome": "success",
              "dictation.mode": mode,
              "dictation.transcription_id": transcriptionId,
            }
          : {
              "hmcts.outcome": status && status < 500 ? "failure" : "error",
              "hmcts.error.code":
                errorCode ?? (status ? `http.${status}` : "network"),
              "dictation.mode": mode,
              "http.response.status_code": status,
            },
        durationMs
      );
    },

    sessionEnded(reason) {
      const state = session;
      if (state === null) return; // nothing was recorded on this page
      session = null;
      relay.emit(endEvent(state, reason, now()));
    },

    pendingEnd() {
      return session === null ? null : endEvent(session, "page_hidden", now());
    },

    discardSession() {
      session = null;
    },
  };
}

export const dictationSessionTelemetry =
  createDictationSessionTelemetry(telemetryRelay);

export const PENDING_END_STORAGE_KEY = "hmcts-dictation-pending-end";
export const PAGE_ALIVE_STORAGE_KEY = "hmcts-dictation-alive";
/** A live page refreshes its heartbeat this often (hidden tabs run timers at
 * least once a minute; frozen or killed pages stop). */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** A page whose heartbeat is older than this is gone. */
const PAGE_GONE_AFTER_MS = 3 * 60_000;
/** Heartbeats older than this are removed regardless. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60_000;

interface StoredEnd {
  storedAt: number;
  event: RelayEvent;
}

function pageStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * End the dictation session when the page goes for good, then flush.
 *
 * `pagehide` is not reliable on mobile (a tab closed from the switcher, or a
 * killed app, may never fire it); `visibilitychange: hidden` is the last
 * reliable event, but it also fires on a tab switch, which does not end the
 * session. So on hidden the end event is stored under this page's ID, and
 * cleared if the page comes back or closes normally. Each live page keeps a
 * heartbeat; a later page (in any tab) sends a stored end only once its page's
 * heartbeat has stopped, so a merely hidden or duplicated tab is never ended by
 * another one.
 *
 * Returns a cleanup for React effects; the cleanup ends the session as "left_page".
 */
export function trackDictationPage(
  telemetry: DictationSessionTelemetry = dictationSessionTelemetry,
  relay: TelemetryRelay = telemetryRelay,
  storage: () => Storage | null = pageStorage,
  now: () => number = Date.now
): () => void {
  if (typeof window === "undefined") return () => undefined;
  installRelayLifecycle(relay);

  const pageId = randomId();
  const endKey = `${PENDING_END_STORAGE_KEY}:${pageId}`;
  const aliveKey = `${PAGE_ALIVE_STORAGE_KEY}:${pageId}`;
  let storedPending = false;

  const get = (key: string): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const set = (key: string, value: string) => {
    try {
      storage()?.setItem(key, value);
    } catch {
      // Best effort only.
    }
  };
  const remove = (key: string) => {
    try {
      storage()?.removeItem(key);
    } catch {
      // Best effort only.
    }
  };
  const heartbeat = () => {
    set(aliveKey, String(now()));
    // The session ended some other way (e.g. submitted) while hidden: the stored
    // end is no longer pending.
    if (storedPending && telemetry.pendingEnd() === null) {
      remove(endKey);
      storedPending = false;
    }
  };
  /** End here, unless another page already sent this session's end. */
  const endHere = (reason: DictationEndReason) => {
    if (storedPending && get(endKey) === null) telemetry.discardSession();
    else telemetry.sessionEnded(reason);
    remove(endKey);
    remove(aliveKey);
    storedPending = false;
  };

  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  // Ends left by pages that were killed while hidden (their heartbeat stopped).
  const keys: string[] = [];
  try {
    const store = storage();
    for (let i = 0; store && i < store.length; i++) {
      const key = store.key(i);
      if (key) keys.push(key);
    }
  } catch {
    // Storage unavailable: nothing to recover.
  }
  for (const key of keys) {
    try {
      if (key.startsWith(`${PAGE_ALIVE_STORAGE_KEY}:`)) {
        if (!(now() - Number(get(key)) < STALE_AFTER_MS)) remove(key);
        continue;
      }
      if (!key.startsWith(`${PENDING_END_STORAGE_KEY}:`) || key === endKey) {
        continue;
      }
      const otherAliveKey = `${PAGE_ALIVE_STORAGE_KEY}:${key.slice(PENDING_END_STORAGE_KEY.length + 1)}`;
      const lastBeat = Number(get(otherAliveKey));
      if (lastBeat > 0 && now() - lastBeat < PAGE_GONE_AFTER_MS) {
        continue; // that page is alive (hidden, or a duplicated tab)
      }
      const stored = JSON.parse(get(key) ?? "null") as StoredEnd | null;
      remove(key);
      remove(otherAliveKey);
      if (stored?.event?.name === "dictation.session_ended") {
        relay.emit(stored.event);
      }
    } catch {
      remove(key); // unreadable: never let one entry block the others
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      const pending = telemetry.pendingEnd();
      if (!pending) return;
      const stored: StoredEnd = { storedAt: now(), event: pending };
      set(endKey, JSON.stringify(stored));
      storedPending = get(endKey) !== null;
      return;
    }
    heartbeat();
    if (!storedPending) return;
    storedPending = false;
    if (get(endKey) !== null) remove(endKey);
    // Another page sent this session's end while this one was frozen.
    else telemetry.discardSession();
  };
  const onPageHide = (event: PageTransitionEvent) => {
    // persisted: the page may come back from the back/forward cache.
    if (!event.persisted) endHere("page_hidden");
    relay.flushOnHide();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    clearInterval(heartbeatTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
    endHere("left_page");
    void relay.flush();
  };
}
