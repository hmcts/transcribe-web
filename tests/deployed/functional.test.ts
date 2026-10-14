import { describe, expect, it } from "vitest";
import { get, TEST_URL } from "./client";

// With AUTH_ENABLED=true (the default outside preview) nothing but /health and
// /auth/* is reachable without a session (proxy.ts).
describe(`functional: ${TEST_URL}`, () => {
  it("is healthy", async () => {
    expect((await get("/health")).status).toBe(200);
  });

  it.runIf(process.env.AUTH_EXPECTED !== "false")(
    "refuses an anonymous API call rather than serving data",
    async () => {
      expect((await get("/api/jobs")).status).toBe(401);
    }
  );
});
