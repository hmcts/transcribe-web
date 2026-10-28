import { describe, expect, it } from "vitest";
import { isPathActive } from "@/lib/navigation";

describe("isPathActive", () => {
  it("matches the base path and its subtree", () => {
    expect(isPathActive("/recording", "/recording")).toBe(true);
    expect(isPathActive("/recording/jobs/1", "/recording")).toBe(true);
  });

  it("does not treat /recording as part of /record", () => {
    expect(isPathActive("/recording", "/record")).toBe(false);
    expect(isPathActive("/record", "/recording")).toBe(false);
    expect(isPathActive("/record", "/record")).toBe(true);
  });

  it("is false for a missing pathname", () => {
    expect(isPathActive(null, "/record")).toBe(false);
  });
});
