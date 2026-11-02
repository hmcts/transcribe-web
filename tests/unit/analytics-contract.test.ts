/**
 * Cross-stack contract (OBS-3): the relay events produced for every analytics
 * event, from representative call-site values, are committed to
 * tests/fixtures/analytics-events.json. tests/unit/telemetry-contract.test.ts
 * checks that transcribe-api's relay accepts every event in it whole.
 *
 * After changing a mapping, regenerate with:
 *   UPDATE_ANALYTICS_FIXTURE=1 yarn vitest run tests/unit/analytics-contract.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/telemetry-relay", () => ({
  telemetryRelay: { emit: (event: unknown) => emitted.push(event) },
}));
vi.mock("@/lib/analytics-consent", () => ({ hasAnalyticsConsent: () => true }));

import { type AnalyticsEventName, track } from "@/lib/analytics";
import { SAMPLES } from "./analytics-samples";

const FIXTURE = join(__dirname, "..", "fixtures", "analytics-events.json");

describe("analytics relay contract", () => {
  it("matches the committed fixture the API contract is checked against", () => {
    emitted.length = 0;
    for (const name of Object.keys(SAMPLES) as AnalyticsEventName[]) {
      track(name, SAMPLES[name] as never);
    }
    expect(emitted).toHaveLength(Object.keys(SAMPLES).length);
    const actual = `${JSON.stringify(emitted, null, 2)}\n`;
    if (process.env.UPDATE_ANALYTICS_FIXTURE) writeFileSync(FIXTURE, actual);
    expect(actual).toBe(readFileSync(FIXTURE, "utf8"));
  });
});
