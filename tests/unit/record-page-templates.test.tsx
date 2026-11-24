import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import type { DraftTemplate } from "@/lib/record-draft";
import {
  deleteLiveDraft,
  getLiveDraft,
  putLiveDraft,
} from "@/lib/live-draft-api";
import {
  type AvailableTemplate,
  TemplateRefusedError,
} from "@/lib/templates-api";
import { waitForToastsToGo } from "../toast-helpers";

// DIAAT-344: in a jurisdiction without the decision template, a judge chooses one of
// its uploaded templates and fills that template's own Hearing Details form, then
// submits the hearing. With none, the page works as before: copy the text out.

const mockFetchTemplates = vi.hoisted(() => vi.fn());
const mockFetchRevision = vi.hoisted(() => vi.fn());
const lastSpeechDemoProps = vi.hoisted(() => ({ current: null as any }));
const mockRouterPush = vi.hoisted(() => vi.fn());
const signedIn = vi.hoisted(() => ({ user: null as { email: string } | null }));

waitForToastsToGo();

vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule(() => "ET")
);
vi.mock("@/lib/templates-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/templates-api")>()),
  fetchAvailableTemplates: mockFetchTemplates,
  fetchTemplateRevision: mockFetchRevision,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams("mode=mic"),
}));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => true }));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: signedIn.user,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));
vi.mock("@/components/editor/tiptap-editor", () => ({
  default: () => <div>Notes editor</div>,
}));
vi.mock("@/components/audio/dictation", () => ({
  SpeechDemo: (props: any) => {
    lastSpeechDemoProps.current = props;
    return <div>Transcript area</div>;
  },
}));
vi.mock("@/lib/document-content-api", () => ({
  fetchUserDocumentContent: vi.fn(),
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
  getLiveDraft: vi.fn().mockResolvedValue(null),
  putLiveDraft: vi.fn().mockResolvedValue(undefined),
  deleteLiveDraft: vi.fn().mockResolvedValue(undefined),
}));

// Radix Select and Checkbox use DOM APIs jsdom does not have.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= vi.fn(() => false);
Element.prototype.releasePointerCapture ??= vi.fn();
Element.prototype.setPointerCapture ??= vi.fn();
class ResizeObserverStub {
  observe() {
    // No-op for jsdom.
  }
  unobserve() {
    // No-op for jsdom.
  }
  disconnect() {
    // No-op for jsdom.
  }
}

const JUDGMENT: AvailableTemplate = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Judgment",
  service: "England and Wales",
  fields: [
    {
      tag: "Reference",
      label: "Case number",
      type: "text",
      required: true,
      options: [],
    },
    {
      tag: "Party1Title",
      label: "First party is the",
      type: "dropdown",
      required: true,
      options: [
        { value: "Claimant", label: "Claimant" },
        { value: "Respondent", label: "Respondent" },
      ],
    },
    {
      tag: "Party2Rep",
      label: "Second party's representative",
      type: "text",
      required: false,
      options: [],
    },
    {
      tag: "Issues",
      label: "Legal issues",
      type: "legal_issues",
      required: false,
      options: [{ value: "unfair", label: "Unfair dismissal" }],
    },
  ],
};
const REASONS: AvailableTemplate = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Reasons",
  service: null,
  fields: [
    {
      tag: "Agreed",
      label: "Agreed by the parties",
      type: "yes_no",
      required: true,
      options: [],
    },
  ],
};

const fetchMock = vi.fn();

async function renderPage(templates: AvailableTemplate[]) {
  mockFetchTemplates.mockResolvedValue(templates);
  render(
    <>
      <Toaster />
      <RecordPage />
    </>
  );
  await waitFor(() => expect(mockFetchTemplates).toHaveBeenCalled());
}

const submitted = () => JSON.parse(String(fetchMock.mock.calls[0][1].body));

