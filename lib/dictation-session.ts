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
 * - `dictation.resume_first_result`: resume -> first text after it;
 * - `speech.session_stopped`: Speech session length (the realtime audio usage of
 *   OBS-5). Every Speech session that started is stopped exactly once: by a
 *   pause or a collapse (the hook), or, if still running when the dictation
 *   session ends (submitted, page left) or the hook unmounts, here, just before
 *   the end, with `speech.stop_reason` "submitted", "page_exit" or "teardown".
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
/** Why a Speech session stopped (`speech.stop_reason`, allowed values in
 * transcribe-api's telemetry contract, runtime/telemetry_schema.py). */
export type SpeechStopReason =
  | "paused"
  | "collapsed"
  | "submitted"
  | "page_exit"
  | "teardown";

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

/** The Speech session running now (started, not yet stopped). */
interface ActiveSpeechSession {
  sessionId?: string;
  sessionIndex: number;
  startedAt: number;
  segments: number;
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
  /** A saved draft was restored into this page: the transcript has content even
   * if this session captured no new speech. */
  restoredContent: boolean;
  speech: ActiveSpeechSession | null;
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
  /** `stoppedSession`: from a recognizer that is stopping, so not counted for
   * the running Speech session. */
  segmentCaptured(input?: { stoppedSession?: boolean }): void;
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
    durationMs: number;
  }): void;
  sessionEnded(reason: DictationEndReason): void;
  /** The running Speech session went away without a pause or a collapse (the hook
   * unmounted): stop it now, if it is still running. */
  speechSessionTornDown(): void;
  /** The event `sessionEnded("page_hidden")` would send now, without ending the
   * session (kept in case the page is killed while hidden). */
  pendingEnd(): RelayEvent | null;
  /** The `speech.session_stopped` that `sessionEnded("page_hidden")` would send
   * before it now, for a Speech session still running (else null). */
  pendingSpeechStop(): RelayEvent | null;
  /** Forget the running session without an event (it was ended elsewhere and the
   * page is going away). */
  discardSession(): void;
  /** Its end was sent elsewhere but the page is back (a frozen tab): carry on
   * under a new journey ID, so later events and the submission still have one.
   * Counts are kept, so the outcome still reflects the whole dictation. */
  continueAsNewSession(): void;
  /** The running session's journey ID, sent with the submission so the server can
   * relate it to the transcription it creates. */
  currentSessionId(): string | null;
}

function speechStopReason(reason: DictationEndReason): SpeechStopReason {
  return reason === "submitted" ? "submitted" : "page_exit";
}

function speechStopEvent(
  state: SessionState,
  speech: ActiveSpeechSession,
  reason: SpeechStopReason,
  at: number
): RelayEvent {
  return {
    name: "speech.session_stopped",
    attributes: {
      "speech.session_id": speechSessionId(speech.sessionId),
      "dictation.session_index": speech.sessionIndex,
      "dictation.segments_captured": speech.segments,
      "dictation.user_initiated": false,
      "speech.stop_reason": reason,
    },
    durationMs: Math.max(0, at - speech.startedAt),
    journey: { type: JOURNEY_DICTATION_SESSION, id: state.id },
  };
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
  let outcome: "success" | "failure" | "error" | "cancelled" = "success";
  let code: string | undefined;
  if (state.segments === 0 && !state.restoredContent) {
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
    } else {
      // Left without submitting: not a success, and not a service failure (the
      // draft may be restored later, which starts a new session).
      outcome = "cancelled";
      code = "dictation.not_submitted";
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
  /** A draft was restored on this page (it applies to the sessions that follow). */
  let pageHasRestoredContent = false;
  /** The last Speech session stopped here (not by the hook): the hook's own later
   * stop for it, if any, is not a second session. */
  let finalisedSpeechIndex: number | null = null;
  /** The last session on this page ended with a submission. */
  let submittedOnPage = false;

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
        restoredContent: pageHasRestoredContent,
        speech: null,
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
      // The recognizer can still reconnect between a submission and leaving the
      // page; that is not a new dictation. Only the user starts one again.
      if (session === null && submittedOnPage && reconnectAttempt > 0) return;
      submittedOnPage = false;
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
              // As elsewhere: a 4xx (signed out, wrong role) is a failure, not
              // an error counted against the service.
              "hmcts.outcome": status && status < 500 ? "failure" : "error",
              "hmcts.error.code": status ? `http.${status}` : "network",
            },
        durationMs
      );
    },

    speechSessionStarted({ sessionId, sessionIndex, reconnectAttempt }) {
      const state = session;
      if (state) {
        state.speechSessions += 1;
        state.speech = {
          sessionId,
          sessionIndex,
          startedAt: now(),
          segments: 0,
        };
      }
      finalisedSpeechIndex = null;
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

    segmentCaptured(input) {
      if (session) session.segments += 1;
      if (session?.speech && !input?.stoppedSession)
        session.speech.segments += 1;
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
      const speech = session?.speech;
      let duration = durationMs;
      if (speech && speech.sessionIndex === sessionIndex) {
        // Only the time not reported yet (see continueAsNewSession).
        duration = Math.min(durationMs, Math.max(0, now() - speech.startedAt));
        if (session) session.speech = null;
      } else if (finalisedSpeechIndex === sessionIndex) {
        return; // already stopped when the dictation session ended
      }
      emit(
        "speech.session_stopped",
        {
          "speech.session_id": speechSessionId(sessionId),
          "dictation.session_index": sessionIndex,
          "dictation.segments_captured": segmentsCaptured,
          "dictation.user_initiated": userInitiated,
          "speech.stop_reason": userInitiated ? "paused" : "collapsed",
        },
        duration
      );
    },

    speechSessionTornDown() {
      const state = session;
      const speech = state?.speech;
      if (!state || !speech) return;
      state.speech = null;
      finalisedSpeechIndex = speech.sessionIndex;
      relay.emit(speechStopEvent(state, speech, "teardown", now()));
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
      if (ok) {
        pageHasRestoredContent = true;
        if (session) session.restoredContent = true;
      }
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

    submissionFinished({ ok, status, errorCode, mode, durationMs }) {
      const state = session;
      if (state) state.submissionFailed = !ok;
      emit(
        "dictation.submission_finished",
        ok
          ? {
              "hmcts.outcome": "success",
              "dictation.mode": mode,
            }
          : {
              "hmcts.outcome": status && status < 500 ? "failure" : "error",
              // "network" only when the request itself failed (set by the caller);
              // with no status otherwise, the browser failed before or after the
              // request (validation, sign-in token, reading the response).
              "hmcts.error.code":
                errorCode ??
                (status ? `http.${status}` : "submission.client_error"),
              "dictation.mode": mode,
              "http.response.status_code": status,
            },
        durationMs
      );
    },

    sessionEnded(reason) {
      // A submitted draft is deleted, and a restore belongs to the page it was made
      // on: either way later sessions start without restored content. Reset before
      // the early return, so a restore submitted without recording is cleared too.
      if (reason !== "page_hidden") pageHasRestoredContent = false;
      if (reason === "submitted") submittedOnPage = true;
      const state = session;
      if (state === null) return; // nothing was recorded on this page
      session = null;
      const at = now();
      // The Speech session still running is part of this journey: stop it first,
      // so its time is counted (OBS-5). Not a pause.
      if (state.speech) {
        finalisedSpeechIndex = state.speech.sessionIndex;
        relay.emit(
          speechStopEvent(state, state.speech, speechStopReason(reason), at)
        );
      }
      relay.emit(endEvent(state, reason, at));
    },

    pendingEnd() {
      return session === null ? null : endEvent(session, "page_hidden", now());
    },

    pendingSpeechStop() {
      return session?.speech
        ? speechStopEvent(
            session,
            session.speech,
            speechStopReason("page_hidden"),
            now()
          )
        : null;
    },

    discardSession() {
      // Its end, and the stop of its Speech session, were sent elsewhere.
      if (session?.speech) finalisedSpeechIndex = session.speech.sessionIndex;
      session = null;
    },

    continueAsNewSession() {
      if (session === null) return;
      const at = now();
      // The Speech session's time so far was sent with the end: count only what
      // follows under the new journey.
      const speech = session.speech
        ? { ...session.speech, startedAt: at, segments: 0 }
        : null;
      session = { ...session, id: newId(), startedAt: at, speech };
    },

    currentSessionId() {
      return session?.id ?? null;
    },
  };
}

