/**
 * Browser telemetry relay client (OBS-4, DIAAT-278 / DIAAT-300).
 *
 * Sends operational events to the backend's `POST /api/telemetry`, which validates
 * them against a fixed allowlist and records them in Application Insights. Same
 * origin (Caddy routes `/api/*` to the backend), so no CSP change and no third
 * party. Events are not consent-gated: they report whether dictation works, and
 * carry only event names, durations, counts, controlled codes and IDs.
 *
 * - Batches: at most 50 events and 30,000 bytes per request (the relay refuses
 *   bodies over 32 KiB), flushed every few seconds.
 * - Retries: network failures, 429 and 5xx back off exponentially (up to 60 s);
 *   new events never shorten the back-off. Other 4xx are dropped: the batch
 *   would never be accepted.
 * - Authentication: the browser holds no token on CNP. The session cookie goes
 *   with the request and Caddy attaches the session's bearer token (forward_auth),
 *   as for every other `/api/*` call.
 * - Signed out (401): events are kept and the relay tries again once a minute
 *   (the server ends a session whose token cannot be refreshed, and the rest of
 *   the app sends the user to sign in). On page hide they are kept in
 *   localStorage instead of being sent to be refused.
 * - Page hide: queued events go with `fetch(..., { keepalive: true })` within the
 *   browser's 64 KiB keepalive budget, counted across hide flushes until each
 *   request settles. Events that cannot be sent (signed out, budget exhausted, a
 *   send failing while the page is hidden) are kept in localStorage and sent when
 *   the page is visible again or by the next dictation page. They carry no user
 *   identity, so on a shared computer the next user's page may send them.
 * - Never throws and never blocks the UI.
 */

export type RelayAttributeValue = string | number | boolean;

export interface RelayEvent {
  name: string;
  attributes?: Record<string, RelayAttributeValue | null | undefined>;
  journey?: { type: string; id: string };
  durationMs?: number;
}

interface WireEvent {
  name: string;
  attributes?: Record<string, RelayAttributeValue>;
  journey?: { type: string; id: string };
  duration_ms?: number;
}

const RELAY_PATH = "/api/telemetry";
const MAX_BATCH = 50;
/** Below the relay's 32,768-byte limit, with room for the envelope. */
const MAX_BODY_BYTES = 30_000;
const MAX_QUEUE = 200;
const FLUSH_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;
/** Browsers allow 64 KiB of in-flight keepalive bodies per page. */
const KEEPALIVE_BUDGET_BYTES = 60_000;
/** The relay's upper bound for duration_ms (24 h): above it the batch is refused. */
const MAX_DURATION_MS = 86_400_000;
export const UNSENT_STORAGE_KEY = "hmcts-telemetry-unsent";

/**
 * The relay rejects a whole batch for one bad value (pydantic), so values are
 * cleaned here: null, undefined and non-finite numbers are left out.
 */
function toWire(event: RelayEvent): WireEvent {
  const wire: WireEvent = { name: event.name };
  if (event.attributes) {
    const attributes: Record<string, RelayAttributeValue> = {};
    for (const [key, value] of Object.entries(event.attributes)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      attributes[key] = value;
    }
    if (Object.keys(attributes).length > 0) wire.attributes = attributes;
  }
  if (event.journey) wire.journey = event.journey;
  if (
    event.durationMs !== undefined &&
    Number.isFinite(event.durationMs) &&
    event.durationMs >= 0
  ) {
    wire.duration_ms = Math.min(MAX_DURATION_MS, Math.round(event.durationMs));
  }
  return wire;
}

function isWireEvent(value: unknown): value is WireEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WireEvent).name === "string"
  );
}

