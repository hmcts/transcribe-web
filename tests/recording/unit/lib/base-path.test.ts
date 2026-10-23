import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The recording area's client-side fetches go through apiPath(). In the merged
// app it is served at the root, and Caddy sends only an exact list of
// /api/... paths to its route handlers (the @next_api matcher). A leftover
// /batch prefix made every call miss that matcher and 404 in Next.js.

// Paths in Caddy's @next_api matcher, read from the Caddyfile itself so the
// test fails if the two drift apart.
function nextApiMatchers(): string[] {
  const caddyfile = readFileSync(
    path.resolve(__dirname, "../../../../Caddyfile"),
    "utf8"
  );
  const line = caddyfile
    .split("\n")
    .find((l) => l.trim().startsWith("@next_api path "));
  if (!line) throw new Error("@next_api matcher not found in Caddyfile");
  return line.trim().replace("@next_api path ", "").split(/\s+/);
}

function caddyRoutesToNext(urlPath: string): boolean {
  return nextApiMatchers().some((m) =>
    m.endsWith("*") ? urlPath.startsWith(m.slice(0, -1)) : urlPath === m
  );
}

describe("recording base path", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = saved;
    vi.resetModules();
  });

  it("has no prefix when NEXT_PUBLIC_BASE_PATH is unset", async () => {
    const { BASE_PATH } = await import("@/lib/recording/base-path");
    expect(BASE_PATH).toBe("");
  });

  it.each([
    "/api/jobs",
    "/api/upload",
    "/api/version",
    "/api/jobs/11111111-1111-1111-1111-111111111111",
    "/api/jobs/11111111-1111-1111-1111-111111111111/segments/0",
    "/api/jobs/11111111-1111-1111-1111-111111111111/segments/0/words",
    "/api/jobs/11111111-1111-1111-1111-111111111111/baseline",
    "/api/audio/11111111-1111-1111-1111-111111111111",
  ])("leaves %s unprefixed and routed to Next.js by Caddy", async (p) => {
    const { apiPath } = await import("@/lib/recording/base-path");
    const url = apiPath(p);
    expect(url).toBe(p);
    expect(url).not.toContain("/batch");
    expect(caddyRoutesToNext(url)).toBe(true);
  });

  it("does not route the backend's /api/upload-audio to Next.js", () => {
    // Sanity check on the matcher helper: an exact /api/upload must not
    // capture the dictation upload, which Caddy sends to the backend.
    expect(caddyRoutesToNext("/api/upload-audio")).toBe(false);
  });
});
