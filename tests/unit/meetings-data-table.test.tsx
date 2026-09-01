import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetingsDataTable } from "@/components/meetings-table/data-table";
import type { MeetingRow } from "@/components/meetings-table/types";

const meetings: MeetingRow[] = [
  {
    id: "1",
    title: "Budget hearing",
    createdDatetime: "2026-03-20T10:00:00Z",
    createdLabel: "20 March 2026",
    createdExactLabel: "20/03/2026 at 10:00",
    createdTimestamp: new Date("2026-03-20T10:00:00Z").getTime(),
    hearingTypes: ["Case management"],
    isDone: false,
    documentBlobPath: null,
    source: {
      id: "1",
      title: "Budget hearing",
      created_datetime: "2026-03-20T10:00:00Z",
      is_showable_in_ui: true,
      tags: ["Case management"],
    },
  },
  {
    id: "2",
    title: "Appeal hearing",
    createdDatetime: "2026-03-18T09:30:00Z",
    createdLabel: "18 March 2026",
    createdExactLabel: "18/03/2026 at 09:30",
    createdTimestamp: new Date("2026-03-18T09:30:00Z").getTime(),
    hearingTypes: ["Appeal"],
    isDone: true,
    documentBlobPath: null,
    source: {
      id: "2",
      title: "Appeal hearing",
      created_datetime: "2026-03-18T09:30:00Z",
      is_showable_in_ui: true,
      tags: ["Appeal", "Done"],
    },
  },
];

describe("MeetingsDataTable accessibility", () => {
  it("provides labelled search and contextual filters for recent recordings", () => {
    render(
      <MeetingsDataTable
        data={meetings}
        onOpenMeeting={vi.fn()}
        onRenameMeeting={vi.fn()}
        onDeleteMeeting={vi.fn()}
        onDownloadDocument={vi.fn()}
        onToggleDone={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkMarkDone={vi.fn()}
        isBulkDeleting={false}
        isBulkMarkingDone={false}
      />
    );

    expect(
      screen
        .getByLabelText("Search recent recordings")
        .getAttribute("aria-controls")
    ).toBe("recent-recordings-table");
    expect(
      screen.getByRole("combobox", {
        name: "Filter recent recordings by hearing type",
      })
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", {
          name: "Show all recent recordings",
        })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", {
          name: "Filter recent recordings to today",
        })
        .getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("announces result updates when search changes the recent recordings table", () => {
    render(
      <MeetingsDataTable
        data={meetings}
        onOpenMeeting={vi.fn()}
        onRenameMeeting={vi.fn()}
        onDeleteMeeting={vi.fn()}
        onDownloadDocument={vi.fn()}
        onToggleDone={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkMarkDone={vi.fn()}
        isBulkDeleting={false}
        isBulkMarkingDone={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Search recent recordings"), {
      target: { value: "Budget" },
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Recent recordings updated. Showing 1 of 2 recordings. Search term: Budget."
    );
  });
});
