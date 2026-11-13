import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import {
  type AvailableTemplate,
  TemplateRefusedError,
} from "@/lib/templates-api";

// DIAAT-344: in a jurisdiction without the decision template, a judge chooses one of
// its uploaded templates and fills that template's own Hearing Details form, then
// submits the hearing. With none, the page works as before: copy the text out.

const mockFetchTemplates = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

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

  it("stops a jurisdiction switch while it has answers, which drafts do not keep", async () => {
    const user = userEvent.setup();
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();

    await user.type(screen.getByLabelText(/Case number/), "1234/2026");
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved",
    });

    await user.clear(screen.getByLabelText(/Case number/));
    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
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
    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved",
    });

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

  it("warns before the tab is closed with answers, which drafts do not keep", async () => {
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

  it("asks before an in-app link or Back leaves answers behind", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    await renderPage([JUDGMENT]);
    await screen.findByText("Hearing details");
    const help = document.createElement("a");
    help.href = "/help";
    help.textContent = "Help";
    document.body.appendChild(help);
    // Whether the click got through to the link (the guard stops it before);
    // jsdom cannot navigate, so the link itself goes nowhere.
    let reached = false;
    help.addEventListener("click", (event) => {
      reached = true;
      event.preventDefault();
    });
    const blocked = () => {
      reached = false;
      help.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      );
      return !reached;
    };
    try {
      confirm.mockReturnValue(false);
      expect(blocked()).toBe(false); // nothing to lose: the link is followed
      expect(confirm).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText(/Case number/), "1");
      expect(blocked()).toBe(true); // stayed
      expect(confirm).toHaveBeenLastCalledWith(
        expect.stringMatching(/answers will be lost/)
      );
      confirm.mockReturnValue(true);
      expect(blocked()).toBe(false); // left

      const push = vi.spyOn(window.history, "pushState");
      const back = vi
        .spyOn(window.history, "back")
        .mockImplementation(() => undefined);
      confirm.mockReturnValue(false);
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(push).toHaveBeenCalled(); // stays on the page
      expect(back).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(back).toHaveBeenCalledTimes(1); // past the guard entry
      push.mockRestore();
      back.mockRestore();
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
});
