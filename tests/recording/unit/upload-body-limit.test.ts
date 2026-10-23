import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { config as proxyConfig } from "@/proxy";

// Recording uploads go up to 200 MB (app/api/upload/route.ts, and the API's
// own cap). Next.js buffers the whole body of any request the proxy
// (proxy.ts) runs on before the route handler sees it, and passes on only
// the first experimental.proxyClientMaxBodySize bytes (10 MB by default),
// silently. So /api/upload is kept out of the proxy and streams its body to
// the API instead, and the limit stays at its default for everything else.

type CloneableBody = { cloneBodyStream(): Readable; finalize(): Promise<void> };
let nextConfig: { experimental?: { proxyClientMaxBodySize?: number } };
let getCloneableBody: (readable: Readable, sizeLimit?: number) => CloneableBody;
let doesProxyMatch: typeof import("next/experimental/testing/server").unstable_doesMiddlewareMatch;

beforeAll(async () => {
  // Next's server modules (loaded by next.config.js's Sentry wrapper and
  // the testing helpers) expect the AsyncLocalStorage global its Node.js
  // runtime installs; jsdom has none.
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
    AsyncLocalStorage;
  const requireFromRoot = createRequire(
    path.join(process.cwd(), "package.json")
  );
  nextConfig = requireFromRoot("./next.config.js");
  ({ getCloneableBody } = requireFromRoot("next/dist/server/body-streams"));
  ({ unstable_doesMiddlewareMatch: doesProxyMatch } = await import(
    "next/experimental/testing/server"
  ));
});

const NEXT_DEFAULT_LIMIT = 10 * 1024 * 1024;

function proxyRuns(url: string, method = "POST") {
  return doesProxyMatch({
    config: proxyConfig,
    url,
    headers: { method },
  });
}

// What a route handler receives as its body after the proxy has run on the
// request: Next clones the incoming stream for the proxy, then swaps the
// buffered copy in as the request body (next-server.js runMiddleware).
async function bodyAfterProxy(
  body: Buffer,
  sizeLimit: number | undefined
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (let i = 0; i < body.length; i += 64 * 1024) {
    chunks.push(body.subarray(i, i + 64 * 1024));
  }
  const request = Readable.from(chunks);
  const cloneable = getCloneableBody(request, sizeLimit);
  cloneable.cloneBodyStream().resume(); // the proxy never reads it
  await cloneable.finalize();

  const received: Buffer[] = [];
  for await (const chunk of request) received.push(chunk as Buffer);
  return Buffer.concat(received);
}

describe("upload request bodies and the proxy", () => {
  it("cuts a body proxied with the configured limit off at 10 MB", async () => {
    // The failure keeping /api/upload out of the proxy avoids.
    // Next only logs a warning about it; the request carries on.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = Buffer.alloc(NEXT_DEFAULT_LIMIT + 1024 * 1024, 7);

    const received = await bodyAfterProxy(
      body,
      nextConfig.experimental?.proxyClientMaxBodySize
    );

    expect(received.length).toBe(NEXT_DEFAULT_LIMIT);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Request body exceeded 10MB")
    );
    warn.mockRestore();
  });

  it("does not run the proxy on /api/upload", () => {
    expect(proxyRuns("/api/upload")).toBe(false);
  });

  it.each([
    "/api/jobs",
    "/api/jobs/11111111-1111-1111-1111-111111111111/baseline",
    "/api/upload/other",
    "/api/uploads",
    "/recording",
    "/",
  ])("still runs the proxy on %s", (url) => {
    expect(proxyRuns(url)).toBe(true);
  });

  it("leaves the proxy's body limit at Next's 10 MB default", () => {
    // Raising it would let any request the proxy runs on, signed in or not
    // (the proxy only checks that a session cookie is present), make the
    // server buffer that much: ~840 MB RSS was measured for one 200 MB body,
    // against the web pod's 512 MiB limit.
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
  });
});
