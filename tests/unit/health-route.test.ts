import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/health/route";

describe("GET /health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the app version", async () => {
    vi.stubEnv("APP_VERSION", "abc1234");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "abc1234" });
  });
});
