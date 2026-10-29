import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appVersion } from "@/lib/app-version";

describe("appVersion", () => {
  let dir: string;
  let buildVersionFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "app-version-"));
    buildVersionFile = join(dir, "BUILD_VERSION");
    vi.stubEnv("APP_VERSION", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers APP_VERSION", () => {
    vi.stubEnv("APP_VERSION", "1.2.3");
    writeFileSync(buildVersionFile, "abc1234\n");
    expect(appVersion(buildVersionFile)).toBe("1.2.3");
  });

  it("reads the version written at build time", () => {
    writeFileSync(buildVersionFile, "abc1234\n");
    expect(appVersion(buildVersionFile)).toBe("abc1234");
  });

  it("falls back to 'dev' when the build version file is empty", () => {
    writeFileSync(buildVersionFile, "");
    expect(appVersion(buildVersionFile)).toBe("dev");
  });

  it("falls back to 'dev' when there is no build version file", () => {
    expect(appVersion(buildVersionFile)).toBe("dev");
  });
});
