import { describe, expect, it, vi } from "vitest";
import type { RelayEvent, TelemetryRelay } from "@/lib/telemetry-relay";

import {
  createBrowserFailures,
  errorType,
  installClientErrorHandlers,
} from "@/lib/browser-failures";

const CONTENT = "the appellant " + "said";

function setup(path = "/transcriptions/6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f") {
  const events: RelayEvent[] = [];
  const relay = {
    emit: (e: RelayEvent) => events.push(e),
  } as unknown as TelemetryRelay;
  let clock = 1_000;
  const failures = createBrowserFailures(
    relay,
    () => clock,
    () => path
  );
  return {
    events,
    failures,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("client errors (ui.error)", () => {
  it("sends the type, source, route and digest, never the message", () => {
    const { events, failures } = setup();
    failures.clientError(new TypeError(CONTENT), "render", "1234567890");
    expect(events).toEqual([
      {
        name: "ui.error",
        attributes: {
          "ui.error_type": "TypeError",
          "ui.error_source": "render",
          "page.route": "/transcriptions/:id",
          "next.error.digest": "1234567890",
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("appellant");
  });

  it("names what is not an Error safely", () => {
    expect(errorType(CONTENT)).toBe("NonError");
    expect(errorType(undefined)).toBe("NoError");
    expect(
      errorType(Object.assign(new Error("x"), { name: `bad name; ${CONTENT}` }))
    ).toBe("Error");
    class ChunkLoadError extends Error {}
    expect(errorType(new ChunkLoadError("x"))).toBe("Error"); // name is "Error" unless set
    const chunk = new Error("x");
    chunk.name = "ChunkLoadError";
    expect(errorType(chunk)).toBe("ChunkLoadError");
  });

  it("drops a digest that is not one", () => {
    const { events, failures } = setup();
    failures.clientError(new Error("x"), "render", "not a digest!");
    expect(events[0].attributes?.["next.error.digest"]).toBeUndefined();
  });

  it("sends a repeated error once a minute, and at most 20 per page", () => {
    const { events, failures, advance } = setup();
    for (let i = 0; i < 5; i++)
      failures.clientError(new TypeError("x"), "window_error");
    expect(events).toHaveLength(1);
    advance(60_000);
    failures.clientError(new TypeError("x"), "window_error");
    expect(events).toHaveLength(2);
    for (let i = 0; i < 40; i++) {
      const error = new Error("x");
      error.name = `Error${i}`;
      failures.clientError(error, "unhandled_rejection");
    }
    expect(events).toHaveLength(20);
  });

  it("is reported from window errors and unhandled rejections", () => {
    const clientError = vi.fn();
    installClientErrorHandlers({ clientError, transferFailed: vi.fn() });
    window.dispatchEvent(
      new ErrorEvent("error", { error: new RangeError("x") })
    );
    const rejection = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    rejection.reason = new TypeError("y");
    window.dispatchEvent(rejection);
    expect(
      clientError.mock.calls.map(([error, source]) => [
        errorType(error),
        source,
      ])
    ).toEqual([
      ["RangeError", "window_error"],
      ["TypeError", "unhandled_rejection"],
    ]);
  });
});

describe("failed uploads (upload.transfer_failed)", () => {
  it("sends the code, status, file type and size, attempt and source", () => {
    const { events, failures } = setup();
    const file = new File([new Uint8Array(10)], "hearing.webm", {
      type: "audio/webm;codecs=opus",
    });
    failures.transferFailed({
      code: "http.503",
      status: 503,
      file,
      attempt: 2,
    });
    expect(events).toEqual([
      {
        name: "upload.transfer_failed",
        attributes: {
          "hmcts.error.code": "http.503",
          "http.response.status_code": 503,
          "file.type": "audio/webm",
          "file.size_bytes": 10,
          "upload.retry_attempt": 2,
          "upload.source": "upload",
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("hearing.webm");
  });
});
