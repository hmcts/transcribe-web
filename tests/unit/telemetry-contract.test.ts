/**
 * Cross-repo contract (DIAAT-205): every event this app sends through the relay
 * must be accepted by transcribe-api whole. The relay refuses an event that is not
 * a registered browser event, an analytics event without consent, a journey other
 * than the browser's own; it silently drops an attribute that is not allowed for
 * the event or fails its rule. A mismatch shows up only as missing data in
 * Application Insights.
 *
 * tests/fixtures/telemetry-contract.json is a pinned copy of transcribe-api's
 * telemetry-contract.json (its merged schema as JSON); the commit it came from is
 * in telemetry-contract.source. Refresh both after the API's schema changes:
 *   scripts/update-telemetry-contract.sh ../transcribe-api
 *
 * The rules below mirror hmcts-otel (schema.AttributeSpec.check and the relay's
 * request model). Its redactor is approximated by the three rules a controlled
 * value could plausibly trip (email, JWT, bearer token).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const relayed = vi.hoisted(() => ({ events: [] as unknown[], consent: false }));
vi.mock("@/lib/telemetry-relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telemetry-relay")>()),
  telemetryRelay: { emit: (event: unknown) => relayed.events.push(event) },
}));
vi.mock("@/lib/analytics-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics-consent")>()),
  hasAnalyticsConsent: () => relayed.consent,
}));

import { type AnalyticsEventName, track } from "@/lib/analytics";
import { CONSENT_COOKIE_NAME } from "@/lib/analytics-consent";
import { createBrowserFailures } from "@/lib/browser-failures";
import {
  createDictationSessionTelemetry,
  type DictationEndReason,
  JOURNEY_DICTATION_SESSION,
} from "@/lib/dictation-session";
import {
  type RelayEvent,
  type TelemetryRelay,
  toWire,
  type WireEvent,
} from "@/lib/telemetry-relay";
import { SAMPLES } from "./analytics-samples";

interface AttributeSpec {
  type: "str" | "int" | "float" | "bool";
  allowed_values: string[] | null;
  pattern: string | null;
  max_length: number;
}
interface EventSpec {
  attributes: string[];
  browser: boolean;
  class: "operational" | "analytics";
}
interface Contract {
  events: Record<string, EventSpec>;
  attributes: Record<string, AttributeSpec>;
}

const ROOT = join(__dirname, "..", "..");
const contract: Contract = JSON.parse(
  readFileSync(join(ROOT, "tests/fixtures/telemetry-contract.json"), "utf8")
);

/** The journeys a browser may attach (transcribe-api runtime/browser_telemetry.py). */
const BROWSER_JOURNEYS = new Set(["dictation.session"]);
/** hmcts-otel is_valid_request_id: a canonical UUID or 32 hex characters. */
const JOURNEY_ID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;
const REDACTION: [string, RegExp][] = [
  [
    "email",
    /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/,
  ],
  [
    "jwt",
    /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){1,2}|\beyJ[A-Za-z0-9_-]{13,}/,
  ],
  ["bearer", /\bbearer\s{1,8}[A-Za-z0-9._~+/-]{16,}=*/i],
];

/** What the relay would refuse or drop for this event as sent (empty when accepted whole). */
function problems(event: WireEvent): string[] {
  const spec = contract.events[event.name];
  if (event.name.length > 100) return [`${event.name}: name too long`];
  if (!spec) return [`${event.name}: not registered`];
  if (!spec.browser) return [`${event.name}: not a browser event`];
  const found: string[] = [];
  if (event.journey) {
    if (!BROWSER_JOURNEYS.has(event.journey.type))
      found.push(`${event.name}: journey ${event.journey.type} refused`);
    if (!JOURNEY_ID.test(event.journey.id))
      found.push(`${event.name}: journey id ${event.journey.id} refused`);
  }
  const attributes = Object.entries(event.attributes ?? {});
  if (attributes.length > 32) found.push(`${event.name}: over 32 attributes`);
  for (const [key, value] of attributes) {
    const where = `${event.name}: ${key}=${JSON.stringify(value)}`;
    const rule = contract.attributes[key];
    if (!spec.attributes.includes(key) || !rule) {
      found.push(`${where} not allowed for the event`);
      continue;
    }
    const typeOk =
      rule.type === "bool"
        ? typeof value === "boolean"
        : rule.type === "int"
          ? Number.isInteger(value)
          : rule.type === "float"
            ? typeof value === "number"
            : typeof value === "string";
    if (!typeOk) {
      found.push(`${where} is not ${rule.type}`);
      continue;
    }
    if (typeof value !== "string") continue;
    if (value.length > rule.max_length) found.push(`${where} too long`);
    if (rule.allowed_values && !rule.allowed_values.includes(value))
      found.push(`${where} not an allowed value`);
    if (rule.pattern && !new RegExp(`^(?:${rule.pattern})$`).test(value))
      found.push(`${where} does not match ${rule.pattern}`);
    for (const [name, pattern] of REDACTION)
      if (pattern.test(value)) found.push(`${where} redacted (${name})`);
  }
  return found;
}

