import { describe, expect, it } from "vitest";
import { get, TEST_URL } from "./client";

describe(`smoke: ${TEST_URL}`, () => {
  it("serves /health through Caddy", async () => {
    const response = await get("/health");

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});
