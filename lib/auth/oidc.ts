import "server-only";
import * as client from "openid-client";
import {
  AUTH_SCOPES,
  assertAuthConfigured,
  getAuthConfig,
} from "@/lib/auth/config";
import type { PendingLogin, Session } from "@/lib/auth/session-store";

let configPromise: Promise<client.Configuration> | undefined;
let configKey = "";

/** Discovery is cached per issuer/client; a failed attempt is not cached. */
async function getOidcConfiguration(): Promise<client.Configuration> {
  const cfg = getAuthConfig();
  assertAuthConfigured(cfg);
  const key = `${cfg.issuer}|${cfg.clientId}`;
  if (!configPromise || configKey !== key) {
    configKey = key;
    configPromise = client
      .discovery(
        new URL(cfg.issuer),
        cfg.clientId,
        cfg.clientSecret,
        undefined,
        cfg.allowInsecureIssuer
          ? { execute: [client.allowInsecureRequests] }
          : undefined
      )
      .catch((err) => {
        configPromise = undefined;
        throw err;
      });
  }
  return configPromise;
}

/** Tests only. */
export function __resetOidcForTests(): void {
  configPromise = undefined;
  configKey = "";
}

export function redirectUri(): string {
  return `${getAuthConfig().appUrl}/auth/callback`;
}

/** Build the Entra authorize URL. PKCE, state and nonce are all used. */
export async function beginLogin(
  returnTo: string
): Promise<{ url: URL; pending: PendingLogin }> {
  const config = await getOidcConfiguration();
  const codeVerifier = client.randomPKCECodeVerifier();
  const pending: PendingLogin = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
    returnTo,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: AUTH_SCOPES,
    response_type: "code",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state: pending.state,
    nonce: pending.nonce,
  });
  return { url, pending };
}

type TokenResponse = Awaited<ReturnType<typeof client.authorizationCodeGrant>>;

function sessionFromTokens(tokens: TokenResponse, previous?: Session): Session {
  const claims = tokens.claims();
  if (!tokens.id_token || !claims) {
    throw new Error("Token response did not include an ID token");
  }
  const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
  return {
    idToken: tokens.id_token,
    // Entra may or may not rotate the refresh token; keep the old one if not.
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    idTokenExpiresAt: (claims.exp as number) * 1000,
    user: {
      oid: String(claims.oid ?? claims.sub ?? ""),
      name: String(claims.name ?? ""),
      email: String(claims.email ?? claims.preferred_username ?? ""),
      roles,
    },
    createdAt: previous?.createdAt ?? Date.now(),
  };
}

/**
 * Exchange the authorization code. The callback URL is rebuilt on the public
 * origin: behind Caddy the request arrives on 127.0.0.1:3001, and the
 * redirect_uri sent with the code must match the registered one exactly.
 */
export async function completeLogin(
  callbackSearch: string,
  pending: PendingLogin
): Promise<Session> {
  const config = await getOidcConfiguration();
  const currentUrl = new URL(`${redirectUri()}${callbackSearch}`);
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  });
  return sessionFromTokens(tokens);
}

/** Refresh the ID token if it expires within `withinSeconds`. */
export async function refreshIfNeeded(
  session: Session,
  withinSeconds = 5 * 60
): Promise<Session | null> {
  if (session.idTokenExpiresAt - Date.now() > withinSeconds * 1000) {
    return session;
  }
  if (!session.refreshToken) return null;
  const config = await getOidcConfiguration();
  try {
    const tokens = await client.refreshTokenGrant(
      config,
      session.refreshToken,
      {
        scope: AUTH_SCOPES,
      }
    );
    return sessionFromTokens(tokens, session);
  } catch (err) {
    console.warn("[auth] token refresh failed; session ends", err);
    return null;
  }
}

export async function endSessionUrl(idTokenHint?: string): Promise<URL> {
  const config = await getOidcConfiguration();
  return client.buildEndSessionUrl(config, {
    post_logout_redirect_uri: getAuthConfig().appUrl,
    ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
  });
}
