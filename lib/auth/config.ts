import "server-only";

/**
 * Server-side configuration for the frontend's own Entra ID login.
 *
 * On CNP (AKS) there is no App Service Easy Auth, so this app runs the login
 * itself — the CNP pattern for internal users, as in DARTS: an OIDC
 * authorization-code flow on the server, tokens in a server-side session, and
 * the API called with the session's bearer token. The browser only ever holds
 * an opaque session cookie.
 *
 * Read per call rather than at import: secrets are mounted as files and loaded
 * into process.env by start.js at container start, and tests set env vars.
 */
export interface AuthConfig {
  /** When false (local development, preview), no login is required. */
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Public origin of this app; the redirect URI is `${appUrl}/auth/callback`. */
  appUrl: string;
  redisUrl: string | undefined;
  /** Only for a local mock identity provider served over http. Never set in charts. */
  allowInsecureIssuer: boolean;
  sessionTtlSeconds: number;
}

export const AUTH_SCOPES = "openid profile email offline_access";

export function getAuthConfig(): AuthConfig {
  const env = process.env;
  const tenantId = env.AZURE_AD_TENANT_ID ?? "";
  return {
    enabled: env.AUTH_ENABLED === "true",
    issuer:
      env.AUTH_ISSUER ?? `https://login.microsoftonline.com/${tenantId}/v2.0`,
    clientId: env.AZURE_AD_CLIENT_ID ?? "",
    clientSecret: env.AZURE_AD_CLIENT_SECRET ?? "",
    appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    redisUrl: env.REDIS_URL || undefined,
    allowInsecureIssuer: env.AUTH_ALLOW_INSECURE_ISSUER === "true",
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS ?? 12 * 60 * 60),
  };
}

/** Fail loudly on a half-configured deployment rather than at a user's first login. */
export function assertAuthConfigured(config: AuthConfig): void {
  const missing = [
    !config.clientId && "AZURE_AD_CLIENT_ID",
    !config.clientSecret && "AZURE_AD_CLIENT_SECRET",
    !process.env.AUTH_ISSUER &&
      !process.env.AZURE_AD_TENANT_ID &&
      "AZURE_AD_TENANT_ID",
    !process.env.APP_URL && "APP_URL",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Login is enabled but not configured: ${missing.join(", ")}`
    );
  }
}