describe("A judge's uploaded template (DIAAT-344)", () => {
  beforeEach(() => {
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    toast.dismiss();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    signedIn.user = null;
  });

  it("works as before without templates: no form, copy the text out", async () => {
    await renderPage([]);
    expect(screen.getByRole("button", { name: /copy text/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /submit hearing/i })
    ).toBeNull();
    expect(screen.queryByText("Hearing details")).toBeNull();
  });

  it("shows the template's own fields and submits them with its ID", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);

    expect(await screen.findByText("Hearing details")).toBeTruthy();
    expect(screen.getByText("Judgment (England and Wales)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy text/i })).toBeNull();

    await user.type(screen.getByLabelText(/Case number/), "1234/2026");
    await user.click(
      screen.getByRole("combobox", { name: /First party is the/ })
    );
    await user.click(await screen.findByRole("option", { name: "Claimant" }));
    await user.click(screen.getByLabelText("Unfair dismissal"));
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/live-transcription/submission"
    );
    const body = submitted();
    expect(body.template_id).toBe(JUDGMENT.id);
    // The optional field left empty is not sent.
    expect(body.values).toEqual({
      Reference: "1234/2026",
      Party1Title: "Claimant",
      Issues: ["unfair"],
    });
    expect(body).not.toHaveProperty("form_data");
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith("/decisions"));
  });

  it("names each required field left empty and does not submit", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");

    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    expect(await screen.findByText("Case number is required")).toBeTruthy();
    expect(screen.getByText("First party is the is required")).toBeTruthy();
    expect(
      screen.getByLabelText(/Case number/).getAttribute("aria-invalid")
    ).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // DIAAT-416: a template's dictated boxes are the sections the judge dictates into.
  const SECTIONED: AvailableTemplate = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Sectioned",
    service: null,
    fields: [
      {
        tag: "Reference",
        label: "Case number",
        type: "text",
        required: false,
        options: [],
      },
    ],
    sections: [
      { tag: "Background", label: "Background" },
      { tag: "Findings", label: "Findings of fact" },
      { tag: "Decision", label: "Decision" },
    ],
  };
  const said = (text: string) => ({
    speaker: "Judge",
    text,
    timestamp: "10:00",
  });

  it("offers the template's sections and submits each one's dictation by its box (DIAAT-416)", async () => {
    const user = userEvent.setup();
    await renderPage([SECTIONED]);
    await screen.findByText("Hearing details");

    const tabs = within(
      screen.getByRole("group", { name: "Transcript section" })
    );
    expect(tabs.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Background",
      "Findings of fact",
      "Decision",
    ]);
    expect(lastSpeechDemoProps.current.showSectionNames).toBe(true);
    const keys = lastSpeechDemoProps.current.sections.map(
      (section: { key: string }) => section.key
    );
    // Each by its box, so it keeps its dictation however they are reordered.
    expect(keys).toEqual(["box:Background", "box:Findings", "box:Decision"]);

    // What is dictated goes to the section chosen.
    await user.click(tabs.getByRole("button", { name: "Findings of fact" }));
    expect(lastSpeechDemoProps.current.activeSection).toBe("box:Findings");
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        "box:Background": [said("Heard today.")],
        "box:Decision": [said("The claim succeeds.")],
      });
    });
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = submitted();
    // Each section's dictation by its box, so it goes there alone; nothing for the
    // findings, whose box is then left out of the document.
    expect(body.sections).toEqual({
      Background: [said("Heard today.")],
      Findings: [],
      Decision: [said("The claim succeeds.")],
    });
    expect(body.messages).toEqual({
      background: [said("Heard today."), said("The claim succeeds.")],
    });
  });

  it("keeps dictation from a section the template no longer has, in its first (DIAAT-416)", async () => {
    const user = userEvent.setup();
    await renderPage([SECTIONED]);
    await screen.findByText("Hearing details");
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        background: [said("Heard today.")],
        "box:Evidence": [said("From an earlier version.")],
      });
    });
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().sections.Background).toEqual([
      said("Heard today."),
      said("From an earlier version."),
    ]);
  });

  it("keeps each box's dictation when the admin reorders the sections (DIAAT-416)", async () => {
    const user = userEvent.setup();
    const reordered = [
      SECTIONED.sections?.[1],
      SECTIONED.sections?.[0],
      SECTIONED.sections?.[2],
    ].filter((section) => section !== undefined);
    await renderPage([{ ...SECTIONED, sections: reordered }]);
    await screen.findByText("Hearing details");
    // As a draft saved before the reorder would bring it back.
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        "box:Background": [said("Heard today.")],
        "box:Findings": [said("I find it credible.")],
      });
    });
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().sections).toEqual({
      Findings: [said("I find it credible.")],
      Background: [said("Heard today.")],
      Decision: [],
    });
  });

  it("puts what was dictated before the templates loaded in the first section (DIAAT-416)", async () => {
    const user = userEvent.setup();
    await renderPage([SECTIONED]);
    await screen.findByText("Hearing details");
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        background: [said("Said while the templates loaded.")],
        "box:Background": [said("Heard today.")],
      });
    });
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().sections.Background).toEqual([
      said("Said while the templates loaded."),
      said("Heard today."),
    ]);
  });

  it("shows no sections for a template with one dictated box, and submits as before (DIAAT-416)", async () => {
    const user = userEvent.setup();
    await renderPage([
      { ...SECTIONED, sections: [{ tag: "Decision", label: "Decision" }] },
    ]);
    await screen.findByText("Hearing details");
    expect(
      screen.queryByRole("group", { name: "Transcript section" })
    ).toBeNull();
    expect(lastSpeechDemoProps.current.showSectionNames).toBe(false);
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        background: [said("The claim succeeds.")],
      });
    });
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = submitted();
    expect(body).not.toHaveProperty("sections");
    expect(body.messages).toEqual({
      background: [said("The claim succeeds.")],
    });
  });

  it("lets the judge choose between the jurisdiction's templates", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT, REASONS]);
    await screen.findByText("Hearing details");

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));

    expect(screen.queryByLabelText(/Case number/)).toBeNull();
    const agreed = screen.getByRole("group", { name: /Agreed by the parties/ });
    await user.click(within(agreed).getByLabelText("No"));
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted()).toMatchObject({
      template_id: REASONS.id,
      values: { Agreed: false },
    });
  });

  it("saves the answers in the draft before a jurisdiction switch (DIAAT-414)", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(putLiveDraft).not.toHaveBeenCalled(); // nothing to save

    await user.type(screen.getByLabelText(/Case number/), "1234/2026");
    vi.mocked(putLiveDraft).mockClear();
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(putLiveDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(putLiveDraft).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        template: { id: JUDGMENT.id, values: { Reference: "1234/2026" } },
      })
    );
  });

  it("keeps a restored template's answers in the draft while the templates load (DIAAT-414)", async () => {
    mockFetchTemplates.mockReturnValue(new Promise(() => undefined)); // still loading
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: {
        background: [{ speaker: "Judge", text: "Heard today", timestamp: "00:01" }],
        evidence: [],
        facts: [],
      },
      form_data: { template: { id: JUDGMENT.id, values: { Reference: "1/2026" } } },
      saved_at: new Date().toISOString(),
    });
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(putLiveDraft).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        template: { id: JUDGMENT.id, values: { Reference: "1/2026" } },
      })
    );
  });

  it("fits restored answers to the template as it is now (DIAAT-414)", async () => {
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { background: [], evidence: [], facts: [] },
      form_data: {
        template: {
          id: JUDGMENT.id,
          values: { Reference: "1/2026", Issues: ["removed"] },
        },
      },
      saved_at: new Date().toISOString(),
    });
    await renderPage([JUDGMENT]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Case number/) as HTMLInputElement).value
      ).toBe("1/2026")
    );
    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(putLiveDraft).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        template: { id: JUDGMENT.id, values: { Reference: "1/2026" } },
      })
    );
  });

  it("keeps answers for a template no longer offered, rather than deleting them (DIAAT-414)", async () => {
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { background: [], evidence: [], facts: [] },
      form_data: {
        template: { id: "gone", values: { Reference: "1/2026" } },
      },
      saved_at: new Date().toISOString(),
    });
    await renderPage([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(/no longer offered\. They stay saved/)
    ).toBeTruthy();
    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(putLiveDraft).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        template: { id: "gone", values: { Reference: "1/2026" } },
      })
    );
    expect(deleteLiveDraft).not.toHaveBeenCalled();
  });

  it("asks before another template clears answers kept for one no longer offered (DIAAT-414)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { background: [], evidence: [], facts: [] },
      form_data: { template: { id: "gone", values: { Reference: "1/2026" } } },
      saved_at: new Date().toISOString(),
    });
    await renderPage([JUDGMENT, REASONS]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText(/no longer offered\. They stay saved/);

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/saved answers for a template no longer offered/)
    );
    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(putLiveDraft).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        template: { id: "gone", values: { Reference: "1/2026" } },
      })
    );
    confirm.mockRestore();
  });

  it("clears the answers when the judge chooses another template", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true); // agrees
    const user = userEvent.setup();
    await renderPage([JUDGMENT, REASONS]);
    await screen.findByText("Hearing details");
    await user.type(screen.getByLabelText(/Case number/), "1234/2026");

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));
    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: /Judgment/ }));

    expect(
      (screen.getByLabelText(/Case number/) as HTMLInputElement).value
    ).toBe("");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    confirm.mockRestore();
  });

  it("lets the judge clear answers that cannot be unanswered, and the draft with them", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]); // one template: no picker to change
    await screen.findByText("Hearing details");
    expect(screen.queryByRole("button", { name: "Clear answers" })).toBeNull();

    await user.click(
      screen.getByRole("combobox", { name: /First party is the/ })
    );
    await user.click(await screen.findByRole("option", { name: "Claimant" }));
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(putLiveDraft).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear answers" }));
    expect(
      screen.getByRole("combobox", { name: /First party is the/ }).textContent
    ).toBe("Choose");
    // Nothing left of the judge's: the saved draft goes too.
    await waitFor(() => expect(deleteLiveDraft).toHaveBeenCalled());
  });

  it("handles boxes tagged like Object's own properties as ordinary fields", async () => {
    const user = userEvent.setup();
    await renderPage([
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Odd tags",
        service: null,
        fields: [
          {
            tag: "__proto__",
            label: "Case number",
            type: "text",
            required: true,
            options: [],
          },
          {
            tag: "constructor",
            label: "Outcome",
            type: "dropdown",
            required: true,
            options: [{ value: "Allowed", label: "Allowed" }],
          },
        ],
      },
    ]);
    await screen.findByText("Hearing details");

    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    expect(await screen.findByText("Case number is required")).toBeTruthy();
    expect(screen.getByText("Outcome is required")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Case number/), "1/2026");
    await user.click(screen.getByRole("combobox", { name: /Outcome/ }));
    await user.click(await screen.findByRole("option", { name: "Allowed" }));
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const raw = String(fetchMock.mock.calls[0][1].body);
    expect(raw).toContain(
      '"values":{"__proto__":"1/2026","constructor":"Allowed"}'
    );
  });

  it("warns before the tab is closed with answers, as a last save could be cut off", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    await user.type(screen.getByLabelText(/Case number/), "1");
    expect(leave()).toBe(true);
  });

  it("says when the templates could not be loaded, and tries again", async () => {
    const user = userEvent.setup();
    mockFetchTemplates.mockRejectedValueOnce(
      new TemplateRefusedError("Server error", [], 500)
    );
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    expect(
      await screen.findByText(/templates could not be loaded/)
    ).toBeTruthy();
    expect(screen.queryByText("Hearing details")).toBeNull();
    mockFetchTemplates.mockResolvedValue([JUDGMENT]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Hearing details")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText(/templates could not be loaded/)).toBeNull()
    );
  });

  it("works as before, without saying anything, against an API with no templates", async () => {
    mockFetchTemplates.mockRejectedValue(
      new TemplateRefusedError("Not Found", [], 404)
    );
    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );
    await waitFor(() => expect(mockFetchTemplates).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /copy text/i })).toBeTruthy();
    expect(screen.queryByText(/templates could not be loaded/)).toBeNull();
  });

  it("ties each field's error to it even when its tag has spaces", async () => {
    const user = userEvent.setup();
    await renderPage([
      {
        ...JUDGMENT,
        fields: [
          {
            tag: "Case Number",
            label: "Case number",
            type: "text",
            required: true,
            options: [],
          },
        ],
      },
    ]);
    await screen.findByText("Hearing details");
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await screen.findByText("Case number is required");

    const ids =
      screen
        .getByLabelText(/Case number/)
        .getAttribute("aria-describedby")
        ?.split(" ") ?? [];
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0])?.textContent).toBe(
      "Case number is required"
    );
  });

  it("leaves by an in-app link without asking, the answers saved as typed (DIAAT-414)", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    const help = document.createElement("a");
    help.href = "/help";
    help.textContent = "Help";
    document.body.appendChild(help);
    let reached = false;
    help.addEventListener("click", (event) => {
      reached = true;
      event.preventDefault(); // jsdom cannot navigate
    });
    try {
      await user.type(screen.getByLabelText(/Case number/), "1");
      await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), {
        timeout: 3000,
      });
      help.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      );
      expect(reached).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      help.remove();
      confirm.mockRestore();
    }
  });

  it("asks before another template clears the answers", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPage([JUDGMENT, REASONS]);
    await screen.findByText("Hearing details");
    await user.type(screen.getByLabelText(/Case number/), "1234");

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/answers to this one will be cleared/)
    );
    expect(
      (screen.getByLabelText(/Case number/) as HTMLInputElement).value
    ).toBe("1234");

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));
    expect(screen.queryByLabelText(/Case number/)).toBeNull();
    confirm.mockRestore();
  });

  it("shows the server's reason when the values are refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        detail: {
          code: "template_values_invalid",
          message:
            "The hearing details do not fit the template. “Case number” is too long.",
          problems: ["“Case number” is too long."],
        },
      }),
    });
    await renderPage([REASONS]);
    await screen.findByText("Hearing details");
    await user.click(
      within(screen.getByRole("group", { name: /Agreed/ })).getByLabelText(
        "Yes"
      )
    );
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    expect(
      await screen.findByText(/The hearing details do not fit the template/)
    ).toBeTruthy();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // DIAAT-339: a draft keeps the version of the template it was started with.

  const STARTED: AvailableTemplate = { ...JUDGMENT, revision: "r1" };
  const CHANGED: AvailableTemplate = {
    ...JUDGMENT,
    revision: "r2",
    fields: [
      { ...JUDGMENT.fields[0], label: "Claim number" },
      ...JUDGMENT.fields.slice(1),
      {
        tag: "Costs",
        label: "Costs order",
        type: "text",
        required: true,
        options: [],
      },
    ],
  };

  function draftWith(template: DraftTemplate) {
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { background: [], evidence: [], facts: [] },
      form_data: { template },
      saved_at: new Date().toISOString(),
    });
  }

  it("names the version of the template a new document is made from (DIAAT-339)", async () => {
    const user = userEvent.setup();
    await renderPage([STARTED, REASONS]);
    await user.type(await screen.findByLabelText(/Case number/), "1/2026");
    await user.click(
      screen.getByRole("combobox", { name: /First party is the/ })
    );
    await user.click(await screen.findByRole("option", { name: "Claimant" }));

    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(vi.mocked(putLiveDraft).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        template: {
          id: JUDGMENT.id,
          values: { Reference: "1/2026", Party1Title: "Claimant" },
          revision: "r1",
        },
      })
    );
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted()).toMatchObject({
      template_id: JUDGMENT.id,
      template_revision: "r1",
    });
    expect(mockFetchRevision).not.toHaveBeenCalled();
  });

  it("finishes a restored draft with the template as it started, once it has changed (DIAAT-339)", async () => {
    mockFetchRevision.mockResolvedValue(STARTED);
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026", Party1Title: "Claimant" },
      revision: "r1",
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(/has changed since you started this draft/)
    ).toBeTruthy();
    expect(mockFetchRevision).toHaveBeenCalledWith(JUDGMENT.id, "r1");
    expect(
      (screen.getByLabelText(/Case number/) as HTMLInputElement).value
    ).toBe("1/2026");
    expect(screen.queryByLabelText(/Costs order/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted()).toMatchObject({
      template_id: JUDGMENT.id,
      template_revision: "r1",
      values: { Reference: "1/2026", Party1Title: "Claimant" },
    });
  });

  it("finishes a restored draft with a template no longer offered for new documents (DIAAT-339)", async () => {
    mockFetchRevision.mockResolvedValue(STARTED);
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026", Party1Title: "Claimant" },
      revision: "r1",
    });
    await renderPage([REASONS]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(/no longer offered for new documents/)
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Case number/) as HTMLInputElement).value
      ).toBe("1/2026")
    );
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted()).toMatchObject({
      template_id: JUDGMENT.id,
      template_revision: "r1",
    });
  });

  it("offers the started version only until the judge chooses another template (DIAAT-339)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchRevision.mockResolvedValue(STARTED);
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026" },
      revision: "r1",
    });
    await renderPage([REASONS]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText(/no longer offered for new documents/);

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Reasons" }));
    // Reasons is all there is to choose now: no list, and no Judgment.
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Template" })).toBeNull()
    );
    expect(screen.queryByLabelText(/Case number/)).toBeNull();
  });

  it("falls back to the template as it is now when its started version is not given (DIAAT-339)", async () => {
    mockFetchRevision.mockRejectedValue(
      new TemplateRefusedError("Not available", [], 404)
    );
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026" },
      revision: "r1",
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Claim number/) as HTMLInputElement).value
      ).toBe("1/2026")
    );
    expect(screen.getByLabelText(/Costs order/)).toBeTruthy();
  });

  it("waits for the started version before answers or a submission (DIAAT-339)", async () => {
    mockFetchRevision.mockReturnValue(new Promise(() => undefined)); // still loading
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026", Party1Title: "Claimant" },
      revision: "r1",
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(
        "Loading the template this draft was started with"
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Claim number/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    expect(
      await screen.findByText(/wait for the draft's template to load/)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // The draft keeps the version and answers it started with meanwhile.
    await waitFor(() => expect(putLiveDraft).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(vi.mocked(putLiveDraft).mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        template: {
          id: JUDGMENT.id,
          values: { Reference: "1/2026", Party1Title: "Claimant" },
          revision: "r1",
        },
      })
    );
  });

  it("keeps the draft's version when it could not be loaded, and tries again (DIAAT-339)", async () => {
    mockFetchRevision
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(STARTED);
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026" },
      revision: "r1",
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(
        "The template this draft was started with could not be loaded, so Hearing details is not shown."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Costs order/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Case number/) as HTMLInputElement).value
      ).toBe("1/2026")
    );
    expect(mockFetchRevision).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText(/Costs order/)).toBeNull();
  });

  it("shows the wait for a draft's template no longer offered, with none offered now (DIAAT-339)", async () => {
    mockFetchRevision.mockReturnValue(new Promise(() => undefined)); // still loading
    draftWith({
      id: JUDGMENT.id,
      values: { Reference: "1/2026" },
      revision: "r1",
    });
    await renderPage([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByText(
        "Loading the template this draft was started with"
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy text/i })).toBeNull();
  });

  it("keeps the draft's own sections while its template loads (DIAAT-339)", async () => {
    mockFetchRevision.mockReturnValue(new Promise(() => undefined)); // still loading
    const said = (text: string) => [
      { speaker: "Judge", text, timestamp: "00:01" },
    ];
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: {
        "box:Facts": said("Facts."),
        "box:Decision": said("Allowed."),
      },
      form_data: { template: { id: JUDGMENT.id, values: {}, revision: "r1" } },
      saved_at: new Date().toISOString(),
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        lastSpeechDemoProps.current.sections.map((s: { key: string }) => s.key)
      ).toEqual(["box:Facts", "box:Decision"])
    );
  });

  it("keeps a draft's one dictated section while its template loads (DIAAT-339)", async () => {
    mockFetchRevision.mockReturnValue(new Promise(() => undefined)); // still loading
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: {
        "box:Facts": [{ speaker: "Judge", text: "Facts.", timestamp: "00:01" }],
      },
      form_data: { template: { id: JUDGMENT.id, values: {}, revision: "r1" } },
      saved_at: new Date().toISOString(),
    });
    await renderPage([CHANGED]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        lastSpeechDemoProps.current.sections.map((s: { key: string }) => s.key)
      ).toEqual(["box:Facts"])
    );
  });

  // DIAAT-340: the jurisdiction's own case details form.
  const CASE_DETAILS: AvailableTemplate = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Case details",
    service: null,
    fields: [
      {
        tag: "Judge",
        label: "First judge",
        type: "text",
        required: true,
        options: [],
        prefill: "judge_name",
      },
      {
        tag: "HearingDate",
        label: "Hearing date",
        type: "date",
        required: true,
        options: [],
      },
    ],
  };

  it("fills in the signed-in judge's name, which they can change (DIAAT-340)", async () => {
    signedIn.user = { email: "DDJ.Gareth.McMahon@ejudiciary.net" };
    const user = userEvent.setup();
    await renderPage([CASE_DETAILS]);
    const judge = (await screen.findByLabelText(
      /First judge/
    )) as HTMLInputElement;

    expect(judge.value).toBe("G McMahon");
    // Not an answer of theirs: nothing to save, nothing to clear.
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(putLiveDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /clear answers/i })).toBeNull();

    await user.type(
      screen.getByRole("textbox", { name: /Hearing date/ }),
      "27/03/2026"
    );
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().values).toEqual({
      Judge: "G McMahon",
      HearingDate: "2026-03-27",
    });

    await user.clear(judge);
    await user.type(judge, "B Jones");
    expect(judge.value).toBe("B Jones");
    await user.clear(judge);
    // Emptied, it stays empty: the judge's own answer, and required.
    expect(judge.value).toBe("");
  });

  it("tells the judge the date format when a typed date is not one (DIAAT-340)", async () => {
    const user = userEvent.setup();
    await renderPage([CASE_DETAILS]);
    const date = (await screen.findByRole("textbox", {
      name: /Hearing date/,
    })) as HTMLInputElement;
    const message = "Enter Hearing date as DD/MM/YYYY, for example 27/03/2026";

    await user.type(date, "31/02/2026");
    expect(screen.queryByText(message)).toBeNull(); // not while typing
    await user.tab();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(date.getAttribute("aria-invalid")).toBe("true");
    await user.type(screen.getByLabelText(/First judge/), "G McMahon");
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(date);
    await user.type(date, "3-4-2026");
    await user.tab();
    expect(date.value).toBe("03/04/2026");
    expect(screen.queryByText(message)).toBeNull();
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().values.HearingDate).toBe("2026-04-03");
  });

  it("does not call a blank date restored from a draft malformed (DIAAT-340)", async () => {
    const optional: AvailableTemplate = {
      ...CASE_DETAILS,
      fields: CASE_DETAILS.fields.map((f) =>
        f.tag === "HearingDate" ? { ...f, required: false } : f
      ),
    };
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { background: [], evidence: [], facts: [] },
      form_data: {
        template: {
          id: optional.id,
          values: { Judge: "B Jones", HearingDate: " " },
        },
      },
      saved_at: new Date().toISOString(),
    });
    await renderPage([optional]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    const date = await screen.findByRole("textbox", { name: /Hearing date/ });

    await user.click(date);
    await user.tab();
    expect(screen.queryByText(/as DD\/MM\/YYYY/)).toBeNull();
    expect(date.getAttribute("aria-invalid")).toBeNull();
  });

  it("names the calendar a date can be picked from (DIAAT-340)", async () => {
    const user = userEvent.setup();
    await renderPage([CASE_DETAILS]);

    await user.click(
      await screen.findByRole("button", {
        name: "Choose Hearing date from a calendar",
      })
    );
    expect(
      await screen.findByRole("dialog", { name: "Hearing date calendar" })
    ).toBeTruthy();
  });
});
