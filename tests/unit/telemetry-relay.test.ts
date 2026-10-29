import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryRelay, UNSENT_STORAGE_KEY } from "@/lib/telemetry-relay";

function response(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function sentBodies(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string).events
  );
}

describe("TelemetryRelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("batches events and posts them to the same-origin relay with the session cookie, never a token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
      flushDelayMs: 1000,
    });
    relay.emit({ name: "dictation.paused" });
    relay.emit({ name: "dictation.resumed" });
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/telemetry");
    // Caddy attaches the session's bearer token (forward_auth).
    expect((init as RequestInit).headers).toEqual({
      "Content-Type": "application/json",
    });
    expect((init as RequestInit).credentials).toBe("same-origin");
    expect(
      sentBodies(fetchImpl)[0].map((e: { name: string }) => e.name)
    ).toEqual(["dictation.paused", "dictation.resumed"]);
    expect(relay.pending).toBe(0);
  });

  it("leaves out null, undefined and non-finite values, which would fail the whole batch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({ fetchImpl });
    relay.emit({
      name: "live_draft.save_failed",
      attributes: { a: null, b: undefined, c: Number.NaN, d: 3, e: "auth" },
      durationMs: Number.POSITIVE_INFINITY,
    });
    await relay.flush();
    const [event] = sentBodies(fetchImpl)[0];
    expect(event).toEqual({
      name: "live_draft.save_failed",
      attributes: { d: 3, e: "auth" },
    });
  });

  it("keeps events for a retry after a network failure or 5xx", async () => {
    for (const failure of [
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(response(503)),
    ]) {
      const fetchImpl = vi
        .fn()
        .mockImplementationOnce(failure)
        .mockResolvedValue(response(202));
      const relay = new TelemetryRelay({
        fetchImpl,
        flushDelayMs: 100,
      });
      relay.emit({ name: "dictation.paused" });
      await relay.flush();
      expect(relay.pending).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(relay.pending).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("drops a batch the relay will never accept (422)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(422));
    const relay = new TelemetryRelay({ fetchImpl });
    relay.emit({ name: "dictation.paused" });
    await relay.flush();
    expect(relay.pending).toBe(0);
  });

  it("sends whatever is queued with keepalive when the page is hidden", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
    });
    relay.emit({ name: "dictation.session_ended" });
    relay.flushOnHide();
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).keepalive).toBe(true);
    expect((init as RequestInit).credentials).toBe("same-origin");
  });

  it("never throws into the app, even when fetch throws synchronously", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("boom");
    });
    const relay = new TelemetryRelay({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(() => relay.emit({ name: "dictation.paused" })).not.toThrow();
    await expect(relay.flush()).resolves.toBeUndefined();
    expect(() => relay.flushOnHide()).not.toThrow();
  });

  it("bounds the queue during a long outage", () => {
    const relay = new TelemetryRelay({
      fetchImpl: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    // The first batch of 50 is in flight (and never completes); the rest queue up.
    for (let i = 0; i < 400; i++) relay.emit({ name: "dictation.paused" });
    expect(relay.pending).toBe(200);
  });

  it("caps durations at the relay's 24-hour limit instead of losing the batch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({ fetchImpl });
    relay.emit({ name: "dictation.session_ended", durationMs: 90_000_000 });
    await relay.flush();
    expect(sentBodies(fetchImpl)[0][0].duration_ms).toBe(86_400_000);
  });

  it("queues a failed page-hide send again when the page lives on (tab switch)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
      flushDelayMs: 100,
    });
    relay.emit({ name: "dictation.session_ended" });
    relay.flushOnHide();
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.pending).toBe(0);
  });

  it("signed out (401), it keeps the events, tries once a minute and keeps them on page hide", async () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    } as Storage;
    const fetchImpl = vi.fn().mockResolvedValue(response(401));
    const relay = new TelemetryRelay({
      fetchImpl,
      flushDelayMs: 100,
      storage: () => memory,
    });
    relay.emit({ name: "dictation.paused" });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    relay.emit({ name: "dictation.resumed" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no loop
    expect(relay.pending).toBe(2);

    relay.flushOnHide(); // would be refused: kept, not sent
    expect(relay.pending).toBe(0);
    const kept = JSON.parse(storage.get(UNSENT_STORAGE_KEY) ?? "[]");
    expect(kept.map((e: { name: string }) => e.name)).toEqual([
      "dictation.paused",
      "dictation.resumed",
    ]);
    relay.restoreUnsent(); // visible again: queued, still respecting the retry deadline
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(relay.pending).toBe(2);
    expect(storage.has(UNSENT_STORAGE_KEY)).toBe(false);

    // Signed in again: the next event's send succeeds and brings the kept ones.
    fetchImpl.mockResolvedValue(response(202));
    relay.emit({ name: "dictation.session_ended" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.pending).toBe(0);
    expect(storage.has(UNSENT_STORAGE_KEY)).toBe(false);
    const sent = fetchImpl.mock.calls
      .slice(1)
      .flatMap(([, init]) =>
        JSON.parse((init as RequestInit).body as string).events.map(
          (e: { name: string }) => e.name
        )
      );
    expect(sent.sort()).toEqual([
      "dictation.paused",
      "dictation.resumed",
      "dictation.session_ended",
    ]);
  });

  it("counts the keepalive budget across page-hide flushes until requests settle", () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    } as Storage;
    const fetchImpl = vi.fn().mockReturnValue(new Promise(() => undefined));
    const relay = new TelemetryRelay({ fetchImpl, storage: () => memory });
    const big = { "attribute.text": "x".repeat(500) };
    for (let i = 0; i < 100; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    relay.flushOnHide(); // visibilitychange: about 52 KB in flight
    relay.emit({ name: "dictation.session_ended", attributes: big });
    for (let i = 0; i < 20; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    const before = fetchImpl.mock.calls.length;
    relay.flushOnHide(); // pagehide: over the remaining budget, so kept
    expect(fetchImpl.mock.calls.length).toBe(before);
    const kept = JSON.parse(storage.get(UNSENT_STORAGE_KEY) ?? "[]");
    expect(kept[0].name).toBe("dictation.session_ended");
  });

  it("keeps a page-hide batch in storage when its send fails while the page is hidden", async () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    } as Storage;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
      const relay = new TelemetryRelay({ fetchImpl, storage: () => memory });
      relay.emit({ name: "dictation.session_ended" });
      relay.flushOnHide();
      await vi.advanceTimersByTimeAsync(0);
      const kept = JSON.parse(storage.get(UNSENT_STORAGE_KEY) ?? "[]");
      expect(kept.map((e: { name: string }) => e.name)).toEqual([
        "dictation.session_ended",
      ]);
      expect(relay.pending).toBe(0);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("sends every batch with keepalive, so an in-flight request survives the page closing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
    });
    relay.emit({ name: "dictation.paused" });
    await relay.flush();
    expect((fetchImpl.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it("keeps page-hide sends within the keepalive budget left by an in-flight batch", async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(response(202));
    const storage = new Map<string, string>();
    const relay = new TelemetryRelay({
      fetchImpl,
      storage: () =>
        ({
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => void storage.set(k, v),
          removeItem: (k: string) => void storage.delete(k),
        }) as Storage,
    });
    const big = { a: "x".repeat(400) };
    for (let i = 0; i < 49; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    const flushing = relay.flush(); // ~25 KB in flight
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 150; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    relay.flushOnHide();
    const hideBytes = fetchImpl.mock.calls
      .slice(1)
      .reduce(
        (total, [, init]) => total + String((init as RequestInit).body).length,
        0
      );
    const inFlight = String(
      (fetchImpl.mock.calls[0][1] as RequestInit).body
    ).length;
    expect(inFlight + hideBytes).toBeLessThanOrEqual(60_000);
    expect(storage.has("hmcts-telemetry-unsent")).toBe(true); // the rest is kept
    finish(response(202));
    await flushing;
  });

  it("sends without keepalive when page-hide requests have used the budget", async () => {
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => undefined)) // page-hide send, in flight
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValue(response(202));
    const relay = new TelemetryRelay({ fetchImpl });
    const big = { "attribute.text": "x".repeat(500) };
    for (let i = 0; i < 100; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    relay.flushOnHide(); // about 52 KB of keepalive in flight
    for (let i = 0; i < 20; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    await relay.flush(); // the page is visible again
    const last = fetchImpl.mock.calls.at(-1)?.[1] as RequestInit;
    expect(last.keepalive).toBe(false);
    expect(relay.pending).toBe(0);
  });
});
