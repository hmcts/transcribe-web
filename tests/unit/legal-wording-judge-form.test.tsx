import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";

// DIAAT-342: the judge's hearing form follows the legal wording of the
// jurisdiction the tab works in: its own, none at all, or (until it loads, for
// the IAC only) the IAC's shipped list.

const lastFormProps = vi.hoisted(() => ({ current: null as any }));
const mockFetchContent = vi.hoisted(() => vi.fn());
const mockGetLiveDraft = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

let mockJurisdiction: "IAC" | "ET" | "DT" = "DT";
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule(
    () => mockJurisdiction
  )
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams("mode=mic"),
}));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => true }));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: null,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));
vi.mock("@/components/editor/tiptap-editor", () => ({
  default: () => <div>Notes editor</div>,
}));
vi.mock("@/components/audio/dictation", () => ({
  SpeechDemo: () => <div>Transcript area</div>,
}));
vi.mock("@/components/audio/dictation/dictation-form", () => ({
  default: (props: any) => {
    lastFormProps.current = props;
    return <div>Dictation form</div>;
  },
}));
vi.mock("@/lib/document-content-api", () => ({
  fetchUserDocumentContent: mockFetchContent,
}));
vi.mock("@/lib/admin-access", () => ({
  getAdminAccessStatus: vi.fn().mockResolvedValue("unauthorised"),
}));
vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/live-draft-telemetry", () => ({
  liveDraftTelemetry: {
    saveFailed: vi.fn(),
    autosaveStalled: vi.fn(),
    saveRecovered: vi.fn(),
    restoreSucceeded: vi.fn(),
    restoreFailed: vi.fn(),
  },
}));
vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ setIsRecording: vi.fn() }),
}));
vi.mock("@/lib/live-draft-api", () => ({
  getLiveDraft: mockGetLiveDraft,
  putLiveDraft: vi.fn().mockResolvedValue(undefined),
  deleteLiveDraft: vi.fn().mockResolvedValue(undefined),
}));

const HEARING_TYPE = {
  id: "no_hearing_papers",
  title: "Papers",
  hearing_title: "Hearing",
  hearing_description: "On the papers",
};
const content = (
  jurisdiction: { code: string; name: string } | undefined,
  hasLegal: boolean | undefined,
  frameworks = hasLegal
    ? [
        {
          id: "credibility",
          title: "Credibility",
          rank: 1,
          content: "c",
          issues: [],
        },
      ]
    : []
) => ({
  ...(jurisdiction && { jurisdiction }),
  ...(hasLegal !== undefined && { has_legal_wording: hasLegal }),
  hearing_types: [HEARING_TYPE],
  legal_frameworks: frameworks,
  anonymity: { statuses: [] },
});
const DT = { code: "DT", name: "Decision Tribunal" };

const FORM = {
  caseId: "1",
  location: "Belfast",
  locationOther: "",
  jurisdiction: "First-tier Tribunal Immigration and Asylum Chamber",
  hearingDate: "2026-01-01",
  judgeName: "Judge",
  anonymityOrder: "granted",
  appellantName: "A",
  respondent: "R",
  hearingType: "no_hearing_papers",
  appellantRepType: "",
  appellantRepDetails: "",
  respondentRepType: "",
  respondentRepName: "",
  appealableDecisionDate: "2026-01-01",
  legalIssues: [] as string[],
  documentType: "Decision",
};

const fetchMock = vi.fn();

async function renderPage(fetched: unknown) {
  mockFetchContent.mockResolvedValue(fetched);
  render(
    <>
      <Toaster />
      <RecordPage />
    </>
  );
  await waitFor(() => expect(mockFetchContent).toHaveBeenCalled());
}

async function submitWith(values: Record<string, unknown>) {
  await act(async () => {
    lastFormProps.current.onFormStateChange(values);
  });
  fireEvent.click(screen.getByRole("button", { name: /submit hearing/i }));
}

