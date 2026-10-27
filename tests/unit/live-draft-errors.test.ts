import { describe, expect, it } from "vitest";
import {
  classifyLiveDraftStatus,
  LiveDraftError,
  liveDraftFailureKind,
} from "@/lib/live-draft-errors";

describe("classifyLiveDraftStatus", () => {
  it("treats 401 as an auth failure", () => {
    expect(classifyLiveDraftStatus(401)).toBe("auth");
  });

  it("treats 403 as an auth failure", () => {
    expect(classifyLiveDraftStatus(403)).toBe("auth");
  });

  it("treats a 500 as a server failure", () => {
    expect(classifyLiveDraftStatus(500)).toBe("server");
  });

  it("treats a 502 gateway failure as a server failure", () => {
    expect(classifyLiveDraftStatus(502)).toBe("server");
  });

  it("treats an unexpected 400 as a server failure rather than an auth one", () => {
    expect(classifyLiveDraftStatus(400)).toBe("server");
  });
});

describe("liveDraftFailureKind", () => {
  it("reads the kind off a LiveDraftError", () => {
    expect(liveDraftFailureKind(new LiveDraftError("auth", "no", 401))).toBe(
      "auth"
    );
    expect(liveDraftFailureKind(new LiveDraftError("server", "no", 500))).toBe(
      "server"
    );
  });

  it("treats a rejected fetch as a network failure", () => {
    // This is exactly what the incident produced in the browser: fetch()
    // rejecting with a bare TypeError before any response existed.
    expect(liveDraftFailureKind(new TypeError("Failed to fetch"))).toBe(
      "network"
    );
  });

  it("treats an unrecognised throw as a network failure", () => {
    expect(liveDraftFailureKind("something odd")).toBe("network");
  });
});

describe("LiveDraftError", () => {
  it("carries the status alongside the kind", () => {
    const error = new LiveDraftError("auth", "Failed to save live draft", 401);
    expect(error.kind).toBe("auth");
    expect(error.status).toBe(401);
    expect(error.name).toBe("LiveDraftError");
    expect(error).toBeInstanceOf(Error);
  });
});
