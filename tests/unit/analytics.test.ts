/**
 * OBS-3: product analytics go through the first-party relay, only with consent,
 * and never carry names, comments, file paths or URLs with IDs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(
  () => [] as { name: string; attributes?: Record<string, unknown> }[]
);
vi.mock("@/lib/telemetry-relay", () => ({
  telemetryRelay: { emit: (event: { name: string }) => emitted.push(event) },
}));

import { fileType, normaliseRoute, track } from "@/lib/analytics";
import { readAnalyticsConsent } from "@/lib/analytics-consent";

const COOKIE = "judicial-transcribe-cookie-preferences";

function setConsent(value: "on" | "off" | null) {
  // biome-ignore lint/suspicious/noDocumentCookie: simulates the consent cookie the banner sets
  document.cookie =
    value === null
      ? `${COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      : `${COOKIE}=${encodeURIComponent(JSON.stringify({ analytics: value }))}; path=/`;
}

beforeEach(() => {
  emitted.length = 0;
});
afterEach(() => setConsent(null));

describe("consent", () => {
  it("sends analytics events only when analytics is on", () => {
    setConsent(null);
    track("minutes_copied", { contentLength: 10 });
    setConsent("off");
    track("minutes_copied", { contentLength: 10 });
    expect(emitted).toHaveLength(0);

    setConsent("on");
    track("minutes_copied", { contentLength: 10 });
    expect(emitted).toEqual([
      { name: "minutes.copied", attributes: { "minutes.content_length": 10 } },
    ]);
  });

  it("always sends failure events: they say the service is broken", () => {
    setConsent("off");
    track("generate_ai_minutes_failed", {
      style: "General",
      duration_ms: 900,
      error_type: "TypeError",
    });
    expect(emitted[0].name).toBe("minutes.generation_failed");
    expect(emitted[0].attributes?.["hmcts.error.code"]).toBe("TypeError");
  });

  it("reads the cookie as cookie-manager and the settings page write it", () => {
    expect(readAnalyticsConsent(`${COOKIE}={"analytics":"on"}`)).toBe("on");
    expect(
      readAnalyticsConsent(`a=1; ${COOKIE}=%7B%22analytics%22%3A%22on%22%7D`)
    ).toBe("on");
    expect(readAnalyticsConsent(`x${COOKIE}={"analytics":"on"}`)).toBe("off");
    expect(readAnalyticsConsent(`${COOKIE}=garbage`)).toBe("off");
  });
});

describe("no personal or free-text data", () => {
  beforeEach(() => setConsent("on"));

  it("drops speaker names, rating comments and blob paths", () => {
    track("speaker_name_edited_in_transcript", {
      old_name: "Judge Smith",
      new_name: "Mr Jones",
      update_type: "all_occurrences",
      entry_index: 3,
    });
    track("minutes_rating_submitted", {
      rating: 4,
      comment: "the appellant said",
    });
    track("transcription_started", {
      file_type: "audio/webm;codecs=opus",
      source: "upload",
      blob_path: "user-uploads/oid/hearing-PA-50123-2024.webm",
    });
    const text = JSON.stringify(emitted);
    for (const leaked of [
      "Smith",
      "Jones",
      "appellant",
      "hearing-PA",
      "user-uploads",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(emitted[2].attributes?.["file.type"]).toBe("audio/webm");
  });

  it("normalises page routes: IDs replaced, no query string or fragment", () => {
    expect(
      normaliseRoute(
        "/transcriptions/6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f?tab=minutes#x"
      )
    ).toBe("/transcriptions/:id");
    expect(normaliseRoute("https://app.example/Record/123")).toBe(
      "/record/:id"
    );
    track("$pageview", {
      $current_url: "/transcriptions/6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
    });
    expect(emitted[0]).toEqual({
      name: "page.viewed",
      attributes: { "page.route": "/transcriptions/:id" },
    });
  });

  it("keeps only plain MIME types", () => {
    expect(fileType("video/webm;codecs=vp9")).toBe("video/webm");
    expect(fileType("")).toBe("unknown");
    expect(fileType("the appellant said")).toBe("unknown");
  });

  it("never throws into the app", () => {
    expect(() => track("minutes_copied", undefined as never)).not.toThrow();
  });
});
