/**
 * Blob storage utilities — path handling and server-side backend integration.
 *
 * Blob URL structure:
 *   https://{account}.blob.core.windows.net/{container}/user-uploads/{email}/{relativePath}
 *
 * ─── CLIENT-SAFE ─────────────────────────────────────────────────────────────
 * These functions are pure URL/string manipulation and work in any runtime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const USER_UPLOADS_MARKER = "/user-uploads/";

/**
 * Extracts the path relative to the user's root in blob storage.
 *
 * "https://account.blob.core.windows.net/container/user-uploads/user@example.com/sub/file.docx"
 *   → "sub/file.docx"
 *
 * Supports nested subfolders. Throws if the URL doesn't match the expected structure.
 */
export function extractRelativeBlobPath(documentUrl: string): string {
  const { pathname } = new URL(documentUrl);
  const markerIdx = pathname.indexOf(USER_UPLOADS_MARKER);
  if (markerIdx === -1) {
    throw new Error(
      `Unexpected blob URL — missing "${USER_UPLOADS_MARKER}" segment: ${pathname}`
    );
  }
  // afterMarker = "user@email.com/sub/file.docx"
  const afterMarker = pathname.slice(markerIdx + USER_UPLOADS_MARKER.length);
  const emailEnd = afterMarker.indexOf("/");
  if (emailEnd === -1 || emailEnd === afterMarker.length - 1) {
    throw new Error(
      `No relative path found after user segment in blob URL: ${pathname}`
    );
  }
  return afterMarker.slice(emailEnd + 1); // "sub/file.docx"
}

/**
 * Builds the full blob path for a given user email and relative path.
 * Used server-side to construct the path passed to the backend for SAS token generation.
 *
 * buildUserBlobPath("user@example.com", "sub/file.docx")
 *   → "user-uploads/user@example.com/sub/file.docx"
 */
export function buildUserBlobPath(
  userEmail: string,
  relativePath: string
): string {
  return `user-uploads/${userEmail}/${relativePath}`;
}

/**
 * Validates a client-supplied relative blob path.
 * - Non-empty
 * - No path traversal sequences (.. or .)
 * - Not absolute
 * - No empty segments (double slashes)
 */
export function isValidRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  return path
    .split("/")
    .every((seg) => seg.length > 0 && seg !== ".." && seg !== ".");
}

/**
 * ─── SERVER-ONLY ─────────────────────────────────────────────────────────────
 * The functions below use Node.js APIs (Buffer) and must only be called from
 * server-side routes (App Router route handlers, server components).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Extracts the authenticated user's email from the EasyAuth X-MS-CLIENT-PRINCIPAL
 * header on the incoming request.
 *
 * This header is injected by Azure App Service EasyAuth after validating the user's
 * JWT. The infrastructure strips any client-supplied header of this name, so its
 * presence guarantees the user has already been authenticated upstream.
 */
export function getEmailFromEasyAuth(request: Request): string | null {
  const principalHeader = request.headers.get("x-ms-client-principal");
  if (!principalHeader) return null;
  try {
    const decoded = Buffer.from(principalHeader, "base64").toString("utf-8");
    const principal = JSON.parse(decoded) as {
      claims?: Array<{ typ: string; val: string }>;
    };
    const emailClaim = (principal.claims ?? []).find(
      (c) =>
        c.typ === "preferred_username" ||
        c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn" ||
        c.typ === "upn"
    );
    return emailClaim?.val ?? null;
  } catch {
    return null;
  }
}

/**
 * Builds the header set for server-to-backend calls, forwarding EasyAuth identity
 * headers from the original request and promoting the AAD access token to
 * Authorization: Bearer so that EasyAuth on the backend App Service accepts the call.
 *
 * Content-Type defaults to application/json. Content-Length and host/connection
 * are excluded so they don't conflict with the outbound request.
 */
export function buildBackendAuthHeaders(request: Request): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  const excluded = new Set([
    "host",
    "connection",
    "content-type",
    "content-length",
  ]);
  for (const [key, value] of request.headers.entries()) {
    if (!excluded.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Explicitly forward EasyAuth identity headers by name — platform-injected headers
  // are accessible via .get() but may be absent from .entries() in Next.js App Router.
  const easyAuthHeaders = [
    "x-ms-client-principal",
    "x-ms-client-principal-id",
    "x-ms-client-principal-name",
    "x-ms-client-principal-idp",
  ];
  for (const name of easyAuthHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Forward Authorization, falling back to the EasyAuth AAD access token if absent.
  const existingAuth = request.headers.get("authorization");
  const aadToken = request.headers.get("x-ms-token-aad-access-token");
  if (existingAuth) {
    headers.set("Authorization", existingAuth);
  } else if (aadToken) {
    headers.set("Authorization", `Bearer ${aadToken}`);
  }

  return headers;
}

/**
 * Creates a JSON error Response, forwarding any request_id from the upstream
 * response body so that client-side error reporting (ErrorReportCard) can include it.
 *
 * Falls back gracefully when the upstream body is not JSON (e.g. blob storage XML errors).
 */
export async function forwardBackendError(
  message: string,
  upstream: Response
): Promise<Response> {
  const responseText = await upstream.text().catch(() => "<unreadable>");

  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // eslint-disable-next-line no-console
  console.error(`[backend-call] ${message}`, {
    status: upstream.status,
    statusText: upstream.statusText,
    url: upstream.url,
    headers,
    body: responseText,
  });

  let requestId: string | undefined;
  try {
    const body = JSON.parse(responseText) as { request_id?: string };
    requestId = body?.request_id;
  } catch {
    // upstream body is not JSON — no request_id to forward
  }

  return Response.json(
    { error: message, ...(requestId ? { request_id: requestId } : {}) },
    { status: upstream.status }
  );
}

/**
 * Fetches a blob from a SAS URL and returns a proxied HTTP Response.
 * Forwards Content-Type, Content-Disposition, Content-Length, and Content-Range.
 *
 * @param blobUrl              The SAS-authenticated blob storage URL to fetch.
 * @param rangeHeader          Optional Range header value (for audio seeking).
 * @param extraResponseHeaders Additional headers to set on the returned Response.
 */
export async function proxyBlobResponse(
  blobUrl: string,
  options: {
    rangeHeader?: string | null;
    extraResponseHeaders?: Record<string, string>;
  } = {}
): Promise<Response> {
  const fetchHeaders: Record<string, string> = {};
  if (options.rangeHeader) {
    fetchHeaders.Range = options.rangeHeader;
  }

  const blobResponse = await fetch(blobUrl, { headers: fetchHeaders });

  if (!blobResponse.ok) {
    return new Response("Failed to fetch file", {
      status: blobResponse.status,
    });
  }

  const headers = new Headers(options.extraResponseHeaders);
  for (const h of [
    "Content-Type",
    "Content-Disposition",
    "Content-Length",
    "Content-Range",
  ]) {
    const val = blobResponse.headers.get(h);
    if (val) headers.set(h, val);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }

  return new Response(blobResponse.body, {
    status: blobResponse.status,
    headers,
  });
}
