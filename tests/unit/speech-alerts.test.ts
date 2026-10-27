import { describe, expect, it } from "vitest";
import { describeSpeechAlert } from "@/lib/speech-alerts";

const base = {
  health: "healthy" as const,
  totalCollapses: 0,
  hasCapturedSpeech: true,
  noSpeechWarning: false,
  noSpeechThresholdSeconds: 90,
};

describe("describeSpeechAlert", () => {
  it("says nothing when the session is idle", () => {
    expect(describeSpeechAlert({ ...base, health: "idle" })).toBeNull();
  });

  it("says nothing while a first connection is being established", () => {
    expect(describeSpeechAlert({ ...base, health: "starting" })).toBeNull();
  });

  it("says nothing when recording is healthy and has never dropped", () => {
    expect(describeSpeechAlert(base)).toBeNull();
  });

  it("raises a non-dismissible error when the session has failed", () => {
    const message = describeSpeechAlert({
      ...base,
      health: "failed",
      totalCollapses: 37,
      hasCapturedSpeech: false,
    });

    expect(message).not.toBeNull();
    expect(message?.kind).toBe("speech-failed");
    expect(message?.severity).toBe("error");
    expect(message?.dismissible).toBe(false);
    // The judge must be told, in the heading, that dictation is not being kept.
    expect(message?.heading).toMatch(/not being recorded/i);
    expect(message?.body).toMatch(/nothing/i);
  });

  it("tells a failed session that already captured content it may have a gap", () => {
    const message = describeSpeechAlert({
      ...base,
      health: "failed",
      totalCollapses: 4,
      hasCapturedSpeech: true,
    });

    expect(message?.kind).toBe("speech-failed");
    expect(message?.body).not.toMatch(/nothing from this session/i);
    expect(message?.body).toMatch(/not being captured/i);
  });

  it("warns while reconnecting that speech is not being captured", () => {
    const message = describeSpeechAlert({
      ...base,
      health: "recovering",
      totalCollapses: 1,
    });

    expect(message?.kind).toBe("speech-recovering");
    expect(message?.severity).toBe("error");
    expect(message?.dismissible).toBe(false);
    expect(message?.body).toMatch(/not being (recorded|captured)/i);
  });

  it("raises the no-speech warning when nothing has been captured", () => {
    const message = describeSpeechAlert({
      ...base,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
      noSpeechThresholdSeconds: 90,
    });

    expect(message?.kind).toBe("speech-no-content");
    expect(message?.severity).toBe("error");
    expect(message?.dismissible).toBe(false);
    expect(message?.heading).toMatch(/no speech/i);
    // Honest about the benign case too: they may simply not have spoken yet.
    expect(message?.body).toMatch(/if you have been speaking/i);
    expect(message?.guidance).toMatch(/microphone/i);
  });

  it("prefers the failed message over the no-speech warning", () => {
    const message = describeSpeechAlert({
      ...base,
      health: "failed",
      totalCollapses: 5,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
    });

    expect(message?.kind).toBe("speech-failed");
  });

  it("flags a possible gap once a recovered session is healthy again", () => {
    const message = describeSpeechAlert({
      ...base,
      health: "healthy",
      totalCollapses: 2,
    });

    expect(message?.kind).toBe("speech-interrupted");
    expect(message?.severity).toBe("warning");
    expect(message?.dismissible).toBe(true);
    expect(message?.body).toMatch(/gap/i);
  });

  it("pluralises the interruption count", () => {
    expect(
      describeSpeechAlert({ ...base, totalCollapses: 1 })?.heading
    ).toMatch(/1 interruption\b/);
    expect(
      describeSpeechAlert({ ...base, totalCollapses: 3 })?.heading
    ).toMatch(/3 interruptions\b/);
  });

  it("describes the no-speech threshold in whole minutes when it is long", () => {
    const message = describeSpeechAlert({
      ...base,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
      noSpeechThresholdSeconds: 120,
    });

    expect(message?.body).toMatch(/2 minutes/);
  });

  it("does not round the default 90-second threshold up to minutes", () => {
    const message = describeSpeechAlert({
      ...base,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
      noSpeechThresholdSeconds: 90,
    });

    expect(message?.body).toMatch(/90 seconds/);
    expect(message?.body).not.toMatch(/minute/);
  });

  it("describes a sub-minute threshold in seconds", () => {
    const message = describeSpeechAlert({
      ...base,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
      noSpeechThresholdSeconds: 45,
    });

    expect(message?.body).toMatch(/45 seconds/);
  });
});
