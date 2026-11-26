import "server-only";

/**
 * Local development without Entra: sign in as a seeded persona
 * (`/auth/dev-login`) and call the API through a dev-only proxy (`/api/*`).
 *
 * Hard-disabled unless login is off (AUTH_ENABLED is not "true") and this is
 * not a production build (NODE_ENV is not "production"). Every dev-only route
 * and code path asks this one function, and each has a test that it refuses
 * when either condition fails.
 */
export function isDevLoginEnabled(): boolean {
  return (
    process.env.AUTH_ENABLED !== "true" && process.env.NODE_ENV !== "production"
  );
}
