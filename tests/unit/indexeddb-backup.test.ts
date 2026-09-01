import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBBackup } from "@/lib/indexeddb-backup";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

// ─── Minimal IndexedDB fake ───────────────────────────────────────────────────

function makeStore(records: Map<string, any>) {
  return {
    put: (value: any) =>
      makeRequest(undefined, () => records.set(value.id, value)),
    get: (id: string) => makeRequest(records.get(id) ?? null),
    getAll: () => makeRequest(Array.from(records.values())),
    delete: (id: string) => makeRequest(undefined, () => records.delete(id)),
    createIndex: vi.fn(),
  };
}

function makeRequest(result: any, sideEffect?: () => void) {
  const req: any = { onsuccess: null, onerror: null };
  setTimeout(() => {
    sideEffect?.();
    req.result = result;
    req.onsuccess?.({ target: req });
  }, 0);
  return req;
}

function makeDB(records: Map<string, any>) {
  const storeNames = { contains: vi.fn(() => true) };
  const store = makeStore(records);
  return {
    objectStoreNames: storeNames,
    transaction: () => ({ objectStore: () => store }),
    close: vi.fn(),
  };
}

function setupIndexedDB(records = new Map<string, any>()) {
  const db = makeDB(records);
  const openReq: any = {
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  setTimeout(() => {
    openReq.result = db;
    openReq.onsuccess?.();
  }, 0);

  Object.defineProperty(global, "indexedDB", {
    writable: true,
    value: { open: vi.fn(() => openReq) },
  });

  return { db, records };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IndexedDBBackup.generateBackupId", () => {
  it("returns a string starting with 'backup_'", () => {
    const id = IndexedDBBackup.generateBackupId();
    expect(id.startsWith("backup_")).toBe(true);
  });

  it("generates unique IDs on successive calls", () => {
    const a = IndexedDBBackup.generateBackupId();
    const b = IndexedDBBackup.generateBackupId();
    expect(a).not.toBe(b);
  });
});

describe("IndexedDBBackup CRUD", () => {
  let db: IndexedDBBackup;

  beforeEach(() => {
    setupIndexedDB();
    db = new IndexedDBBackup();
  });

  it("saveAudioBackup resolves without error", async () => {
    const backup = {
      id: "b1",
      blob: new Blob(["audio"]),
      fileName: "rec.webm",
      timestamp: Date.now(),
      mimeType: "audio/webm",
    };
    await expect(db.saveAudioBackup(backup)).resolves.toBeUndefined();
  });

  it("getAudioBackup returns the saved backup", async () => {
    const records = new Map([["b1", { id: "b1", fileName: "rec.webm" }]]);
    setupIndexedDB(records);
    db = new IndexedDBBackup();
    const result = await db.getAudioBackup("b1");
    expect(result?.id).toBe("b1");
  });

  it("getAudioBackup returns null for missing id", async () => {
    setupIndexedDB(new Map());
    db = new IndexedDBBackup();
    const result = await db.getAudioBackup("missing");
    expect(result).toBeNull();
  });

  it("getAllAudioBackups returns all records", async () => {
    const records = new Map([
      ["b1", { id: "b1" }],
      ["b2", { id: "b2" }],
    ]);
    setupIndexedDB(records);
    db = new IndexedDBBackup();
    const result = await db.getAllAudioBackups();
    expect(result.length).toBe(2);
  });

  it("deleteAudioBackup resolves without error", async () => {
    const records = new Map([["b1", { id: "b1" }]]);
    setupIndexedDB(records);
    db = new IndexedDBBackup();
    await expect(db.deleteAudioBackup("b1")).resolves.toBeUndefined();
  });
});
