import { afterEach, describe, expect, it, vi } from "vitest";
import { contextChangedIn, watchContextChanged } from "@/lib/access/context-changed";
import { jurisdictionHeaders, setTabContext } from "@/lib/jurisdiction-session";

// DIAAT-373: the tab names its context in X-Jurisdiction and X-Role; the API
// answers 409 context_changed when another tab changed it.

describe("the headers naming the tab's context", () => {
  afterEach(() => window.sessionStorage.clear());

  it("are sent together, with a dash for a global role", () => {
    expect(jurisdictionHeaders()).toEqual({});
    setTabContext({ jurisdiction: "ET", role: "Judge" });
    expect(jurisdictionHeaders()).toEqual({ "X-Jurisdiction": "ET", "X-Role": "Judge" });
    setTabContext({ jurisdiction: null, role: "Global" });
    expect(jurisdictionHeaders()).toEqual({ "X-Jurisdiction": "-", "X-Role": "Global" });
    setTabContext(null);
    expect(jurisdictionHeaders()).toEqual({});
  });
});

describe("contextChangedIn", () => {
  it.each([
    [{ code: "context_changed" }, true],
    [{ detail: { code: "context_changed", message: "x" } }, true],
    [{ detail: { code: "edit_conflict" } }, false],
    [{ detail: "context_changed" }, false],
    [{}, false],
    [null, false],
    ["context_changed", false],
  ])("%j -> %s", (body, expected) => {
    expect(contextChangedIn(body)).toBe(expected);
  });
});

describe("watchContextChanged", () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });

  const respond = (status: number, body: unknown) => {
    window.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };

  it("calls back for a 409 context_changed, and still hands the response to the caller", async () => {
    respond(409, { detail: { code: "context_changed" } });
    const onChanged = vi.fn();
    const stop = watchContextChanged(onChanged);

    const response = await window.fetch("/api/x");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ detail: { code: "context_changed" } });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    stop();
  });

  it.each([
    [409, { detail: { code: "edit_conflict" } }],
    [409, "not json"],
    [403, { detail: { code: "context_changed" } }],
    [200, { detail: { code: "context_changed" } }],
  ])("is silent for a %s with %j", async (status, body) => {
    window.fetch = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;
    const onChanged = vi.fn();
    const stop = watchContextChanged(onChanged);

    await window.fetch("/api/x");
    await new Promise((r) => setTimeout(r, 10));

    expect(onChanged).not.toHaveBeenCalled();
    stop();
  });

  it("puts fetch back when stopped", () => {
    respond(200, {});
    const before = window.fetch;
    const stop = watchContextChanged(() => undefined);
    expect(window.fetch).not.toBe(before);
    stop();
    expect(window.fetch).toBe(before);
  });
});
