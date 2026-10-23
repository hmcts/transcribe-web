import { describe, expect, it } from "vitest";
import {
  AUDIO_UPLOAD_TYPES,
  BASELINE_UPLOAD_TYPES,
  checkUploadType,
  rawUploadHeaders,
} from "@/lib/recording/upload-contract";

// Front Door's WAF lets a raw upload body through to /api/upload and
// /api/jobs/<uuid>/baseline only with exactly this Content-Type.
describe("rawUploadHeaders", () => {
  it("sends exactly application/octet-stream, and the file's own type separately", () => {
    const file = new File(["x"], "R v Smith – day 2.wav", {
      type: "audio/wav",
    });

    expect(rawUploadHeaders(file)).toEqual({
      "Content-Type": "application/octet-stream",
      "X-Upload-Content-Type": "audio/wav",
      "X-Upload-Filename": encodeURIComponent(file.name),
      "X-Upload-Size": "1",
    });
  });

  it("declares an empty type when the browser does not know it", () => {
    const file = new File(["xy"], "hearing.flac");

    expect(rawUploadHeaders(file)["X-Upload-Content-Type"]).toBe("");
  });

  it("adds extra headers without letting them replace the Content-Type", () => {
    const file = new File(["x"], "a.mp3", { type: "audio/mpeg" });

    const headers = rawUploadHeaders(file, {
      "X-Audio-Duration-Seconds": "12.5",
    });

    expect(headers["X-Audio-Duration-Seconds"]).toBe("12.5");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });
});

describe("checkUploadType", () => {
  it("takes the API's audio extensions and nothing else", () => {
    // _ALLOWED_AUDIO_EXTENSIONS in transcribe-api's routes_recording.py.
    expect(Object.keys(AUDIO_UPLOAD_TYPES).sort()).toEqual(
      [".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav"].sort()
    );
    expect(Object.keys(BASELINE_UPLOAD_TYPES)).toEqual([".txt"]);
  });

  it("does not treat an inherited property name as an extension", () => {
    expect(checkUploadType("a.constructor", "", AUDIO_UPLOAD_TYPES).ok).toBe(
      false
    );
  });

  it("rejects a baseline that is not text/plain", () => {
    expect(
      checkUploadType("a.txt", "text/html", BASELINE_UPLOAD_TYPES)
    ).toEqual({ ok: false, error: expect.any(String) });
  });
});
