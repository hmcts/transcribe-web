import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import { getLiveDraft, putLiveDraft } from "@/lib/live-draft-api";
import {
  type AvailableTemplate,
  TemplateRefusedError,
} from "@/lib/templates-api";
import { getJudgeNameFromEmail } from "@/lib/utils";

// DIAAT-344: in a jurisdiction without the decision template, a judge chooses one of
// its uploaded templates and fills that template's own Hearing Details form, then
// submits the hearing. With none, the page works as before: copy the text out.

const mockFetchTemplates = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const lastSpeechDemoProps = vi.hoisted(() => ({ current: null as any }));
const lastEditorProps = vi.hoisted(() => ({ current: null as any }));
const mockUser = vi.hoisted(() => ({ current: null as any }));

vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule(() => "ET")
);
vi.mock("@/lib/templates-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/templates-api")>()),
  fetchAvailableTemplates: mockFetchTemplates,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams("mode=mic"),
}));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => true }));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: mockUser.current,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));
vi.mock("@/components/editor/tiptap-editor", () => ({
  default: (props: any) => {
    lastEditorProps.current = props;
    return <div>Notes editor</div>;
  },
}));
vi.mock("@/components/audio/dictation", () => ({
  SpeechDemo: (props: any) => {
    lastSpeechDemoProps.current = props;
    return <div>Transcript area</div>;
  },
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
  sections: [{ tag: "JudgmentText", label: "Judgment" }],
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
  sections: [
    { tag: "Background", label: "Background" },
    { tag: "Reasons", label: "Reasons" },
  ],
};

const LOCATION: AvailableTemplate = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Decision",
  service: null,
  fields: [
    {
      tag: "JudgeName",
      label: "Judge's name",
      type: "text",
      required: true,
      options: [],
      prefill: "judge_name",
    },
    {
      tag: "Location",
      label: "Hearing location",
      type: "dropdown",
      required: true,
      options: [
        { value: "Taylor House", label: "Taylor House" },
        { value: "Other", label: "Other" },
      ],
    },
    {
      tag: "LocationOther",
      label: "Specify location",
      type: "text",
      required: true,
      options: [],
      show_when: { tag: "Location", answers: ["Other"] },
    },
  ],
  sections: [{ tag: "Background", label: "Background" }],
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
    mockUser.current = null;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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

  it("asks a question only after the answer it follows, and drops it otherwise", async () => {
    const user = userEvent.setup();
    await renderPage([LOCATION]);
    await screen.findByText("Hearing details");
    await user.type(screen.getByLabelText(/Judge's name/), "Judge A");
    expect(screen.queryByLabelText(/Specify location/)).toBeNull();

    const chooseLocation = async (name: string) => {
      await user.click(
        screen.getByRole("combobox", { name: /Hearing location/ })
      );
      await user.click(await screen.findByRole("option", { name }));
    };
    await chooseLocation("Other");
    await user.type(screen.getByLabelText(/Specify location/), "Leeds");
    // Not asked once the answer changes: not required, and not sent.
    await chooseLocation("Taylor House");
    expect(screen.queryByLabelText(/Specify location/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().values).toEqual({
      JudgeName: "Judge A",
      Location: "Taylor House",
    });
  });

  it("starts the judge's name from who is signed in, for the judge to change", async () => {
    mockUser.current = { email: "tribunaljudge.ann.smith@ejudiciary.net" };
    const user = userEvent.setup();
    await renderPage([LOCATION]);
    await screen.findByText("Hearing details");
    const name = screen.getByLabelText(/Judge's name/) as HTMLInputElement;
    expect(name.value).toBe(
      getJudgeNameFromEmail("tribunaljudge.ann.smith@ejudiciary.net")
    );
    expect(name.value).not.toBe("");
    // A starting value is not an answer of the judge's: nothing to clear.
    expect(screen.queryByRole("button", { name: /clear answers/i })).toBeNull();

    await user.clear(name);
    await user.type(name, "Judge Smith");
    await user.click(
      screen.getByRole("combobox", { name: /Hearing location/ })
    );
    await user.click(
      await screen.findByRole("option", { name: "Taylor House" })
    );
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submitted().values.JudgeName).toBe("Judge Smith");
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

  it("keeps the answers in the draft, saved before a jurisdiction switch", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(vi.mocked(putLiveDraft)).not.toHaveBeenCalled(); // nothing to keep

    await user.type(screen.getByLabelText(/Case number/), "1234/2026");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    expect(vi.mocked(putLiveDraft)).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        template_id: JUDGMENT.id,
        values: expect.objectContaining({ Reference: "1234/2026" }),
      })
    );
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

  it("lets the judge clear answers that cannot be unanswered, and then switch", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]); // one template: no picker to change
    await screen.findByText("Hearing details");
    expect(screen.queryByRole("button", { name: "Clear answers" })).toBeNull();

    await user.click(
      screen.getByRole("combobox", { name: /First party is the/ })
    );
    await user.click(await screen.findByRole("option", { name: "Claimant" }));

    await user.click(screen.getByRole("button", { name: "Clear answers" }));
    expect(
      screen.getByRole("combobox", { name: /First party is the/ }).textContent
    ).toBe("Choose");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
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

  it("warns before the tab is closed with answers, as with dictation", async () => {
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

  it("dictates into the template's sections, chosen by their names", async () => {
    const user = userEvent.setup();
    await renderPage([REASONS]);
    await screen.findByText("Hearing details");

    const picker = screen.getByRole("group", { name: "Transcript section" });
    const background = within(picker).getByRole("button", {
      name: "Background",
    });
    const reasons = within(picker).getByRole("button", { name: "Reasons" });
    expect(background.getAttribute("aria-pressed")).toBe("true"); // the first
    expect(lastSpeechDemoProps.current.activeSection).toBe("Background");
    expect(lastSpeechDemoProps.current.showSectionNames).toBe(true);
    expect(lastSpeechDemoProps.current.sections).toEqual(REASONS.sections);

    await user.click(reasons);
    expect(reasons.getAttribute("aria-pressed")).toBe("true");
    expect(lastSpeechDemoProps.current.activeSection).toBe("Reasons");
  });

  it("has no section picker for a template with one dictated section", async () => {
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    expect(
      screen.queryByRole("group", { name: "Transcript section" })
    ).toBeNull();
    expect(lastSpeechDemoProps.current.activeSection).toBe("JudgmentText");
    expect(lastSpeechDemoProps.current.showSectionNames).toBe(false);
  });

  it("heads the blank notes with the sections, and keeps notes the judge wrote", async () => {
    await renderPage([REASONS]);
    await screen.findByText("Hearing details");
    await waitFor(() =>
      expect(lastEditorProps.current.initialContent).toBe(
        "<h3>Background</h3><ul><li><p></p></li></ul><h3>Reasons</h3><ul><li><p></p></li></ul>"
      )
    );
  });

  it("submits each section's dictation under its tag, with the notes", async () => {
    const user = userEvent.setup();
    await renderPage([REASONS]);
    await screen.findByText("Hearing details");
    const said = { speaker: "Judge", text: "Agreed.", timestamp: "10:00" };
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({ Reasons: [said] });
      lastEditorProps.current.onContentChange("<h3>Reasons</h3><p>Costs.</p>");
    });
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: /submit hearing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(submitted()).toEqual({
      template_id: REASONS.id,
      values: { Agreed: true },
      messages: { Reasons: [said] },
      notes: "<h3>Reasons</h3><p>Costs.</p>",
    });
  });

  it("restores the template, its answers and the notes with the dictation", async () => {
    const said = { speaker: "Judge", text: "Heard.", timestamp: "10:00" };
    vi.mocked(getLiveDraft).mockResolvedValueOnce({
      transcript: { Reasons: [said] },
      form_data: {
        template_id: REASONS.id,
        values: { Agreed: false },
        notes: "<p>Mine</p>",
      },
      saved_at: new Date().toISOString(),
    });
    const user = userEvent.setup();
    await renderPage([JUDGMENT, REASONS]);
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(await screen.findByText("Agreed by the parties")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "No" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(lastSpeechDemoProps.current.initialSectionedTranscript).toEqual({
      Reasons: [said],
    });
    expect(lastEditorProps.current.initialContent).toBe("<p>Mine</p>");
  });
});
