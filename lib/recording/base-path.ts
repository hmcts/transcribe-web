// Prefix for the recording area's client-side fetches to its own route
// handlers (app/api/jobs, app/api/upload, app/api/audio, app/api/version).
//
// The recording area used to be a separate app served under a /batch
// basePath. In the merged app it lives at /recording and its route handlers
// are at the root, so there is no prefix: Caddy routes exactly /api/jobs,
// /api/jobs/*, /api/upload, /api/audio/* and /api/version to Next.js (the
// @next_api matcher in the Caddyfile), and anything else under /api/* to the
// backend. A /batch prefix misses that matcher and 404s.
//
// NEXT_PUBLIC_BASE_PATH is inlined at build time; leave it unset. It is kept
// only so a build can still opt into a prefix, which would also need a
// matching basePath in next.config.js and Caddyfile changes.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
