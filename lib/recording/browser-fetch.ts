import {
  getTabJurisdiction,
  JURISDICTION_QUERY,
  jurisdictionHeaders,
} from "@/lib/jurisdiction-session";

/**
 * The browser's calls to the hearing recordings routes, naming the tab's
 * jurisdiction (DIAAT-334): the route handlers pass it to the API, which refuses
 * another jurisdiction's recordings.
 */
export function recordingFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const added = jurisdictionHeaders();
  const given = init.headers;
  // A plain object stays one (callers and their tests read it as such); a Headers
  // or a list of pairs becomes Headers.
  if (given === undefined || (!(given instanceof Headers) && !Array.isArray(given))) {
    return fetch(input, { ...init, headers: { ...given, ...added } });
  }
  const headers = new Headers(given);
  for (const [name, value] of Object.entries(added)) headers.set(name, value);
  return fetch(input, { ...init, headers });
}

/** A recordings URL loaded by the browser itself (an <audio> source), which
 * cannot send a header: the tab's jurisdiction goes in the query instead. */
export function withTabJurisdiction(url: string): string {
  const code = getTabJurisdiction();
  if (!code) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${JURISDICTION_QUERY}=${encodeURIComponent(code)}`;
}