describe("The judge's hearing form and legal wording (DIAAT-342)", () => {
  beforeEach(() => {
    mockJurisdiction = "DT";
    lastFormProps.current = null;
    mockGetLiveDraft.mockResolvedValue(null);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        blob_path: "b",
        document_blob_path: "d",
        document_download_url: "u",
        transcription_id: "t",
        message: "ok",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    toast.dismiss();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const submittedFormData = () =>
    JSON.parse(String(fetchMock.mock.calls[0][1].body)).form_data;

  it("submits without legal issues, requiring none, where the jurisdiction has no legal wording", async () => {
    await renderPage(content(DT, false));
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBeDefined()
    );
    expect(lastFormProps.current.legalIssuesFallback).toBe(false);

    // Even a restored draft's stale choice is not sent.
    await submitWith({ ...FORM, legalIssues: ["credibility"] });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/live-transcription/submission"
    );
    expect(submittedFormData().legalIssues).toEqual([]);
  });

  it("still asks for legal issues where the jurisdiction has legal wording", async () => {
    await renderPage(content(DT, true));
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBeDefined()
    );

    await submitWith(FORM);
    expect(
      await screen.findByText(/Please review the highlighted fields/)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await submitWith({ ...FORM, legalIssues: ["credibility"] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submittedFormData().legalIssues).toEqual(["credibility"]);
  });

  it("does not submit while another jurisdiction's wording is still loading", async () => {
    mockFetchContent.mockReturnValue(new Promise(() => undefined)); // never loads
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );
    await waitFor(() => expect(mockFetchContent).toHaveBeenCalled());

    await submitWith(FORM);

    expect(
      await screen.findByText(
        "Legal wording for Decision Tribunal hasn't loaded yet, reload and try again."
      )
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not submit when its wording failed to load, and submits once a retry loads it", async () => {
    mockFetchContent.mockRejectedValueOnce(new Error("down"));
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );
    await waitFor(() => expect(mockFetchContent).toHaveBeenCalledTimes(1));
    await act(async () => undefined);

    await submitWith(FORM);
    expect(
      await screen.findByText(
        "Legal wording for Decision Tribunal could not be loaded, reload and try again."
      )
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    // The retry path: the toast's action fetches the wording again.
    mockFetchContent.mockResolvedValue(content(DT, false));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBeDefined()
    );

    await submitWith(FORM);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submittedFormData().legalIssues).toEqual([]);
  });

  it("does not use content fetched for another jurisdiction, and does not submit on it", async () => {
    // e.g. the response to a request made before the tab moved on.
    await renderPage(content({ code: "IAC", name: "IAC" }, true));
    await act(async () => undefined);

    expect(lastFormProps.current.documentContent).toBeUndefined();
    // Not the IAC, so no IAC list either, and no guessing about legal issues.
    expect(lastFormProps.current.legalIssuesFallback).toBe(false);
    await submitWith(FORM);
    await screen.findByText(/hasn't loaded yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the IAC submit as before while its wording loads, from its shipped list", async () => {
    mockJurisdiction = "IAC";
    mockFetchContent.mockReturnValue(new Promise(() => undefined));
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await submitWith({ ...FORM, legalIssues: ["credibility"] });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submittedFormData().legalIssues).toEqual(["credibility"]);
  });

  it("takes content from an older API, which does not say, as the IAC's and with legal wording", async () => {
    mockJurisdiction = "IAC";
    await renderPage(content(undefined, undefined));
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBeDefined()
    );

    await submitWith(FORM);
    expect(
      await screen.findByText(/Please review the highlighted fields/)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers the IAC its shipped legal issues until its wording has loaded, and no other jurisdiction", async () => {
    mockFetchContent.mockReturnValue(new Promise(() => undefined)); // never loads
    mockJurisdiction = "IAC";
    const { unmount } = render(<RecordPage />);
    expect(lastFormProps.current.documentContent).toBeUndefined();
    expect(lastFormProps.current.legalIssuesFallback).toBe(true);
    unmount();

    mockJurisdiction = "DT";
    render(<RecordPage />);
    expect(lastFormProps.current.legalIssuesFallback).toBe(false);
  });
});
