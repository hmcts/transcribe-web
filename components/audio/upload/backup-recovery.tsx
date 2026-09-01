"use client";

import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { type AudioBackup, audioBackupDB } from "@/lib/indexeddb-backup";

const DANGER_GHOST_BUTTON_CLASS =
  "text-destructive hover:bg-destructive/10 hover:text-destructive";

interface BackupRecoveryProps {
  onRetryUpload: (backup: AudioBackup) => void;
}

function BackupRecovery({ onRetryUpload }: BackupRecoveryProps) {
  const [backups, setBackups] = useState<AudioBackup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const loadBackups = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const allBackups = await audioBackupDB.getAllAudioBackups();
      // Sort by timestamp (newest first)
      allBackups.sort((a, b) => b.timestamp - a.timestamp);
      setBackups(allBackups);

      // Auto-collapse if more than 1 recording, otherwise expand
      setIsOpen(allBackups.length <= 1);
    } catch (err) {
      console.error("[BackupRecovery] Failed to load backups:", err);
      const errorDetail = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to load backed up recordings: ${errorDetail}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleDeleteBackup = async (backupId: string) => {
    try {
      await audioBackupDB.deleteAudioBackup(backupId);
      setBackups((prev) => prev.filter((backup) => backup.id !== backupId));
    } catch (_err) {
      setError("Failed to delete backup");
    }
  };

  const handleRetryUpload = (backup: AudioBackup) => {
    onRetryUpload(backup);
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatFileSize = (blob: Blob) => {
    const bytes = blob.size;
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Backed Up Recordings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="size-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">
              Loading backed up recordings...
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={loadBackups}>
            <RefreshCw className="mr-1 size-4" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (backups.length === 0) {
    return null; // Don't show anything if no backups exist
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-background p-4 text-left hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <div className="flex items-center gap-3">
              <Upload className="size-5 text-muted-foreground" />
              <div>
                <h2 className="font-medium text-foreground">
                  Reupload Recordings
                </h2>
                <p className="text-sm text-muted-foreground">
                  {backups.length} recording{backups.length !== 1 ? "s" : ""}{" "}
                  waiting for upload
                </p>
              </div>
              {/* Count badge */}
              <div className="ml-2 flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
                {backups.length}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-4">
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  These recordings were automatically backed up but haven&apos;t
                  been uploaded yet.
                </AlertDescription>
              </Alert>

              {backups.map((backup, index) => (
                <div
                  key={backup.id}
                  className="space-y-3 rounded-lg border border-border bg-muted/40 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">
                        Recording #{backups.length - index} -{" "}
                        {formatTimestamp(backup.timestamp)}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:gap-4">
                        <span>Size: {formatFileSize(backup.blob)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRetryUpload(backup)}
                        className="flex-1 sm:flex-initial"
                      >
                        <RefreshCw className="mr-1 size-3" />
                        Retry Upload
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`flex-1 sm:flex-initial ${DANGER_GHOST_BUTTON_CLASS}`}
                          >
                            <Trash2 className="mr-1 size-3" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete Recording
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete &quot;
                              {backup.fileName}&quot;? This action cannot be
                              undone and you will lose this recording
                              permanently.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteBackup(backup.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export default BackupRecovery;
