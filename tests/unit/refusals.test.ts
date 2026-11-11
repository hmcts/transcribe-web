import { afterEach, describe, expect, it, vi } from "vitest";
import { refusalCodeIn, reportXhrRefusal, watchRefusals } from "@/lib/access/refusals";
import { watchContextChanged } from "@/lib/access/context-changed";

// DIAAT-373: one watcher on fetch for the API's refusals that are about who the
// user is (context_changed, context_required, user_deactivated, dictation_disabled).

describe("refusalCodeIn", () => {
  it.each([
    [{ detail: { code: "user_deactivated", message: "x" } }, "user_deactivated"],
    [{ code: "context_changed" }, "context_changed"],
    [{ detail: "plain text" }, undefined],
    [{ detail: { message: "no code" } }, undefined],
    [null, undefined],
    ["x", undefined],
  ])("%j -> %s", (body, expected) => {
    expect(refusalCodeIn(body)).toBe(expected);
  });
});

describe("watchRefusals", () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });
  const respond = (status: number, body: unknown) => {
    window.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };

  it.each([
    [403, "context_required"],
    [403, "user_deactivated"],
    [403, "dictation_disabled"],
    [403, "permission_denied"],
    [409, "context_changed"],
  ])("tells every listener about a %s %s, and still hands the response on", async (status, code) => {
    respond(status, { detail: { code, message: "m" } });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watchRefusals(first);
    const stopSecond = watchRefusals(second);

    const response = await window.fetch("/api/x");

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ detail: { code, message: "m" } });
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(code, status));
    expect(second).toHaveBeenCalledWith(code, status);
    stopFirst();
    stopSecond();
  });

  it.each([
    [200, { detail: { code: "user_deactivated" } }],
    [401, { detail: { code: "user_deactivated" } }],
    [500, { detail: { code: "user_deactivated" } }],
    [403, "not json"],
    [403, { detail: "no code" }],
  ])("is silent for a %s with %j", async (status, body) => {
    window.fetch = vi.fn(
      async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
    ) as typeof fetch;
    const listener = vi.fn();
    const stop = watchRefusals(listener);

    await window.fetch("/api/x");
    await new Promise((r) => setTimeout(r, 10));

    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("wraps fetch once however many listen, and puts it back when the last one stops", () => {
    respond(200, {});
    const before = window.fetch;
    const stopA = watchRefusals(() => undefined);
    const wrapped = window.fetch;
    expect(wrapped).not.toBe(before);
    const stopB = watchContextChanged(() => undefined);
    expect(window.fetch).toBe(wrapped);

    stopA();
    expect(window.fetch).toBe(wrapped);
    stopB();
    expect(window.fetch).toBe(before);
  });
});

describe("reportXhrRefusal", () => {
  // Uploads use XMLHttpRequest (for progress), which the fetch watcher cannot see.
  const xhr = (status: number, responseText: string) => ({ status, responseText }) as XMLHttpRequest;

  it.each([
    [403, "context_required"],
    [403, "user_deactivated"],
    [409, "context_changed"],
  ])("tells the listeners about a %s %s from an upload", (status, code) => {
    const listener = vi.fn();
    const stop = watchRefusals(listener);

    reportXhrRefusal(xhr(status, JSON.stringify({ detail: { code, message: "m" } })));

    expect(listener).toHaveBeenCalledExactlyOnceWith(code, status);
    stop();
  });

  it("says nothing for other statuses, a body with no code, or a body that is not JSON", () => {
    const listener = vi.fn();
    const stop = watchRefusals(listener);

    reportXhrRefusal(xhr(500, JSON.stringify({ detail: { code: "context_changed" } })));
    reportXhrRefusal(xhr(403, JSON.stringify({ detail: "no code" })));
    reportXhrRefusal(xhr(403, "<Error><Code>AuthorizationFailure</Code></Error>"));
    reportXhrRefusal({ status: 409, get responseText(): string { throw new Error("not text"); } } as XMLHttpRequest);

    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
