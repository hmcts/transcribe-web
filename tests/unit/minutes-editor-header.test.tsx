import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MinutesEditorHeader from "@/components/minutes/minutes-editor-header";

vi.mock("@/components/ui/copy-button", () => ({
  default: ({ onCopy }: { onCopy: () => void }) => (
    <button type="button" onClick={onCopy}>
      Copy
    </button>
  ),
}));

vi.mock("@/components/minutes/rating-dialog", () => ({
  default: () => <div>RatingDialog</div>,
}));

const baseProps = {
  selectedTemplate: null,
  onTemplateChange: vi.fn(),
  isGenerating: false,
  templatesLoading: false,
  templatesError: null,
  templates: [],
  currentVersion: null,
  isEditing: false,
  onEditClick: vi.fn(),
  onSaveEdit: vi.fn(),
  generateAIMinutes: vi.fn(),
  onCopy: vi.fn(),
  rating: null,
  ratingComment: null,
  onRatingSubmit: vi.fn(),
  isRatingDialogOpen: false,
  setIsRatingDialogOpen: vi.fn(),
  onAIEdit: vi.fn(),
  hasTranscriptionErrors: false,
};

describe("MinutesEditorHeader", () => {
  it("renders the template select trigger", () => {
    const { getByText } = render(<MinutesEditorHeader {...baseProps} />);
    expect(getByText("Select a template")).toBeTruthy();
  });

  it("shows loading state in select trigger", () => {
    const { getByText } = render(
      <MinutesEditorHeader {...baseProps} templatesLoading={true} />
    );
    expect(getByText("Loading...")).toBeTruthy();
  });

  it("shows 'Generate Summary' when template selected, no current version", () => {
    const template = {
      name: "General" as any,
      description: "Desc",
      category: "general",
    } as any;
    const { getByText } = render(
      <MinutesEditorHeader
        {...baseProps}
        selectedTemplate={template}
        currentVersion={null}
      />
    );
    expect(getByText("Generate Summary")).toBeTruthy();
  });

  it("calls generateAIMinutes when Generate Summary is clicked", () => {
    const template = {
      name: "General" as any,
      description: "Desc",
      category: "general",
    } as any;
    const generateAIMinutes = vi.fn();
    const { getByText } = render(
      <MinutesEditorHeader
        {...baseProps}
        selectedTemplate={template}
        generateAIMinutes={generateAIMinutes}
        currentVersion={null}
      />
    );
    fireEvent.click(getByText("Generate Summary"));
    expect(generateAIMinutes).toHaveBeenCalledWith(template);
  });

  it("shows 'Generating...' when isGenerating is true", () => {
    const { getByText } = render(
      <MinutesEditorHeader {...baseProps} isGenerating={true} />
    );
    expect(getByText("Generating...")).toBeTruthy();
  });

  it("shows Edit and AI Edit buttons when currentVersion exists", () => {
    const currentVersion = { html_content: "<p>content</p>" } as any;
    const { container } = render(
      <MinutesEditorHeader {...baseProps} currentVersion={currentVersion} />
    );
    expect(container.textContent).toContain("AI Edit");
  });

  it("shows Save button when isEditing is true", () => {
    const currentVersion = { html_content: "<p>content</p>" } as any;
    const { container } = render(
      <MinutesEditorHeader
        {...baseProps}
        currentVersion={currentVersion}
        isEditing={true}
      />
    );
    expect(container.textContent).toContain("Save");
  });

  it("calls onEditClick when Manual Edit is clicked", () => {
    const onEditClick = vi.fn();
    const currentVersion = { html_content: "<p>content</p>" } as any;
    const { getByText } = render(
      <MinutesEditorHeader
        {...baseProps}
        currentVersion={currentVersion}
        onEditClick={onEditClick}
      />
    );
    fireEvent.click(getByText("Manual Edit"));
    expect(onEditClick).toHaveBeenCalled();
  });

  it("shows AI Edit inline panel and handles quick suggestions", () => {
    const currentVersion = { html_content: "<p>content</p>" } as any;
    const { getByText, queryByText } = render(
      <MinutesEditorHeader {...baseProps} currentVersion={currentVersion} />
    );

    // Panel not shown initially
    expect(queryByText("What would you like to change?")).toBeNull();

    // Click AI Edit to open inline panel
    fireEvent.click(getByText("AI Edit"));
    expect(getByText("What would you like to change?")).toBeTruthy();
    expect(getByText("+ Make more concise")).toBeTruthy();
  });

  it("calls onAIEdit when Update button is clicked with instructions", () => {
    const onAIEdit = vi.fn();
    const currentVersion = { html_content: "<p>content</p>" } as any;
    const { getByText, getByPlaceholderText } = render(
      <MinutesEditorHeader
        {...baseProps}
        currentVersion={currentVersion}
        onAIEdit={onAIEdit}
      />
    );

    fireEvent.click(getByText("AI Edit"));
    const textarea = getByPlaceholderText(
      "Describe the changes you want to make"
    );
    fireEvent.change(textarea, { target: { value: "Make it shorter" } });
    fireEvent.click(getByText("Update"));

    expect(onAIEdit).toHaveBeenCalledWith("Make it shorter");
  });

  it("hides Generate Summary when hasTranscriptionErrors is true", () => {
    const template = {
      name: "General" as any,
      description: "Desc",
      category: "general",
    } as any;
    const { queryByText } = render(
      <MinutesEditorHeader
        {...baseProps}
        selectedTemplate={template}
        currentVersion={null}
        hasTranscriptionErrors={true}
      />
    );
    expect(queryByText("Generate Summary")).toBeNull();
  });
});
