import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/version/route";

describe("GET /api/version", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the app version", async () => {
    vi.stubEnv("APP_VERSION", "abc1234");
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "abc1234" });
  });
});