function body(events: WireEvent[]): string {
  return JSON.stringify({ events });
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface TelemetryRelayOptions {
  fetchImpl?: typeof fetch;
  flushDelayMs?: number;
  now?: () => number;
  storage?: () => Storage | null;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class TelemetryRelay {
  private queue: WireEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private inFlight = false;
  private failures = 0;
  /** No flush before this time (back-off after a failure). */
  private retryAt = 0;
  /** The last response was 401: retry slowly, and keep events on page hide. */
  private signedOut = false;
  /** Bytes of page-hide keepalive requests not yet settled. */
  private keepaliveInFlight = 0;
  private readonly fetchImpl: () => typeof fetch;
  private readonly flushDelayMs: number;
  private readonly now: () => number;
  private readonly storage: () => Storage | null;

  constructor(options: TelemetryRelayOptions = {}) {
    // Resolved at call time so tests (and polyfills) replacing fetch are seen.
    this.fetchImpl = () => options.fetchImpl ?? globalThis.fetch;
    this.flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
    this.now = options.now ?? Date.now;
    this.storage = options.storage ?? defaultStorage;
  }

  emit(event: RelayEvent): void {
    try {
      this.enqueue([toWire(event)]);
      const full = this.queue.length >= MAX_BATCH;
      this.schedule(full ? 0 : this.flushDelayMs);
    } catch {
      // Telemetry must never break dictation.
    }
  }

  /** Number of events waiting to be sent (for tests and diagnostics). */
  get pending(): number {
    return this.queue.length;
  }

  private enqueue(events: WireEvent[], atFront = false): void {
    this.queue = atFront
      ? [...events, ...this.queue]
      : [...this.queue, ...events];
    if (this.queue.length > MAX_QUEUE) {
      // Oldest first: the most recent events describe the current state.
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
  }

  /** Flush after `delayMs`, never before the back-off allows. */
  private schedule(delayMs: number): void {
    if (typeof setTimeout === "undefined") return;
    const now = this.now();
    const target = Math.max(now + delayMs, this.retryAt);
    if (this.timer !== null) {
      if (this.timerAt >= this.retryAt && this.timerAt <= target) return;
      clearTimeout(this.timer);
    }
    this.timerAt = target;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, target - now);
  }

  private backOff(): void {
    this.failures += 1;
    this.retryAt =
      this.now() +
      Math.min(MAX_RETRY_DELAY_MS, this.flushDelayMs * 2 ** this.failures);
    this.schedule(0);
  }

  /** Take up to MAX_BATCH events within MAX_BODY_BYTES from the queue. */
  private takeBatch(): WireEvent[] {
    const batch: WireEvent[] = [];
    let size = body([]).length;
    while (this.queue.length > 0 && batch.length < MAX_BATCH) {
      const eventSize = JSON.stringify(this.queue[0]).length + 1;
      if (size + eventSize > MAX_BODY_BYTES) {
        if (batch.length === 0)
          this.queue.shift(); // can never be sent
        else break;
        continue;
      }
      batch.push(this.queue.shift() as WireEvent);
      size += eventSize;
    }
    return batch;
  }

  /** Refused with 401: keep the batch and try again after the longest back-off. */
  private unauthorised(batch: WireEvent[]): void {
    this.signedOut = true;
    this.enqueue(batch, true);
    this.retryAt = this.now() + MAX_RETRY_DELAY_MS;
    this.schedule(0);
  }

  /** A page-hide send failed: if the page is still hidden it may be unloading. */
  private keepAfterHide(batch: WireEvent[], status?: number): void {
    const hidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    if (status === 401) this.signedOut = true;
    if (hidden) {
      this.persist(batch);
    } else if (status === 401) {
      this.unauthorised(batch);
    } else {
      this.enqueue(batch, true);
      this.backOff();
    }
  }

  async flush(): Promise<void> {
    if (this.inFlight || this.queue.length === 0) return;
    if (this.now() < this.retryAt) {
      this.schedule(0);
      return;
    }
    this.inFlight = true;
    const batch = this.takeBatch();
    let outcome: "sent" | "drop" | "retry" | "unauthorised" = "retry";
    try {
      const response = await this.fetchImpl()(RELAY_PATH, {
        method: "POST",
        headers: JSON_HEADERS,
        body: body(batch),
        credentials: "same-origin",
      });
      if (response.ok) outcome = "sent";
      else if (response.status === 401) outcome = "unauthorised";
      else outcome = retryable(response.status) ? "retry" : "drop";
    } catch {
      outcome = "retry"; // network failure
    } finally {
      this.inFlight = false;
    }

    if (outcome === "sent") {
      const wasSignedOut = this.signedOut;
      this.signedOut = false;
      this.failures = 0;
      this.retryAt = 0;
      if (wasSignedOut) this.restoreUnsent(); // kept while signed out
    } else if (outcome === "unauthorised") {
      this.unauthorised(batch);
      return;
    } else if (outcome === "retry") {
      this.enqueue(batch, true);
      this.backOff();
      return;
    }
    if (this.queue.length > 0) this.schedule(0);
  }

  /** Send everything now without waiting (page hide). Best effort. */
  flushOnHide(): void {
    try {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.queue.length === 0) return;
      if (this.signedOut) {
        // It would be refused: keep it for when the user has signed in again.
        this.persist(this.queue.splice(0));
        return;
      }
      while (this.queue.length > 0) {
        const batch = this.takeBatch();
        if (batch.length === 0) break;
        const payload = body(batch);
        if (payload.length > KEEPALIVE_BUDGET_BYTES - this.keepaliveInFlight) {
          this.enqueue(batch, true);
          this.persist(this.queue.splice(0));
          break;
        }
        let request: Promise<Response>;
        try {
          request = this.fetchImpl()(RELAY_PATH, {
            method: "POST",
            headers: JSON_HEADERS,
            body: payload,
            credentials: "same-origin",
            keepalive: true,
          });
        } catch {
          this.enqueue(batch, true);
          this.persist(this.queue.splice(0));
          break;
        }
        this.keepaliveInFlight += payload.length;
        // A failed send is kept: in storage while the page is hidden (it may be
        // unloading), otherwise queued again for the normal retry.
        void request
          .then((response) => {
            if (response.ok) {
              this.signedOut = false;
              return;
            }
            if (response.status === 401 || retryable(response.status)) {
              this.keepAfterHide(batch, response.status);
            }
          })
          .catch(() => this.keepAfterHide(batch))
          .finally(() => {
            this.keepaliveInFlight -= payload.length;
          });
      }
    } catch {
      // Best effort only.
    }
  }

  /** Keep events that could not be sent, for the next visible page. */
  private persist(events: WireEvent[]): void {
    if (events.length === 0) return;
    try {
      const storage = this.storage();
      if (!storage) return;
      const stored = this.readStored(storage);
      storage.setItem(
        UNSENT_STORAGE_KEY,
        JSON.stringify([...stored, ...events].slice(-MAX_QUEUE))
      );
    } catch {
      // Storage full or unavailable: the events are lost, as before.
    }
  }

  private readStored(storage: Storage): WireEvent[] {
    try {
      const parsed: unknown = JSON.parse(
        storage.getItem(UNSENT_STORAGE_KEY) ?? "[]"
      );
      return Array.isArray(parsed) ? parsed.filter(isWireEvent) : [];
    } catch {
      return [];
    }
  }

  /** Queue events kept by an earlier page hide (this or a previous visit). */
  restoreUnsent(): void {
    try {
      if (this.signedOut) return; // they would be refused: kept for later
      const storage = this.storage();
      if (!storage) return;
      const stored = this.readStored(storage);
      storage.removeItem(UNSENT_STORAGE_KEY);
      if (stored.length === 0) return;
      this.enqueue(stored, true);
      this.schedule(0);
    } catch {
      // Best effort only.
    }
  }
}

export const telemetryRelay = new TelemetryRelay();

let lifecycleInstalled = false;

/** Flush on page hide and restore kept events, once per page. */
export function installRelayLifecycle(
  relay: TelemetryRelay = telemetryRelay
): void {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  relay.restoreUnsent();
  window.addEventListener("pagehide", () => relay.flushOnHide());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") relay.flushOnHide();
    else relay.restoreUnsent();
  });
}
