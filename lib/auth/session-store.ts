import "server-only";
import { createClient } from "redis";
import { getAuthConfig } from "@/lib/auth/config";

/** What the server keeps for a signed-in user. Never sent to the browser. */
export interface Session {
  idToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  idTokenExpiresAt: number;
  user: { oid: string; name: string; email: string; roles: string[] };
  createdAt: number;
}

/** State held between sending the user to Entra and their return. */
export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/**
 * Redis-backed in deployed environments, like DARTS. Sessions must be shared
 * across replicas and survive a pod restart, so an in-memory store is only
 * allowed outside production (local runs, tests).
 */
class MemoryStore implements KeyValueStore {
  private data = new Map<string, { value: string; expiresAt: number }>();
  async get(key: string) {
    const hit = this.data.get(key);
    if (!hit || hit.expiresAt < Date.now()) {
      this.data.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string) {
    this.data.delete(key);
  }
}

class RedisStore implements KeyValueStore {
  private client: ReturnType<typeof createClient>;
  private ready: Promise<unknown>;
  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on("error", (err) => console.error("[auth] redis error", err));
    this.ready = this.client.connect();
  }
  async get(key: string) {
    await this.ready;
    return (await this.client.get(key)) as string | null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.ready;
    await this.client.set(key, value, { EX: ttlSeconds });
  }
  async del(key: string) {
    await this.ready;
    await this.client.del(key);
  }
}

let store: KeyValueStore | undefined;

function getStore(): KeyValueStore {
  if (store) return store;
  const { redisUrl, enabled } = getAuthConfig();
  if (redisUrl) {
    store = new RedisStore(redisUrl);
  } else if (enabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "REDIS_URL is not set. Sessions must be in Redis when login is enabled, or they are lost on restart and not shared across replicas."
    );
  } else {
    store = new MemoryStore();
  }
  return store;
}

/** Tests only. */
export function __resetStoreForTests(): void {
  store = undefined;
}

const SESSION_PREFIX = "transcribe:session:";
const LOGIN_PREFIX = "transcribe:login:";
const PENDING_LOGIN_TTL_SECONDS = 10 * 60;

export async function readSession(id: string): Promise<Session | null> {
  const raw = await getStore().get(SESSION_PREFIX + id);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function writeSession(
  id: string,
  session: Session
): Promise<void> {
  const { sessionTtlSeconds } = getAuthConfig();
  // Absolute lifetime measured from sign-in, not extended by activity.
  const remaining = Math.ceil(
    (session.createdAt + sessionTtlSeconds * 1000 - Date.now()) / 1000
  );
  if (remaining <= 0) {
    await deleteSession(id);
    return;
  }
  await getStore().set(SESSION_PREFIX + id, JSON.stringify(session), remaining);
}

export async function deleteSession(id: string): Promise<void> {
  await getStore().del(SESSION_PREFIX + id);
}

export async function writePendingLogin(login: PendingLogin): Promise<void> {
  await getStore().set(
    LOGIN_PREFIX + login.state,
    JSON.stringify(login),
    PENDING_LOGIN_TTL_SECONDS
  );
}

/** Single use: removed as it is read, so a callback cannot be replayed. */
export async function takePendingLogin(
  state: string
): Promise<PendingLogin | null> {
  const key = LOGIN_PREFIX + state;
  const raw = await getStore().get(key);
  if (!raw) return null;
  await getStore().del(key);
  return JSON.parse(raw) as PendingLogin;
}