const checkAll = (events: RelayEvent[]) =>
  events.map((event) => toWire(event)).flatMap(problems);

describe("the pinned contract", () => {
  it("is transcribe-api's, with its source commit recorded", () => {
    expect(Object.keys(contract.events).length).toBeGreaterThan(50);
    expect(contract.events["dictation.session_ended"]?.browser).toBe(true);
    const source = readFileSync(
      join(ROOT, "tests/fixtures/telemetry-contract.source"),
      "utf8"
    );
    expect(source).toMatch(/^transcribe-api [0-9a-f]{7,40}\n$/);
  });
});

describe("every event this app sends is accepted whole", () => {
  it("in the analytics fixture (lib/analytics, from call-site values)", () => {
    const events: RelayEvent[] = JSON.parse(
      readFileSync(join(ROOT, "tests/fixtures/analytics-events.json"), "utf8")
    );
    expect(events.length).toBeGreaterThanOrEqual(30);
    expect(checkAll(events)).toEqual([]);
  });

  it("without consent only for operational events, and with consent for all", () => {
    const sent = (consent: boolean) => {
      relayed.events.length = 0;
      relayed.consent = consent;
      for (const name of Object.keys(SAMPLES) as AnalyticsEventName[])
        track(name, SAMPLES[name] as never);
      return new Set((relayed.events as RelayEvent[]).map((e) => e.name));
    };
    const withConsent = sent(true);
    expect(relayed.events).toHaveLength(Object.keys(SAMPLES).length);
    const withoutConsent = sent(false);
    const mismatched = [...withConsent].filter(
      (name) =>
        withoutConsent.has(name) !==
        (contract.events[name]?.class === "operational")
    );
    // Sent without consent but analytics (refused), or held back but operational.
    expect(mismatched).toEqual([]);
  });

  it("in a dictation session that goes through every path (lib/dictation-session)", () => {
    const events: RelayEvent[] = [];
    const relay = {
      emit: (event: RelayEvent) => events.push(event),
    } as unknown as TelemetryRelay;
    let clock = 1_000;
    const now = () => {
      clock += 250;
      return clock;
    };
    const sdk = "0123456789abcdef0123456789abcdef";
    const t = createDictationSessionTelemetry(relay, now);

    const run = (end: DictationEndReason) => {
      t.restoreFinished({ ok: true });
      for (const kind of ["network", "auth", "server", undefined] as const)
        t.restoreFinished({ ok: false, kind, status: kind ? 401 : undefined });
      t.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
      t.tokenFetched({ ok: true, durationMs: 120 });
      t.tokenFetched({ ok: false, status: 503, durationMs: 80 });
      t.tokenFetched({ ok: false, durationMs: 80 }); // network
      t.speechSessionStarted({
        sessionId: sdk,
        sessionIndex: 1,
        reconnectAttempt: 0,
      });
      t.firstText({ sessionId: sdk, sessionIndex: 1 });
      t.segmentCaptured();
      t.segmentCaptured({ stoppedSession: true });
      // The SDK's CancellationReason names, and the hook's own.
      for (const reason of [
        "Error",
        "EndOfStream",
        "CancelledByUser",
        "StartFailed",
        "Unknown",
      ]) {
        for (const errorCode of ["ConnectionFailure", undefined]) {
          t.speechCanceled({
            sessionId: sdk,
            sessionIndex: 1,
            reason,
            errorCode,
            collapsesInWindow: 2,
          });
        }
      }
      t.speechSessionStopped({
        sessionId: sdk,
        sessionIndex: 1,
        durationMs: 5_000,
        segmentsCaptured: 1,
        userInitiated: false,
      });
      t.speechUnhealthy({
        collapsesInWindow: 3,
        windowSeconds: 120,
        reason: "Error",
        errorCode: "ConnectionFailure",
      });
      t.noSpeechWarning({ elapsedSeconds: 60 });
      t.recordingRequested({ sessionIndex: 2, reconnectAttempt: 1 });
      t.speechSessionStarted({
        sessionId: sdk,
        sessionIndex: 2,
        reconnectAttempt: 1,
      });
      t.recordingPaused();
      t.speechSessionStopped({
        sessionId: sdk,
        sessionIndex: 2,
        durationMs: 3_000,
        segmentsCaptured: 0,
        userInitiated: true,
      });
      t.recordingRequested({ sessionIndex: 3, reconnectAttempt: 0 }); // resume
      t.speechSessionStarted({
        sessionId: sdk,
        sessionIndex: 3,
        reconnectAttempt: 0,
      });
      t.firstText({ sessionId: sdk, sessionIndex: 3 });
      for (const kind of ["network", "auth", "server"] as const) {
        for (const trigger of [
          "interval",
          "pause",
          "late-finalisation",
          "retry",
          "unmount",
        ]) {
          t.autosaveFailed({
            kind,
            status: kind === "network" ? undefined : 500,
            consecutiveFailures: 2,
            secondsSinceLastSave: 30,
            trigger,
          });
        }
        t.autosaveStalled({
          kind,
          consecutiveFailures: 3,
          secondsSinceLastSave: null,
        });
      }
      t.autosaveRecovered({ consecutiveFailures: 3, outageSeconds: 40 });
      for (const mode of ["mic", "screen", "upload"]) {
        for (const status of [400, 413, 503]) {
          t.submissionFinished({ ok: false, status, mode, durationMs: 900 });
        }
        for (const errorCode of [
          "network",
          "submission.invalid_response",
          undefined,
        ]) {
          t.submissionFinished({ ok: false, errorCode, mode, durationMs: 900 });
        }
        t.submissionFinished({ ok: true, mode, durationMs: 900 });
      }
      t.sessionEnded(end);
    };
    for (const end of ["submitted", "page_hidden", "left_page"] as const)
      run(end);
    // Speech stopped by the hook unmounting (teardown).
    t.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    t.speechSessionStarted({
      sessionId: sdk,
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
    t.speechSessionTornDown();
    // An empty dictation ends as a failure.
    t.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    t.sessionEnded("left_page");

    const names = new Set(events.map((event) => event.name));
    for (const expected of [
      "dictation.session_requested",
      "speech.token_fetched",
      "speech.session_started",
      "speech.first_result",
      "dictation.resume_first_result",
      "speech.canceled",
      "speech.session_stopped",
      "speech.unhealthy",
      "dictation.no_speech_warning",
      "dictation.paused",
      "dictation.resumed",
      "live_draft.save_failed",
      "live_draft.autosave_stalled",
      "live_draft.save_recovered",
      "live_draft.restore_finished",
      "dictation.submission_finished",
      "dictation.session_ended",
    ])
      expect(names).toContain(expected);
    expect(
      events.every(
        (e) => !e.journey || e.journey.type === JOURNEY_DICTATION_SESSION
      )
    ).toBe(true);
    expect(checkAll(events)).toEqual([]);
  });

  it("names only registered browser events in the source, with allowed attributes", () => {
    // Catches an event the scripted session above does not reach. Attributes are
    // read up to the next event, as quoted dotted keys (helpers and spreads are
    // covered by the session above, not here).
    const text = [
      "lib/dictation-session.ts",
      "lib/analytics.ts",
      "lib/browser-failures.ts",
    ]
      .map((file) => readFileSync(join(ROOT, file), "utf8"))
      .join("\n");
    const calls = text.split(/emit\(|name: (?=")/).slice(1);
    const checked = new Set<string>();
    const found: string[] = [];
    for (const call of calls) {
      const name = call.match(/^\s*"([a-z][a-z0-9_.]*)"/)?.[1];
      if (!name) continue; // emit(name, ...), emit(endEvent(...)) and similar
      checked.add(name);
      const spec = contract.events[name];
      if (!spec?.browser) {
        found.push(`${name}: not a registered browser event`);
        continue;
      }
      for (const [, attribute] of call.matchAll(
        /"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)":/g
      )) {
        if (!spec.attributes.includes(attribute))
          found.push(`${name}: ${attribute} would be dropped`);
      }
    }
    expect(found).toEqual([]);
    expect(checked.size).toBeGreaterThan(40);
    expect(checked).toContain("dictation.session_ended");
    expect(checked).toContain("page.viewed");
  });
});

describe("browser failures are accepted whole (lib/browser-failures)", () => {
  it("in every form the app sends", () => {
    const events: RelayEvent[] = [];
    const failures = createBrowserFailures(
      { emit: (event: RelayEvent) => events.push(event) },
      () => 0,
      () => "/record"
    );
    for (const source of [
      "render",
      "window_error",
      "unhandled_rejection",
    ] as const)
      failures.clientError(new TypeError("x"), source, "1234567890");
    failures.clientError("not an error", "unhandled_rejection");
    const recording = new Blob([new Uint8Array(4)], { type: "audio/webm" });
    const upload = new File([new Uint8Array(4)], "a.mp3", {
      type: "audio/mpeg",
    });
    for (const code of [
      "upload.network",
      "upload.timeout",
      "upload.url_unavailable",
      "upload.error",
    ])
      failures.transferFailed({ code, file: recording, attempt: 2 });
    failures.transferFailed({
      code: "http.503",
      status: 503,
      file: upload,
      attempt: 2,
    });
    expect(events.length).toBe(9);
    expect(checkAll(events)).toEqual([]);
  });
});

describe("values shared with transcribe-api outside the contract", () => {
  it("the analytics consent cookie is the one the relay reads (CONSENT_COOKIE)", () => {
    // transcribe-api src/transcribe_api/runtime/browser_telemetry.py
    expect(CONSENT_COOKIE_NAME).toBe("judicial-transcribe-cookie-preferences");
  });

  it("the browser's journey is one the relay accepts", () => {
    expect(BROWSER_JOURNEYS.has(JOURNEY_DICTATION_SESSION)).toBe(true);
  });
});
