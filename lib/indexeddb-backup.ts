import * as Sentry from "@sentry/nextjs";

interface AudioBackup {
  id: string;
  blob: Blob;
  fileName: string;
  timestamp: number;
  mimeType: string;
  recordingDuration?: number;
}

interface AudioChunk {
  id: string;
  chunkIndex: number;
  data: Blob;
  timestamp: number;
}

class IndexedDBBackup {
  private dbName = "AudioBackupDB";

  private version = 4;

  private storeName = "audioBackups";

  private chunksStoreName = "audioChunks";

  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (event) => {
        const errorMsg =
          (event.target as IDBOpenDBRequest).error?.message || "Unknown error";
        const error = new Error(`Failed to open IndexedDB: ${errorMsg}`);
        console.error("[IndexedDB] Open error:", error);
        Sentry.captureException(error);
        reject(error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create audioBackups store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }

        // Create audioChunks store for streaming chunks
        if (!db.objectStoreNames.contains(this.chunksStoreName)) {
          const chunksStore = db.createObjectStore(this.chunksStoreName, {
            keyPath: ["id", "chunkIndex"],
          });
          chunksStore.createIndex("id", "id", { unique: false });
          chunksStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }

  async saveAudioBackup(backup: AudioBackup): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    // Check if the required object store exists
    if (!this.db?.objectStoreNames.contains(this.storeName)) {
      console.warn(
        "[IndexedDB] Object store not found, reinitializing database..."
      );
      // Close the current connection
      this.db?.close();
      this.db = null;
      // Reinitialize with the correct version
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db?.transaction([this.storeName], "readwrite");
      const store = transaction?.objectStore(this.storeName);
      if (!store) {
        reject(new Error("Failed to save audio backup"));
        return;
      }
      const request = store.put(backup);
      if (!request) {
        reject(new Error("Failed to save audio backup"));
        return;
      }

      request.onerror = () => {
        reject(new Error("Failed to save audio backup"));
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  async getAudioBackup(id: string): Promise<AudioBackup | null> {
    if (!this.db) {
      await this.init();
    }

    // Check if the required object store exists
    if (!this.db?.objectStoreNames.contains(this.storeName)) {
      console.warn(
        "[IndexedDB] Object store not found, reinitializing database..."
      );
      // Close the current connection
      this.db?.close();
      this.db = null;
      // Reinitialize with the correct version
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db?.transaction([this.storeName], "readonly");
      const store = transaction?.objectStore(this.storeName);
      if (!store) {
        reject(new Error("Failed to get audio backup"));
        return;
      }
      const request = store.get(id);
      if (!request) {
        reject(new Error("Failed to get audio backup"));
        return;
      }

      request.onerror = () => {
        reject(new Error("Failed to get audio backup"));
      };

      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  }

  async getAllAudioBackups(): Promise<AudioBackup[]> {
    if (!this.db) {
      await this.init();
    }

    // Check if the required object store exists
    if (!this.db?.objectStoreNames.contains(this.storeName)) {
      console.warn(
        "[IndexedDB] Object store not found, reinitializing database..."
      );
      // Close the current connection
      this.db?.close();
      this.db = null;
      // Reinitialize with the correct version
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db?.transaction([this.storeName], "readonly");
      const store = transaction?.objectStore(this.storeName);
      const request = store?.getAll();
      if (!request) {
        reject(new Error("Failed to get all audio backups"));
        return;
      }

      request.onerror = (event) => {
        const errorMsg =
          (event.target as IDBRequest).error?.message || "Unknown error";
        const error = new Error(`Failed to get all audio backups: ${errorMsg}`);
        console.error("[IndexedDB] Get all error:", error);
        Sentry.captureException(error);
        reject(error);
      };

      request.onsuccess = () => {
        const result = request.result || [];
        resolve(result);
      };
    });
  }

  async deleteAudioBackup(id: string): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    // Check if the required object store exists
    if (!this.db?.objectStoreNames.contains(this.storeName)) {
      console.warn(
        "[IndexedDB] Object store not found, reinitializing database..."
      );
      // Close the current connection
      this.db?.close();
      this.db = null;
      // Reinitialize with the correct version
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db?.transaction([this.storeName], "readwrite");
      const store = transaction?.objectStore(this.storeName);
      if (!store) {
        reject(new Error("Failed to delete audio backup"));
        return;
      }
      const request = store.delete(id);
      if (!request) {
        reject(new Error("Failed to delete audio backup"));
        return;
      }

      request.onerror = () => {
        const error = new Error(`Failed to delete audio backup with id: ${id}`);
        Sentry.captureException(error);
        reject(error);
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  static generateBackupId(): string {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const audioBackupDB = new IndexedDBBackup();
export type { AudioBackup, AudioChunk };
export { IndexedDBBackup };
