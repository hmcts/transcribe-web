import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const span = vi.hoisted(() => ({
  recordException: vi.fn(),
  setStatus: vi.fn(),
  setAttributes: vi.fn(),
  end: vi.fn(),
}));
const otel = vi.hoisted(() => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getActiveSpan: vi.fn(),
    getTracer: vi.fn(() => ({
      startActiveSpan: (_name: string, fn: (s: typeof span) => void) =>
        fn(span),
    })),
  },
}));
vi.mock("@opentelemetry/api", () => otel);

import { onRequestError } from "@/instrumentation";

const CONTEXT = { routePath: "/record", routeType: "render" };

describe("onRequestError (server errors to Application Insights)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=x");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records the type, route and digest on the request's span, never the message", async () => {
    otel.trace.getActiveSpan.mockReturnValue(span);
    const error = Object.assign(new TypeError("the appellant said"), {
      digest: "123456",
    });
    await onRequestError(error, { method: "GET" }, CONTEXT);

    expect(span.recordException).toHaveBeenCalledWith({
      name: "TypeError",
      message: "TypeError",
    });
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.setAttributes).toHaveBeenCalledWith({
      "exception.type": "TypeError",
      "http.request.method": "GET",
      "next.route_path": "/record",
      "next.route_type": "render",
      "next.error.digest": "123456",
    });
    expect(
      JSON.stringify(Object.values(span).map((fn) => fn.mock.calls))
    ).not.toContain("appellant");
    expect(span.end).not.toHaveBeenCalled(); // the request's span is not ours
  });

  it("uses a span of its own when there is no active one", async () => {
    otel.trace.getActiveSpan.mockReturnValue(undefined);
    await onRequestError(new Error("x"), { method: "POST" }, CONTEXT);
    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("does nothing without Application Insights", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "");
    await onRequestError(new Error("x"), { method: "GET" }, CONTEXT);
    expect(otel.trace.getActiveSpan).not.toHaveBeenCalled();
  });
});
