"use client";

import { ChevronDown, ChevronLeft, History } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobProgress } from "@/components/recording/job-status/job-progress";
import { JobStatusBadge } from "@/components/recording/job-status/job-status-badge";
import { AddAudioPanel } from "@/components/recording/transcript/add-audio-panel";
import { AudioPlayerBar } from "@/components/recording/transcript/audio-player-bar";
import {
  ChangeHearingDate,
  DayWithoutTranscript,
  HearingDayHeader,
} from "@/components/recording/transcript/hearing-day-controls";
import { ModificationHistoryTable } from "@/components/recording/transcript/modification-history-table";
import { NeedsReviewPanel } from "@/components/recording/transcript/needs-review-panel";
import { RecordingHistory } from "@/components/recording/transcript/recording-history";
import { TranscriptAccuracy } from "@/components/recording/transcript/transcript-accuracy";
import { TranscriptSegment } from "@/components/recording/transcript/transcript-segment";
import { useJurisdictionSwitchGuard } from "@/hooks/use-jurisdiction-switch-guard";
import { probeForRefusal } from "@/lib/access/refusals";
import { apiPath } from "@/lib/recording/base-path";
import {
  recordingFetch,
  withTabJurisdiction,
} from "@/lib/recording/browser-fetch";
import { formatHearingDate } from "@/lib/recording/hearing-date";
import {
  hasTranscript,
  isInFlight,
  withJob,
  withNewDay,
  withoutDay,
  withSummaryDates,
} from "@/lib/recording/hearing-days";
import { RECORDING_HOME } from "@/lib/recording/routes";
import type {
  Hearing,
  HearingDay,
  HearingSummary,
  TranscriptionJob,
} from "@/lib/recording/types";
import { rawUploadHeaders } from "@/lib/recording/upload-contract";
import { cn } from "@/lib/recording/utils";
import { useMultiDayHearings } from "@/providers/runtime-flags";

const POLL_INTERVAL_MS = 5000;

const SECTION_GONE =
  "This section has changed since the transcript was loaded: it may have been combined with another, for example in another tab. Reload the page to see the latest transcript.";
const ACTION_FAILED = "That change could not be saved. Try again.";

// Persists the reader's audio/transcript sync-highlight preference (DIAAT-246)
// across visits and page reloads.
const SYNC_HIGHLIGHT_STORAGE_KEY = "batch:syncHighlight";

interface HearingDetailViewProps {
  initialHearing: Hearing;
}

/**
 * A hearing's page (DIAAT-428): every day of it, in order, each transcribed
 * on its own. A one-day hearing looks as a recording did before hearings: no
 * day headings. One <audio> element plays one day at a time, the selected day
 * (activeDayId), and the accuracy sidebar is that day's.
 */
