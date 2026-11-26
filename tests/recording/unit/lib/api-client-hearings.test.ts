import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendApiError,
  deleteHearing,
  getHearing,
  getHearingHistory,
  listHearings,
  setHearingDate,
  submitJob,
  uploadAndSubmit,
} from "@/lib/recording/api-client";
import { streamOf } from "../multipart";

const BACKEND = "http://localhost:8001";
const HEARING_ID = "11111111-1111-1111-1111-111111111111";
const DAY_2_ID = "22222222-2222-2222-2222-222222222222";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockFetch(...responses: ReturnType<typeof jsonResponse>[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function backendDay(overrides: Record<string, unknown> = {}) {
  return {
    job_id: HEARING_ID,
    status: "succeeded",
    created_at: "2026-11-10T09:00:00Z",
    updated_at: "2026-11-10T09:30:00Z",
    dialogue_entries: [
      {
        id: "seg_0",
        speaker: "Speaker 1",
        text: "Good morning.",
        start_time: 0,
        end_time: 2,
      },
    ],
    accuracy: null,
    needs_review: [
      {
        speaker: "Speaker 1",
        start_time: 0,
        confidence: 0.5,
        job_id: HEARING_ID,
      },
    ],
    error_message: null,
    metadata: {
      case_reference: "PA/00001/2026",
      tribunal: "First-tier Tribunal",
      audio_file_name: "day1.mp3",
    },
    audio_duration_seconds: 60,
    transcription_duration_seconds: 10,
    model_identifier: null,
    model_display_name: "Base model",
    hearing_id: HEARING_ID,
    hearing_date: "2026-11-10",
    day_number: 1,
    ...overrides,
  };
}

const BACKEND_HEARING = {
  hearing_id: HEARING_ID,
  created_at: "2026-11-10T09:00:00Z",
  updated_at: "2026-11-11T09:00:00Z",
  case_reference: "PA/00001/2026",
  tribunal: "First-tier Tribunal",
  status: "processing",
  day_count: 2,
  days_complete: 1,
  days_failed: 0,
  days: [
    backendDay(),
    backendDay({
      job_id: DAY_2_ID,
      status: "running",
      dialogue_entries: null,
      needs_review: null,
      hearing_date: "2026-11-11",
      day_number: 2,
      metadata: { case_reference: "day 2", audio_file_name: "day2.mp3" },
    }),
  ],
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("getHearing", () => {
  it("maps the hearing and each day, in the API's order", async () => {
    const fetchMock = mockFetch(jsonResponse(BACKEND_HEARING));
    const hearing = await getHearing(HEARING_ID, null);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BACKEND}/api/v1/hearings/${HEARING_ID}`
    );
    expect(hearing).toMatchObject({
      id: HEARING_ID,
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal",
      status: "processing",
    });
    expect(
      hearing?.days.map((d) => [d.id, d.dayNumber, d.hearingDate, d.status])
    ).toEqual([
      [HEARING_ID, 1, "2026-11-10", "COMPLETED"],
      [DAY_2_ID, 2, "2026-11-11", "PROCESSING"],
    ]);
    expect(hearing?.days[0].segments?.[0].text).toBe("Good morning.");
    expect(hearing?.days[0].lowConfidenceSegments?.[0].jobId).toBe(HEARING_ID);
    expect(hearing?.days[1].audioFileName).toBe("day2.mp3");
    expect(hearing?.days[1].hearingId).toBe(HEARING_ID);
  });

  it("takes the case reference and tribunal from the first day when the hearing has none", async () => {
    mockFetch(
      jsonResponse({ ...BACKEND_HEARING, case_reference: null, tribunal: null })
    );
    const hearing = await getHearing(HEARING_ID, null);
    expect(hearing?.caseReference).toBe("PA/00001/2026");
    expect(hearing?.tribunal).toBe("First-tier Tribunal");
  });

  it("is null for a hearing that is not there (404) or an id that is not one (422)", async () => {
    mockFetch(jsonResponse({ detail: "Hearing not found" }, 404));
    expect(await getHearing(HEARING_ID, null)).toBeNull();
    mockFetch(jsonResponse({ detail: [] }, 422));
    expect(await getHearing("nope", null)).toBeNull();
  });

  it("throws anything else", async () => {
    mockFetch(jsonResponse({ detail: "boom" }, 500));
    await expect(getHearing(HEARING_ID, null)).rejects.toBeInstanceOf(
      BackendApiError
    );
  });
});

describe("listHearings", () => {
  it("maps hearing summaries with their days", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        hearings: [
          {
            ...BACKEND_HEARING,
            days: [
              {
                job_id: HEARING_ID,
                day_number: 1,
                hearing_date: "2026-11-10",
                audio_file_name: "day1.mp3",
                status: "succeeded",
                created_at: "2026-11-10T09:00:00Z",
                audio_duration_seconds: 60,
                transcription_duration_seconds: 10,
                model_identifier: null,
                model_display_name: "Base model",
                error_message: null,
              },
              {
                job_id: DAY_2_ID,
                day_number: 2,
                hearing_date: "2026-11-11",
                audio_file_name: null,
                status: "pending",
                created_at: "2026-11-11T09:00:00Z",
                audio_duration_seconds: null,
                transcription_duration_seconds: null,
                model_identifier: null,
                model_display_name: null,
                error_message: null,
              },
            ],
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      })
    );

    const result = await listHearings({ limit: 100 }, null);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BACKEND}/api/v1/hearings?limit=100`
    );
    expect(result.total).toBe(1);
    const [hearing] = result.hearings;
    expect(hearing).toMatchObject({
      id: HEARING_ID,
      caseReference: "PA/00001/2026",
      status: "processing",
      dayCount: 2,
      daysComplete: 1,
      daysFailed: 0,
    });
    expect(hearing.days[0]).toMatchObject({
      jobId: HEARING_ID,
      dayNumber: 1,
      hearingDate: "2026-11-10",
      audioFileName: "day1.mp3",
      status: "COMPLETED",
      uploadedAt: "2026-11-10T09:00:00Z",
      audioDurationSeconds: 60,
      modelDisplayName: "Base model",
    });
    expect(hearing.days[1]).toMatchObject({
      status: "PENDING",
      progressPercent: 0,
      audioFileName: "audio",
      modelDisplayName: undefined,
    });
  });
});

describe("deleteHearing", () => {
  it("DELETEs the hearing", async () => {
    const fetchMock = mockFetch(jsonResponse(null, 204));
    await deleteHearing(HEARING_ID, null);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BACKEND}/api/v1/hearings/${HEARING_ID}`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("setHearingDate", () => {
  it("PATCHes the day's hearing date", async () => {
    const fetchMock = mockFetch(jsonResponse({ ...BACKEND_HEARING, days: [] }));
    await setHearingDate(DAY_2_ID, "2026-11-09", null);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BACKEND}/api/v1/jobs/${DAY_2_ID}/hearing-date`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ hearing_date: "2026-11-09" });
  });
});

