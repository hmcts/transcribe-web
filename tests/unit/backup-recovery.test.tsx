import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/indexeddb-backup", () => ({
  audioBackupDB: {
    getAllAudioBackups: vi.fn(),
    deleteAudioBackup: vi.fn(),
  },
}));

import BackupRecovery from "@/components/audio/upload/backup-recovery";
import { audioBackupDB } from "@/lib/indexeddb-backup";

const BACKUP = {
  id: "b1",
  fileName: "recording.webm",
  timestamp: new Date("2025-01-15T10:00:00Z").getTime(),
  blob: new Blob(["audio"], { type: "audio/webm" }),
  mimeType: "audio/webm",
};

describe("BackupRecovery", () => {
  it("renders nothing when there are no backups", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockResolvedValue([]);
    const { container } = render(<BackupRecovery onRetryUpload={vi.fn()} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("shows a card when backups exist", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockResolvedValue([BACKUP]);
    render(<BackupRecovery onRetryUpload={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Reupload Recordings")).toBeTruthy()
    );
  });

  it("shows backup count badge", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockResolvedValue([BACKUP]);
    render(<BackupRecovery onRetryUpload={vi.fn()} />);
    await waitFor(() => screen.getByText("1 recording waiting for upload"));
    expect(screen.getByText("1 recording waiting for upload")).toBeTruthy();
  });

  it("shows error alert when load fails", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockRejectedValue(
      new Error("DB error")
    );
    render(<BackupRecovery onRetryUpload={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load/)).toBeTruthy()
    );
  });

  it("calls onRetryUpload when Retry Upload is clicked", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockResolvedValue([BACKUP]);
    const onRetryUpload = vi.fn();
    render(<BackupRecovery onRetryUpload={onRetryUpload} />);
    await waitFor(() => screen.getByText("Retry Upload"));
    fireEvent.click(screen.getByText("Retry Upload"));
    expect(onRetryUpload).toHaveBeenCalledWith(BACKUP);
  });

  it("calls deleteAudioBackup after delete confirmation", async () => {
    vi.mocked(audioBackupDB.getAllAudioBackups).mockResolvedValue([BACKUP]);
    vi.mocked(audioBackupDB.deleteAudioBackup).mockResolvedValue(undefined);

    render(<BackupRecovery onRetryUpload={vi.fn()} />);
    await waitFor(() => screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => screen.getByText("Delete Recording"));
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() =>
      expect(audioBackupDB.deleteAudioBackup).toHaveBeenCalledWith("b1")
    );
  });
});