export function HearingDetailView({ initialHearing }: HearingDetailViewProps) {
  const multiDayHearings = useMultiDayHearings();
  const [hearing, setHearing] = useState(initialHearing);
  const hearingRef = useRef(hearing);
  hearingRef.current = hearing;
  const applyHearing = useCallback((next: Hearing) => {
    hearingRef.current = next;
    setHearing(next);
  }, []);
  const applyJob = useCallback(
    (job: TranscriptionJob) => applyHearing(withJob(hearingRef.current, job)),
    [applyHearing]
  );

  const hearingId = hearing.id;
  const days = hearing.days;
  const severalDays = days.length > 1;

  const [activeDayId, setActiveDayId] = useState(
    () => (initialHearing.days.find(hasTranscript) ?? initialHearing.days[0]).id
  );
  // The selected day while it has a transcript to play; else (deleted, or
  // not transcribed yet) the first day that has one.
  const selectedDay = days.find((day) => day.id === activeDayId);
  const activeDay: HearingDay =
    (selectedDay && hasTranscript(selectedDay) ? selectedDay : undefined) ??
    days.find(hasTranscript) ??
    selectedDay ??
    days[0];
  const activeDayRef = useRef(activeDay.id);
  activeDayRef.current = activeDay.id;

  // An <audio> source cannot send the tab's jurisdiction as a header (DIAAT-334).
  const audioSrc = useMemo(
    () => withTabJurisdiction(apiPath(`/api/audio/${activeDay.id}`)),
    [activeDay.id]
  );

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  // Where to go once another day's audio has loaded (a seek before then is lost).
  const pendingSeekRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioFailedDayId, setAudioFailedDayId] = useState<string | null>(null);
  const audioAvailable = audioFailedDayId !== activeDay.id;
  const [showModificationHistory, setShowModificationHistory] = useState(false);
  // The per-word "spoken now" highlight can be tiring to read alongside a long
  // transcript (and can look out of sync), so readers can toggle it off
  // (DIAAT-246). Defaults ON. Starts from the default rather than reading
  // localStorage during render, so SSR and the first client render agree
  // (no hydration mismatch); the stored choice is applied in an effect below.
  const [syncHighlight, setSyncHighlight] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SYNC_HIGHLIGHT_STORAGE_KEY);
      if (stored !== null) setSyncHighlight(stored === "true");
    } catch {
      // Private-mode / storage-disabled browsers: just keep the default.
    }
  }, []);

  const toggleSyncHighlight = useCallback(() => {
    setSyncHighlight((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SYNC_HIGHLIGHT_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures — the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  // A callback ref (rather than an effect) so listeners attach exactly when
  // the <audio> element mounts — which happens on first render if a day is
  // already COMPLETED, or later, whenever polling flips one to COMPLETED.
  // Stabilised with useCallback (empty deps): this component re-renders
  // frequently (timeupdate -> setPosition), and a ref callback recreated
  // every render makes React detach/reattach these listeners on every one.
  // The element stays when the selected day changes: only its src does.
  const attachAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    audioElRef.current = el;
    if (!el) return;

    const onTimeUpdate = () => setPosition(el.currentTime);
    const onLoadedMetadata = () => {
      setAudioDuration(el.duration);
      const pending = pendingSeekRef.current;
      if (pending !== null) {
        pendingSeekRef.current = null;
        el.currentTime = pending;
        setPosition(pending);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setAudioFailedDayId(activeDayRef.current);
      // The element only says it failed: if the API refused because the tab's context is stale or
      // the account was deactivated, ask again with fetch so the stale-tab or account notice shows.
      void probeForRefusal(el.currentSrc || el.src);
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);

    audioCleanupRef.current = () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioElRef.current;
    if (!audio) return;
    if (audio.paused) {
      // play() returns a promise that can reject (e.g. a pause() interrupts
      // it, or the browser blocks autoplay) — the "error" listener already
      // handles genuine load failures, so this just avoids an unhandled
      // rejection showing up in the console.
      audio.play().catch((err) => {
        console.warn("Audio playback failed to start", err);
      });
    } else {
      audio.pause();
    }
  };

  const seekTo = (time: number) => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setPosition(time);
  };

  // Puts the player (and the sidebar) on another day, at `time` once its
  // audio has loaded.
  const selectDay = (dayId: string, time = 0) => {
    if (dayId === activeDay.id) {
      seekTo(time);
      return;
    }
    audioElRef.current?.pause();
    pendingSeekRef.current = time;
    activeDayRef.current = dayId;
    setActiveDayId(dayId);
    setPlaying(false);
    setPosition(time);
    setAudioDuration(0);
  };

  // Stable reference (reads the ref, not React state) so the active
  // segment's rAF-driven word-highlight loop can poll real playback
  // position at animation-frame precision instead of waiting on the
  // <audio> element's much coarser timeupdate event.
  const getCurrentTime = useCallback(
    () => audioElRef.current?.currentTime ?? 0,
    []
  );

  // "Needs review" items live in a separate sidebar list — jumping to one
  // should also bring its actual transcript segment into view, not just
  // move the audio position.
  const seekAndScrollToSegment = (day: HearingDay, time: number) => {
    selectDay(day.id, time);
    const segment = day.segments?.find(
      (s) => time >= s.startTime && time < s.startTime + s.duration
    );
    if (segment) {
      document
        .getElementById(segment.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const [combining, setCombining] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve());

  // One request at a time, so a slower response can't put back an older copy
  // of the transcript.
  const enqueue = <T,>(request: () => Promise<T>): Promise<T> => {
    const run = requestQueue.current.then(request);
    requestQueue.current = run.catch(() => undefined);
    return run;
  };

  // Each day is a job of its own: a segment is changed through its day's job.
  const segmentAction = (
    dayId: string,
    segmentId: string,
    path: string,
    init: RequestInit
  ) =>
    enqueue(async () => {
      setActionError(null);
      try {
        const response = await recordingFetch(
          apiPath(
            `/api/jobs/${dayId}/segments/${encodeURIComponent(segmentId)}${path}`
          ),
          init
        );
        if (response.status === 409) setActionError(SECTION_GONE);
        if (!response.ok) {
          throw new Error(`Segment request failed: ${response.status}`);
        }
        const body = await response.json();
        applyJob(body.job as TranscriptionJob);
      } catch (err) {
        setActionError((current) => current ?? ACTION_FAILED);
        throw err;
      }
    });

  const patchJson = (body: unknown): RequestInit => ({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const combine = (dayId: string, segmentId: string, nextSegmentId: string) => {
    setCombining(true);
    return segmentAction(dayId, segmentId, "/merge-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextSegmentId }),
    })
      .catch(() => undefined)
      .finally(() => setCombining(false));
  };

  // DIAAT-332: a switch reloads the tab, which would cancel the upload.
  const [uploadingBaseline, setUploadingBaseline] = useState(false);
  const [addingAudio, setAddingAudio] = useState(false);
  useJurisdictionSwitchGuard({
    busy: uploadingBaseline || addingAudio,
    unsaved: false,
  });

  const uploadBaseline = async (dayId: string, file: File) => {
    setUploadingBaseline(true);
    try {
      await enqueue(() => sendBaseline(dayId, file));
    } finally {
      setUploadingBaseline(false);
    }
  };

  const sendBaseline = async (dayId: string, file: File) => {
    // The raw file, as exactly application/octet-stream, not
    // multipart/form-data: the only shape Front Door's WAF lets through to
    // this path (lib/recording/upload-contract.ts). The route handler builds
    // the multipart request to the API (app/api/jobs/[jobId]/baseline).
    const response = await recordingFetch(
      apiPath(`/api/jobs/${dayId}/baseline`),
      {
        method: "POST",
        headers: rawUploadHeaders(file),
        body: file,
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error ??
          `Failed to upload baseline transcript: ${response.status}`
      );
    }
    const body = await response.json();
    applyJob(body.job as TranscriptionJob);
  };

  // Only when the page cannot follow a change on its own: each read of the
  // hearing that returns a transcript is audited as a view.
  const reloadHearing = async () => {
    const response = await recordingFetch(
      apiPath(`/api/hearings/${hearingId}`),
      { cache: "no-store" }
    );
    if (!response.ok)
      throw new Error(`Hearing reload failed: ${response.status}`);
    const body = await response.json();
    applyHearing(body.hearing as Hearing);
  };

  const changeDate = async (day: HearingDay, hearingDate: string) => {
    const response = await recordingFetch(
      apiPath(`/api/jobs/${day.id}/hearing-date`),
      patchJson({ hearingDate })
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        body?.error ?? "The date could not be changed. Try again."
      );
    }
    const next = withSummaryDates(
      hearingRef.current,
      body.hearing as HearingSummary
    );
    if (next) applyHearing(next);
    else await reloadHearing();
  };

  const deleteDay = async (day: HearingDay) => {
    const response = await recordingFetch(apiPath(`/api/jobs/${day.id}`), {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error ?? "The day could not be deleted. Try again."
      );
    }
    applyHearing(withoutDay(hearingRef.current, day.id));
  };

  const addDay = (job: TranscriptionJob) =>
    applyHearing(withNewDay(hearingRef.current, job));

  // A day still being prepared or transcribed is asked for again on its own,
  // as before hearings: a hearing read would be audited as a view each time.
  useEffect(() => {
    const id = setInterval(async () => {
      for (const day of hearingRef.current.days.filter(isInFlight)) {
        try {
          const response = await recordingFetch(
            apiPath(`/api/jobs/${day.id}`),
            {
              cache: "no-store",
            }
          );
          if (!response.ok) continue;
          const body = await response.json();
          applyJob(body.job as TranscriptionJob);
        } catch (err) {
          console.error("Failed to refresh job status", err);
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [applyJob]);

  const backLink = (
    <Link
      href={RECORDING_HOME}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4"
    >
      <ChevronLeft className="size-4" />
      Back to hearing list
    </Link>
  );

  const onlyDay = days[0];
  const dateLine = !severalDays && multiDayHearings && (
    <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
      <span>
        Date of the hearing:{" "}
        <span className="font-medium">
          {formatHearingDate(onlyDay.hearingDate)}
        </span>
      </span>
      <ChangeHearingDate
        day={onlyDay}
        onSave={(date) => changeDate(onlyDay, date)}
      />
    </div>
  );

  const addAudio = multiDayHearings && (
    <AddAudioPanel
      hearingId={hearingId}
      onAdded={addDay}
      onBusyChange={setAddingAudio}
    />
  );

  if (!severalDays && !hasTranscript(onlyDay)) {
    const job = onlyDay;
    return (
      <main className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {backLink}

          <p className="text-sm text-primary mb-1">{hearing.tribunal}</p>
          <h1 className="text-3xl font-bold mb-4">{hearing.caseReference}</h1>
          {dateLine}

          <div className="flex items-center gap-3 mb-6">
            <JobStatusBadge status={job.status} />
            <span className="text-sm text-muted-foreground">
              {job.audioFileName}
            </span>
          </div>

          {(job.status === "PENDING" || job.status === "PROCESSING") && (
            <div className="border border-border rounded-lg p-6 space-y-4">
              {/* DIAAT-408: PENDING is a job whose recording is still being prepared (converted and, over 240 minutes, split) before it is sent for transcription: no audio to play yet, and no new status for it. */}
              <p className="text-muted-foreground">
                {job.status === "PENDING"
                  ? "Your recording is being prepared for transcription. A long recording can take a few minutes. This page updates automatically — no need to refresh."
                  : "Transcription is still in progress. This page updates automatically — no need to refresh."}
              </p>
              <JobProgress job={job} />
            </div>
          )}

          {job.status === "FAILED" && (
            <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-6">
              <p className="font-medium text-destructive mb-2">
                Transcription failed
              </p>
              <p className="text-sm text-muted-foreground">
                {job.errorMessage ?? "An unknown error occurred."}
              </p>
            </div>
          )}

          {job.status === "COMPLETED" && !job.segments && (
            <div className="border border-border rounded-lg p-6">
              <p className="text-muted-foreground">
                This transcript has no content to display.
              </p>
            </div>
          )}

          {addAudio}
        </div>
      </main>
    );
  }

  const withTranscripts = days.filter(hasTranscript);
  const playable = hasTranscript(activeDay);
  const totalDuration = (activeDay.segments ?? []).reduce(
    (max, s) => Math.max(max, s.startTime + s.duration),
    0
  );
  const segmentCount = withTranscripts.reduce(
    (n, day) => n + day.segments.length,
    0
  );
  // Cheap count — just sum the per-segment history lengths. Avoids the
  // full flatten+sort (buildModificationHistory) on every render, since
  // this runs even while the section is collapsed and the transcript page
  // re-renders frequently (audio position updates).
  const modificationCount = withTranscripts.reduce(
    (n, day) =>
      n +
      day.segments.reduce((m, s) => m + (s.correctionHistory?.length ?? 0), 0),
    0
  );

  // Backend threshold is a 0-100 percent; the per-word highlight compares
  // against a 0-1 ratio. Keep them in sync so highlights match the backend
  // "needs review" list even under an env override.
  const highlightThresholdOf = (day: HearingDay) =>
    day.accuracy ? day.accuracy.confidenceThreshold / 100 : undefined;

  // Whether the transcript actually renders at least one low-confidence
  // highlight, mirroring TranscriptSegment's own gating: a segment only
  // highlights words when it renders word-by-word (no whole-segment
  // correctedText), hasn't been accepted as-is, and has a word below the
  // threshold. Gate the "review" caption on this — not merely on accuracy
  // — so it never shows when nothing is highlighted (segments without words,
  // or all highlights cleared/accepted/corrected) (DIAAT-249 review).
  const hasLowConfidenceHighlights = withTranscripts.some((day) => {
    const threshold = highlightThresholdOf(day);
    return (
      threshold !== undefined &&
      day.segments.some(
        (s) =>
          s.correctedText === undefined &&
          !s.accepted &&
          (s.words?.some((w) => w.confidence < threshold) ?? false)
      )
    );
  });

  const renderSegments = (
    day: HearingDay & { segments: NonNullable<HearingDay["segments"]> }
  ) => {
    const canSeek = audioAvailable || day.id !== activeDay.id;
    return day.segments.map((segment, index, segments) => {
      const isActive =
        playing &&
        day.id === activeDay.id &&
        position >= segment.startTime &&
        position < segment.startTime + segment.duration;
      return (
        <TranscriptSegment
          key={segment.id}
          segment={segment}
          onSeek={canSeek ? (time) => selectDay(day.id, time) : undefined}
          onCorrect={(text) =>
            segmentAction(
              day.id,
              segment.id,
              "",
              patchJson({ correctedText: text })
            )
          }
          onCorrectRange={(start, end, text) =>
            segmentAction(
              day.id,
              segment.id,
              "/words",
              patchJson({
                startWordIndex: start,
                endWordIndex: end,
                correctedText: text,
              })
            )
          }
          onRollback={() =>
            segmentAction(day.id, segment.id, "/rollback", { method: "POST" })
          }
          onRollbackToHistory={(historyIndex) =>
            segmentAction(
              day.id,
              segment.id,
              `/history/${historyIndex}/rollback`,
              { method: "POST" }
            )
          }
          onAccept={() =>
            segmentAction(day.id, segment.id, "/accept", { method: "POST" })
          }
          onCombinePrevious={
            index > 0
              ? () => combine(day.id, segments[index - 1].id, segment.id)
              : undefined
          }
          onCombineNext={
            index < segments.length - 1
              ? () => combine(day.id, segment.id, segments[index + 1].id)
              : undefined
          }
          combinePending={combining}
          needsReview={day.lowConfidenceSegments?.some(
            (item) =>
              item.startTime === segment.startTime &&
              item.speaker === segment.speaker
          )}
          onRenameSpeaker={(speaker, applyToAll) =>
            segmentAction(
              day.id,
              segment.id,
              "/speaker",
              patchJson({ speaker, applyToAll })
            )
          }
          isActive={isActive}
          getCurrentTime={getCurrentTime}
          syncHighlight={syncHighlight}
          lowConfidenceThreshold={highlightThresholdOf(day)}
        />
      );
    });
  };

  const dayLabels = severalDays
    ? Object.fromEntries(days.map((day) => [day.id, `Day ${day.dayNumber}`]))
    : undefined;

  return (
    <main className="min-h-screen bg-background">
      {playable && (
        <audio
          ref={attachAudioRef}
          src={audioSrc}
          preload="metadata"
          className="hidden"
        >
          <track kind="captions" />
        </audio>
      )}

      {playable &&
        (audioAvailable ? (
          <AudioPlayerBar
            duration={audioDuration || totalDuration}
            position={position}
            playing={playing}
            onTogglePlay={togglePlay}
            onSeek={seekTo}
            onSpeedChange={(speed) => {
              if (audioElRef.current) audioElRef.current.playbackRate = speed;
            }}
            syncHighlight={syncHighlight}
            onToggleSyncHighlight={toggleSyncHighlight}
          />
        ) : (
          <div className="bg-white border-b border-border px-4 py-3 text-sm text-muted-foreground">
            {severalDays
              ? `Audio playback is unavailable for day ${activeDay.dayNumber}.`
              : "Audio playback is unavailable for this recording."}
          </div>
        ))}

      <div className="max-w-5xl mx-auto px-4 py-6">
        {backLink}

        <p className="text-sm text-primary mb-1">{hearing.tribunal}</p>
        <h1 className={cn("text-3xl font-bold", dateLine ? "mb-2" : "mb-6")}>
          {hearing.caseReference}
        </h1>
        {dateLine}

        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Transcript</h2>
              <p className="text-sm text-muted-foreground">
                {segmentCount} segments
              </p>
            </div>
            {/* Reframe the highlighting as "review", not "error" (DIAAT-249):
                a highlighted word had lower recognition confidence, not a
                confirmed mistake. Only shown when the transcript actually
                renders at least one low-confidence highlight, so clean/older
                transcripts (or ones where every highlight was cleared) don't
                show a caption referring to highlights that aren't there. */}
            {hasLowConfidenceHighlights && (
              <p className="text-sm text-muted-foreground mb-3">
                Highlighted words had lower recognition confidence — review and
                confirm or edit.
              </p>
            )}
            {actionError && (
              <p role="alert" className="text-sm text-destructive mb-3">
                {actionError}
              </p>
            )}
            {severalDays ? (
              <div className="space-y-4">
                {days.map((day) => (
                  <section
                    key={day.id}
                    aria-labelledby={`day-${day.id}-heading`}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    <HearingDayHeader
                      day={day}
                      selected={day.id === activeDay.id}
                      onSelect={
                        hasTranscript(day) ? () => selectDay(day.id) : undefined
                      }
                      onChangeDate={
                        multiDayHearings
                          ? (date) => changeDate(day, date)
                          : undefined
                      }
                      onDelete={
                        multiDayHearings ? () => deleteDay(day) : undefined
                      }
                    />
                    {hasTranscript(day) ? (
                      <div className="divide-y divide-border">
                        {renderSegments(day)}
                      </div>
                    ) : (
                      <DayWithoutTranscript day={day} />
                    )}
                  </section>
                ))}
              </div>
            ) : (
              hasTranscript(onlyDay) && (
                <div className="border border-border rounded-lg divide-y divide-border">
                  {renderSegments(onlyDay)}
                </div>
              )
            )}
          </div>

          {/* Sidebar (right) — the selected day's, omitted when the backend
              hasn't returned any confidence-scored segments for it (e.g. an
              older job predating this feature). Sticky so it stays in view
              while scrolling a long transcript (potentially ~15,000 words):
              the `top` offset clears the sticky audio player bar above it,
              and `max-h`/`overflow-y-auto` keep the panel itself from
              spilling past the bottom of the viewport if it ever has more
              content than fits (e.g. many low-confidence segments). It
              naturally un-sticks once its flex-row parent (as tall as the
              transcript column) runs out, so it doesn't float past the end
              of the transcript. */}
          {activeDay.accuracy && (
            <aside className="w-72 shrink-0 space-y-4 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
              {severalDays && (
                <p className="text-sm font-semibold">
                  Day {activeDay.dayNumber}
                </p>
              )}
              <TranscriptAccuracy
                accuracy={activeDay.accuracy}
                onUploadBaseline={(file) => uploadBaseline(activeDay.id, file)}
              />
              {activeDay.lowConfidenceSegments &&
                activeDay.lowConfidenceSegments.length > 0 && (
                  <NeedsReviewPanel
                    items={activeDay.lowConfidenceSegments}
                    threshold={activeDay.accuracy.confidenceThreshold}
                    onSeek={(time) => seekAndScrollToSegment(activeDay, time)}
                  />
                )}
            </aside>
          )}
        </div>

        {addAudio}

        {/* Job-level modification history — every correction, rollback and
            accept-all action across all segments in one auditable table
            (DIAAT-230), so the whole transcript's edit history can be
            scanned in one place rather than segment by segment. Collapsed
            by default to keep the transcript the focus. One table per day:
            each day's segments are its own. */}
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowModificationHistory((v) => !v)}
            aria-expanded={showModificationHistory}
            className="flex items-center gap-2 text-lg font-semibold hover:text-primary"
          >
            <History className="size-5" />
            Modification history
            <span className="text-sm font-normal text-muted-foreground">
              ({modificationCount})
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                showModificationHistory && "rotate-180"
              )}
            />
          </button>
          {showModificationHistory && (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-muted-foreground">
                All correction, rollback and accept-all actions taken on this
                transcript, newest first.
              </p>
              {withTranscripts.map((day) => (
                <div key={day.id}>
                  {severalDays && (
                    <h3 className="mb-2 font-semibold">Day {day.dayNumber}</h3>
                  )}
                  <ModificationHistoryTable
                    job={day}
                    onSeekToSegment={
                      audioAvailable || day.id !== activeDay.id
                        ? (time) => seekAndScrollToSegment(day, time)
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* DIAAT-395: the hearing's audit history (who did what to it, in
            which role), for a context with recording.audit.read. Separate from
            the per-segment history above, which it leaves alone. */}
        <RecordingHistory hearingId={hearingId} dayLabels={dayLabels} />
      </div>
    </main>
  );
}
