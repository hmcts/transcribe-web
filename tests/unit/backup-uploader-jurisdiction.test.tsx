import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupUploader from "@/components/audio/upload/backup-uploader";
import { apiClient } from "@/lib/api-client";
import { setTabJurisdiction } from "@/lib/jurisdiction-session";

// DIAAT-334: retrying an upload from a backup names the tab's jurisdiction, as the
// first upload does: the API checks its upload key against it.

vi.mock("@/lib/api-client", () => ({
  apiClient: { getUploadUrl: vi.fn(), getToken: vi.fn() },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/indexeddb-backup", () => ({
  audioBackupDB: { deleteAudioBackup: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ setIsProcessingTranscription: vi.fn() }),
}));
vi.mock("@/components/audio/processing/processing-loader", () => ({
  default: () => <p>Processing</p>,
}));

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  upload = { addEventListener: vi.fn() };
  status = 201;
  private listeners: Record<string, () => void> = {};
  constructor() {
    FakeXhr.last = this;
  }
  addEventListener(event: string, listener: () => void) {
    this.listeners[event] = listener;
  }
  open = vi.fn();
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    this.listeners.load?.();
  }
}

const backup = {
  id: "b1",
  blob: new Blob(["audio"], { type: "audio/webm" }),
  fileName: "hearing.webm",
  timestamp: 0,
  mimeType: "audio/webm",
  jurisdiction: "ET",
};

async function retryWith(uploadUrl: string): Promise<FakeXhr> {
  vi.mocked(apiClient.getUploadUrl).mockResolvedValue({
    data: { upload_url: uploadUrl },
  } as Awaited<ReturnType<typeof apiClient.getUploadUrl>>);
  vi.mocked(apiClient.getToken).mockResolvedValue("token");
  const onUploadSuccess = vi.fn();
  render(
    <BackupUploader backup={backup} onClose={vi.fn()} onUploadSuccess={onUploadSuccess} />
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry Upload" }));
  await waitFor(() => expect(onUploadSuccess).toHaveBeenCalled());
  return FakeXhr.last;
}

describe("BackupUploader", () => {
  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    setTabJurisdiction("ET");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setTabJurisdiction(null);
  });

  it("names the tab's jurisdiction on the API's upload route", async () => {
    const xhr = await retryWith("/api/upload-audio?key=k1");
    expect(xhr.headers["X-Jurisdiction"]).toBe("ET");
  });

  it("sends no jurisdiction header straight to storage", async () => {
    const xhr = await retryWith("https://store.blob.core.windows.net/audio/k1?sig=x");
    expect(xhr.headers["X-Jurisdiction"]).toBeUndefined();
  });
});
