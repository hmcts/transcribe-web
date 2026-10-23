import { File as NodeFile } from "node:buffer";
import { expect } from "vitest";

// Helpers for asserting on the multipart requests the route handlers send to
// the API at the fetch boundary. The body is parsed with the platform's own
// multipart reader, so a hand-built body is checked against a real parser
// rather than against our own idea of the format.

/** A stream yielding `parts` in order, like a request body. */
export function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const next = parts.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

/**
 * Reads a streamed request body the way fetch would, rejecting as fetch does
 * ("fetch failed") if the body stream errors. For fetch mocks: a real fetch
 * consumes the body before the response arrives, and an upload's size check
 * only happens as its body is read.
 */
export async function consumeBody(
  init: RequestInit | undefined
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!(init?.body instanceof ReadableStream)) return undefined;
  try {
    return new Uint8Array(await new Response(init.body).arrayBuffer());
  } catch (cause) {
    throw new TypeError("fetch failed", { cause });
  }
}

/**
 * Parses what was sent as multipart/form-data, asserting on the way that it
 * was streamed without being held in memory (a ReadableStream with duplex
 * "half" and redirect "error", not a FormData or Blob holding the whole
 * upload) and that Content-Length matches the bytes sent.
 * Pass `sent` if the fetch mock already consumed the body (consumeBody).
 */
export async function sentMultipart(
  init: RequestInit,
  sent?: Uint8Array<ArrayBuffer>
): Promise<FormData> {
  expect(init.body).toBeInstanceOf(ReadableStream);
  expect((init as RequestInit & { duplex?: string }).duplex).toBe("half");
  // Without it, fetch tees a streamed body to be able to replay it on a
  // redirect, keeping every byte sent in memory until the response.
  expect(init.redirect).toBe("error");

  const headers = init.headers as Record<string, string>;
  const contentType = headers["Content-Type"];
  expect(contentType).toMatch(/^multipart\/form-data; boundary=\S+$/);

  const bytes =
    sent ??
    new Uint8Array(
      await new Response(init.body as ReadableStream).arrayBuffer()
    );
  expect(headers["Content-Length"]).toBe(String(bytes.length));

  // Response#formData() (Node's undici) builds each file part with the
  // global File, then insists it is its own realm's File. Under jsdom the
  // global is jsdom's, so swap Node's in for the parse.
  const jsdomFile = globalThis.File;
  globalThis.File = NodeFile as unknown as typeof File;
  try {
    return await new Response(bytes, {
      headers: { "content-type": contentType },
    }).formData();
  } finally {
    globalThis.File = jsdomFile;
  }
}

// Plain arrays: jsdom and Node each have their own Uint8Array, and toEqual
// treats the two realms' instances as different even with equal bytes.
export async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
