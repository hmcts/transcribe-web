/**
 * PR previews (DIAAT-399) have no Entra: per-PR hostnames cannot be redirect URIs, so
 * the web app runs with AUTH_ENABLED=false and the API (ENVIRONMENT=preview,
 * AUTH_PREVIEW_USER_ENABLED=true) signs in a fixed preview user, given every role, when
 * a sign-in carries no Entra token. This is the web's side of that: with
 * PREVIEW_USER_SIGN_IN=true a browser with no session is signed in as that user
 * (`/auth/preview-login`), and the session is then an ordinary one with a BenchNotes
 * token.
 *
 * Impossible when login is on (AUTH_ENABLED=true), and off unless the variable is set,
 * which only the PR-preview chart values do. Every preview-only route and code path
 * asks this one function, and each has a test that it refuses when either condition
 * fails. No `server-only` import: proxy.ts reads it too.
 */
export function isPreviewSignInEnabled(): boolean {
  return (
    process.env.AUTH_ENABLED !== "true" &&
    process.env.PREVIEW_USER_SIGN_IN === "true"
  );
}