describe("getHearingHistory", () => {
  it("reads the hearing's history page, with the day of each row", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        items: [
          {
            id: "h1",
            timestamp: "2026-11-11T09:00:00Z",
            action: "hearing.add_recording",
            actor_label: "Judge",
            actor_role: "judge",
            outcome: "success",
            job_id: DAY_2_ID,
          },
        ],
        total: 1,
      })
    );
    const page = await getHearingHistory(
      HEARING_ID,
      { page: 2, pageSize: 20 },
      null
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BACKEND}/api/v1/hearings/${HEARING_ID}/history?page=2&page_size=20`
    );
    expect(page.items[0].job_id).toBe(DAY_2_ID);
    expect(page.total).toBe(1);
  });
});

describe("adding a recording to a hearing", () => {
  it("submits the job with the hearing and its date", async () => {
    const fetchMock = mockFetch(jsonResponse(backendDay(), 201));
    await submitJob(
      "https://storage/x.wav",
      { caseReference: "x", tribunal: "t", audioFileName: "x.wav" },
      "uploads/x.wav",
      undefined,
      null,
      { hearingId: HEARING_ID, hearingDate: "2026-11-12" }
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.hearing_id).toBe(HEARING_ID);
    expect(body.hearing_date).toBe("2026-11-12");
  });

  it("sends neither without them", async () => {
    const fetchMock = mockFetch(jsonResponse(backendDay(), 201));
    await submitJob(
      "https://storage/x.wav",
      { caseReference: "x", tribunal: "t", audioFileName: "x.wav" },
      "uploads/x.wav",
      undefined,
      null
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("hearing_id");
    expect(body).not.toHaveProperty("hearing_date");
  });

  it("uploadAndSubmit passes the hearing on to the job", async () => {
    const fetchMock = mockFetch(
      jsonResponse(
        { audio_url: "https://storage/x.wav", blob_name: "uploads/x.wav" },
        201
      ),
      jsonResponse(backendDay({ job_id: DAY_2_ID }), 201)
    );
    const job = await uploadAndSubmit(
      {
        content: streamOf(new TextEncoder().encode("bytes")),
        size: 5,
        filename: "day2.wav",
        contentType: "audio/wav",
      },
      undefined,
      null,
      { hearingId: HEARING_ID, hearingDate: "2026-11-12" }
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({
      hearing_id: HEARING_ID,
      hearing_date: "2026-11-12",
    });
    expect(job.hearingId).toBe(HEARING_ID);
    expect(job.hearingDate).toBe("2026-11-10");
  });
});
