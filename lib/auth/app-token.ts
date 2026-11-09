import "server-only";
import {
  type SessionContext,
  contextHeaderValue,
  contextOf,
  type MeResponse,
  type TokenResponse,
} from "@/lib/access/types";
import type { Session } from "@/lib/auth/session-store";

/**
 * The BenchNotes access token (DIAAT-373). The API mints it from the Entra ID
 * token at `POST /api/auth/session`; the web keeps it in the server-side
 * session and sends it on every other API call. The browser never holds it.
 */

/** The API's base URL from the server: the internal address in deployment. */
export function backendUrl(): string {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/+$/, "");
}

/** Re-mint when the token is this close to expiry (authz contract, section 2). */
export const REMINT_WITHIN_MS = 60_000;

const BACKEND_TIMEOUT_MS = 10_000;

/** The API refused or could not be reached. `status` is 0 when unreachable. */
export class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The API's JSON body, when it sent one. */
    readonly body?: unknown
  ) {
    super(message);
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asTokenResponse(body: unknown): TokenResponse {
  const value = body as Partial<TokenResponse> | undefined;
  if (
    !value ||
    typeof value.token !== "string" ||
    !value.token ||
    typeof value.expires_at !== "string" ||
    !value.me ||
    typeof value.me !== "object"
  ) {
    throw new BackendError(502, "The API's token response was malformed");
  }
  if (Number.isNaN(Date.parse(value.expires_at))) {
    throw new BackendError(502, "The API's token expiry was malformed");
  }
  return value as TokenResponse;
}

async function backendJson(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${backendUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BackendError(
      0,
      `The API could not be reached: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const body = await parseBody(response);
  if (!response.ok) {
    throw new BackendError(
      response.status,
      `The API answered ${response.status} for ${init.method ?? "GET"} ${path}`,
      body
    );
  }
  return body;
}

export interface MintParams {
  /** The Entra ID token. */
  idToken?: string;
  /** Local development only: sign in as this seeded persona instead. */
  devPersona?: string;
  /** Kept at a re-mint; the API honours it only if the user still holds it. */
  requestedContext?: SessionContext | null;
}

/** `POST /api/auth/session`: the only route that takes the Entra ID token. */
export async function mintAppToken(
  params: MintParams,
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.devPersona) {
    headers["X-Dev-Persona"] = params.devPersona;
  } else if (params.idToken) {
    headers.Authorization = `Bearer ${params.idToken}`;
  }
  if (params.requestedContext) {
    headers["X-Requested-Context"] = contextHeaderValue(params.requestedContext);
  }
  return asTokenResponse(
    await backendJson(
      "/api/auth/session",
      { method: "POST", headers },
      fetchImpl
    )
  );
}

/** A no-context call made as the session's user, with the session's token. */
export async function backendCallWithToken(
  path: string,
  token: string,
  init: { method: string; body?: unknown },
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  return backendJson(
    path,
    {
      method: init.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    },
    fetchImpl
  );
}

/** What a token response puts into the session. */
export function withToken(
  session: Session,
  minted: Pick<TokenResponse, "token" | "expires_at" | "me">
): Session {
  return {
    ...session,
    appToken: minted.token,
    appTokenExpiresAt: Date.parse(minted.expires_at),
    // What the API says is active: the choice, an automatic one, or none.
    context: contextOf(minted.me.active),
  };
}

/** The same, from the body of PUT /api/me/context or DELETE /api/me/jurisdictions/{code}. */
export function asContextResponse(body: unknown): TokenResponse {
  return asTokenResponse(body);
}

export type { MeResponse };
