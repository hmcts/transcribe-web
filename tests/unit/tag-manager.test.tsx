import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database", () => ({
  getTranscriptionTags: vi.fn(),
  addTagToTranscription: vi.fn(),
  removeTagFromTranscription: vi.fn(),
  getAllTranscriptionMetadata: vi.fn(),
}));

import TagManager from "@/components/minutes/tag-manager";
import {
  addTagToTranscription,
  getAllTranscriptionMetadata,
  getTranscriptionTags,
  removeTagFromTranscription,
} from "@/lib/database";

const TAGS = [
  { id: "1", name: "urgent", created_datetime: "", updated_datetime: "" },
  { id: "2", name: "review", created_datetime: "", updated_datetime: "" },
];

describe("TagManager", () => {
  it("renders tags loaded from the database", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue(TAGS);
    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => expect(screen.getByText("urgent")).toBeTruthy());
    expect(screen.getByText("review")).toBeTruthy();
  });

  it("renders an add tag button when not adding", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue([]);
    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => expect(screen.getByText("Add tag")).toBeTruthy());
  });

  it("shows input when Add tag is clicked", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue([]);
    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => screen.getByText("Add tag"));
    fireEvent.click(screen.getByText("Add tag"));
    expect(screen.getByPlaceholderText("Tag name")).toBeTruthy();
  });

  it("calls addTagToTranscription on Enter and refreshes", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue([]);
    vi.mocked(addTagToTranscription).mockResolvedValue({
      id: "3",
      name: "new",
    } as any);
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => screen.getByText("Add tag"));
    fireEvent.click(screen.getByText("Add tag"));

    const input = screen.getByPlaceholderText("Tag name");
    fireEvent.change(input, { target: { value: "newtag" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(addTagToTranscription).toHaveBeenCalledWith("t1", "newtag");
  });

  it("closes add input on Escape without saving", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue([]);
    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => screen.getByText("Add tag"));
    fireEvent.click(screen.getByText("Add tag"));

    fireEvent.keyDown(screen.getByPlaceholderText("Tag name"), {
      key: "Escape",
    });
    await waitFor(() => expect(screen.getByText("Add tag")).toBeTruthy());
    expect(addTagToTranscription).not.toHaveBeenCalled();
  });

  it("calls removeTagFromTranscription when remove button is clicked", async () => {
    vi.mocked(getTranscriptionTags).mockResolvedValue(TAGS);
    vi.mocked(removeTagFromTranscription).mockResolvedValue(undefined);
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    render(<TagManager transcriptionId="t1" />);
    await waitFor(() => screen.getByText("urgent"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove tag urgent"));
    });

    expect(removeTagFromTranscription).toHaveBeenCalledWith("t1", "urgent");
  });
});
