import { describe, expect, it } from "vitest";
import { get, TEST_URL } from "./client";

// Per-PR preview releases run with AUTH_ENABLED 'false' (their hostnames
// cannot be Entra redirect URIs; charts/transcribe-web/values.preview.template.yaml),
// so an anonymous API call is not refused there. AUTH_EXPECTED overrides.
const isPreview = new URL(TEST_URL).hostname.endsWith(
  ".preview.platform.hmcts.net"
);
const authExpected = process.env.AUTH_EXPECTED
  ? process.env.AUTH_EXPECTED !== "false"
  : !isPreview;

describe(`functional: ${TEST_URL}`, () => {
  it("is healthy", async () => {
    expect((await get("/health")).status).toBe(200);
  });

  it.runIf(authExpected)(
    "refuses an anonymous API call rather than serving data",
    async () => {
      expect((await get("/api/jobs")).status).toBe(401);
    }
  );
});