export const dictationSessionTelemetry =
  createDictationSessionTelemetry(telemetryRelay);

/**
 * Browser telemetry for every page (mounted once from the root layout): the
 * relay's page-hide flush and restore of unsent events, and the ends of
 * dictations whose page was killed while hidden. Idempotent.
 */
export function startBrowserTelemetry(
  relay: TelemetryRelay = telemetryRelay
): void {
  if (typeof window === "undefined") return;
  installRelayLifecycle(relay);
  recoverStaleEnds(relay);
}

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
  /** The running Speech session's stop, sent before the end (OBS-5). */
  speechStop?: RelayEvent;
}

function storedEnd(
  telemetry: DictationSessionTelemetry,
  event: RelayEvent,
  storedAt: number
): StoredEnd {
  const speechStop = telemetry.pendingSpeechStop() ?? undefined;
  return speechStop ? { storedAt, event, speechStop } : { storedAt, event };
}

function pageStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Send the session ends stored by pages that were killed while hidden (their
 * heartbeat stopped), and forget stale heartbeats. Run by every page (from
 * startBrowserTelemetry) and by the dictation page; `ownEndKey` is skipped.
 */
export function recoverStaleEnds(
  relay: TelemetryRelay = telemetryRelay,
  storage: () => Storage | null = pageStorage,
  now: () => number = Date.now,
  ownEndKey?: string
): void {
  const get = (key: string): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const remove = (key: string) => {
    try {
      storage()?.removeItem(key);
    } catch {
      // Best effort only.
    }
  };
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
      if (!key.startsWith(`${PENDING_END_STORAGE_KEY}:`) || key === ownEndKey) {
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
        if (stored.speechStop?.name === "speech.session_stopped") {
          relay.emit(stored.speechStop);
        }
        relay.emit(stored.event);
      }
    } catch {
      remove(key); // unreadable: never let one entry block the others
    }
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
    if (!storedPending) return;
    const pending = telemetry.pendingEnd();
    if (pending === null) {
      // The session ended some other way (e.g. submitted) while hidden: the
      // stored end is no longer pending.
      remove(endKey);
      storedPending = false;
    } else if (get(endKey) !== null) {
      // Still dictating while hidden: keep the stored end current (counts and
      // duration), in case the page is killed. Only while it is still stored: if
      // another page has sent it, recreating it would hide that from the
      // visibility handler and lead to a second end for the same journey.
      set(endKey, JSON.stringify(storedEnd(telemetry, pending, now())));
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

  recoverStaleEnds(relay, storage, now, endKey);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      const pending = telemetry.pendingEnd();
      if (!pending) return;
      set(endKey, JSON.stringify(storedEnd(telemetry, pending, now())));
      storedPending = get(endKey) !== null;
      return;
    }
    heartbeat();
    if (!storedPending) return;
    storedPending = false;
    if (get(endKey) !== null) remove(endKey);
    // Another page sent this session's end while this one was frozen: the
    // dictation may still be running, so continue under a new journey.
    else telemetry.continueAsNewSession();
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
