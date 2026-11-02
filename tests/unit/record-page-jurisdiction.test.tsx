import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";
import type { DictationFormValues } from "@/components/audio/dictation/formData";
import type { DocumentContent } from "@/lib/editor-contracts";
import {
  IAC_CONTENT,
  IAC_NAME,
  TAX_CONTENT,
} from "./helpers/document-content";

const TAX_NAME = TAX_CONTENT.jurisdiction.name;

const lastFormProps = vi.hoisted(() => ({ current: null as any }));
const mockFetchContent = vi.hoisted(() => vi.fn());
const mockFetchJurisdictions = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("mode=mic"),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => true,
}));

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

vi.mock("@/components/notifications/submitting-hearing", () => ({
  default: (promise: Promise<unknown>) => {
    promise.catch(() => undefined);
  },
}));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: Object.assign(vi.fn(), {
    error: mockToastError,
    success: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/document-content-api", () => ({
  fetchUserDocumentContent: mockFetchContent,
  fetchJurisdictions: mockFetchJurisdictions,
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
    restoreFailed: vi.fn(),
  },
}));

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ setIsRecording: vi.fn() }),
}));

vi.mock("@/lib/live-draft-api", () => ({
  getLiveDraft: vi.fn().mockResolvedValue(null),
  putLiveDraft: vi.fn().mockResolvedValue(undefined),
  deleteLiveDraft: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn();

const completeForm = (
  overrides: Partial<DictationFormValues>
): DictationFormValues => ({
  caseId: "T1",
  location: "Manchester",
  locationOther: "",
  jurisdiction: IAC_NAME,
  hearingDate: "2025-01-15",
  judgeName: "A Smith",
  anonymityOrder: "granted",
  appellantName: "Appellant",
  respondent: "The Immigration Officer",
  hearingType: "no_hearing_papers",
  appellantRepType: "",
  appellantRepDetails: "",
  respondentRepType: "",
  respondentRepName: "",
  appealableDecisionDate: "2024-12-01",
  legalIssues: [],
  documentType: "Decision",
  ...overrides,
});

// The form is mocked, so drive the page the way the real one does.
const fillForm = async (values: DictationFormValues) => {
  await act(async () => {
    lastFormProps.current.onFormStateChange(values);
  });
};

const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /submit hearing/i }));
  });
};

const contentFor = (jurisdiction?: string): DocumentContent =>
  jurisdiction === TAX_NAME ? TAX_CONTENT : IAC_CONTENT;

beforeEach(() => {
  lastFormProps.current = null;
  mockFetchContent.mockImplementation(async (jurisdiction?: string) =>
    contentFor(jurisdiction)
  );
  mockFetchJurisdictions.mockResolvedValue([
    { id: "iac", name: IAC_NAME, has_legal_wording: true },
    { id: "tax", name: TAX_NAME, has_legal_wording: false },
  ]);
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      blob_path: "b",
      document_blob_path: "d",
      document_download_url: "u",
      transcription_id: "t",
      message: "ok",
    }),
  });
  global.fetch = mockFetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

const submittedFormData = () =>
  JSON.parse(mockFetch.mock.calls[0][1].body).form_data;

describe("Record page jurisdictions", () => {
  it("loads the jurisdiction options and the default jurisdiction's wording", async () => {
    render(<RecordPage />);

    await waitFor(() => {
      expect(lastFormProps.current.jurisdictions).toHaveLength(2);
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT);
    });
    expect(mockFetchContent).toHaveBeenCalledWith(IAC_NAME);
  });

  it("fetches the wording again when the jurisdiction changes", async () => {
    render(<RecordPage />);
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );

    await fillForm(completeForm({ jurisdiction: TAX_NAME }));

    await waitFor(() => {
      expect(mockFetchContent).toHaveBeenLastCalledWith(TAX_NAME);
      expect(lastFormProps.current.documentContent).toBe(TAX_CONTENT);
    });
  });

  it("submits without legal issues for a jurisdiction with no legal wording", async () => {
    render(<RecordPage />);
    await fillForm(
      completeForm({
        jurisdiction: TAX_NAME,
        hearingType: "tax_hearing",
        // Left over from a previous selection: must not be sent.
        legalIssues: ["credibility"],
      })
    );
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(TAX_CONTENT)
    );

    await submit();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(submittedFormData()).toMatchObject({
      jurisdiction: TAX_NAME,
      legalIssues: [],
    });
  });

  it("still requires a legal issue for a jurisdiction with legal wording", async () => {
    render(<RecordPage />);
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );
    await fillForm(completeForm({ legalIssues: [] }));

    await submit();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("Select at least one legal issue")
    );
  });

  it("submits the legal issues chosen for a jurisdiction with legal wording", async () => {
    render(<RecordPage />);
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );
    await fillForm(completeForm({ legalIssues: ["credibility"] }));

    await submit();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(submittedFormData().legalIssues).toEqual(["credibility"]);
  });

  it("does not submit under another jurisdiction until its own wording has loaded", async () => {
    // Tax wording never arrives; the IAC's must not stand in for it.
    mockFetchContent.mockImplementation((jurisdiction?: string) =>
      jurisdiction === TAX_NAME
        ? new Promise(() => undefined)
        : Promise.resolve(IAC_CONTENT)
    );
    render(<RecordPage />);
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );
    await fillForm(
      completeForm({ jurisdiction: TAX_NAME, legalIssues: ["credibility"] })
    );

    await submit();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "The wording for this jurisdiction has not loaded yet."
    );
  });

  it("tells the judge when another jurisdiction's wording cannot be loaded", async () => {
    mockFetchContent.mockImplementation(async (jurisdiction?: string) => {
      if (jurisdiction === TAX_NAME) throw new Error("Jurisdiction not found");
      return IAC_CONTENT;
    });
    render(<RecordPage />);
    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );

    await fillForm(completeForm({ jurisdiction: TAX_NAME }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Could not load the wording for this jurisdiction."
      )
    );
  });

  it("falls back to the default jurisdiction alone when the options cannot be loaded", async () => {
    mockFetchJurisdictions.mockRejectedValue(new Error("down"));
    render(<RecordPage />);

    await waitFor(() =>
      expect(lastFormProps.current.documentContent).toBe(IAC_CONTENT)
    );
    expect(lastFormProps.current.jurisdictions).toBeUndefined();
  });
});
