// Builds a single-file multipart/form-data request body as a stream.
//
// The route handlers receive uploads as raw bodies (Front Door's WAF blocks
// multipart bodies from the browser) and forward them to the API as the
// multipart `file` part it expects. The file's bytes are piped through as
// they arrive, never gathered into a Blob and a FormData: that copies the
// whole upload two more times (a 200 MB recording took a process from ~60 MB
// to ~790 MB RSS), against the web pod's 512 MiB memory limit. See
// app/api/upload/route.ts for the rest of what keeps an upload out of memory.

/** A file whose bytes are still arriving, e.g. a request body. */
export interface UploadFile {
  /** Must yield exactly `size` bytes, or error. */
  content: ReadableStream<Uint8Array>;
  size: number;
  filename: string;
  contentType: string;
}

export interface MultipartBody {
  body: ReadableStream<Uint8Array>;
  /** Content-Type header value, including the boundary. */
  contentType: string;
  /** Byte length of `body`, for the Content-Length header. */
  contentLength: number;
}

// The WHATWG multipart/form-data encoding, as FormData itself serialises a
// name or filename: escape what would end the quoted string or the line.
function escapeQuoted(value: string): string {
  return value.replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");
}

export function multipartFileBody(
  fieldName: string,
  file: UploadFile
): MultipartBody {
  const boundary = `----TranscribeWebBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const contentType = /[\r\n]/.test(file.contentType)
    ? "application/octet-stream"
    : file.contentType;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${escapeQuoted(fieldName)}"; filename="${escapeQuoted(file.filename)}"\r\n` +
      `Content-Type: ${contentType}\r\n` +
      "\r\n"
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

  const reader = file.content.getReader();
  let headSent = false;
  const body = new ReadableStream<Uint8Array>({
    // Pull-based, so the file's bytes are read only as fast as the API
    // accepts them.
    async pull(controller) {
      if (!headSent) {
        headSent = true;
        controller.enqueue(head);
        return;
      }
      // A content stream that errors (e.g. a size mismatch) errors this
      // body too, which aborts the request to the API.
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(tail);
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.byteLength + file.size + tail.byteLength,
  };
}
