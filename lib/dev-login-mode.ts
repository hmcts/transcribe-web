import { getEnv } from "@/lib/env";

/**
 * Local development with seeded personas instead of Entra (DIAAT-373): the
 * header shows a persona picker and the browser calls the API through this
 * app's own `/api/*` dev proxy, which attaches the session's token (the stand-in
 * for Caddy's forward_auth).
 *
 * Opt-in with NEXT_PUBLIC_DEV_LOGIN=true, and never in a production build. The
 * server side enforces its own rule independently (lib/auth/dev-mode.ts): its
 * routes answer 404 when login is on or in production, whatever this says.
 */
export function isDevLoginMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    getEnv("NEXT_PUBLIC_DEV_LOGIN")?.toLowerCase() === "true"
  );
}
