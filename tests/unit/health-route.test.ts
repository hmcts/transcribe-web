import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/health/route";

describe("GET /health", () => {
  const originalVersion = process.env.APP_VERSION;

  afterEach(() => {
    if (originalVersion === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalVersion;
    }
  });

  it("returns version from APP_VERSION env var", async () => {
    process.env.APP_VERSION = "1.2.3-abc1234";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "1.2.3-abc1234",
    });
  });

  it("falls back to 'dev' when APP_VERSION is unset", async () => {
    delete process.env.APP_VERSION;
    const res = await GET();
    expect(await res.json()).toEqual({ status: "ok", version: "dev" });
  });
});
