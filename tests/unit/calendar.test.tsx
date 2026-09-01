import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Calendar } from "@/components/ui/calendar";

describe("Calendar layout", () => {
  it("applies w-9 to all 7 weekday header cells", () => {
    const { container } = render(<Calendar mode="single" />);
    const weekdayCells = container.querySelectorAll("th");
    expect(weekdayCells.length).toBe(7);
    weekdayCells.forEach((th) => {
      expect(th.className).toContain("w-9");
    });
  });

  it("applies w-9 to day cells in the first week row", () => {
    const { container } = render(<Calendar mode="single" />);
    const firstWeekRow = container.querySelector("tbody tr");
    expect(firstWeekRow).not.toBeNull();
    const dayCells = (firstWeekRow as Element).querySelectorAll("td");
    expect(dayCells.length).toBe(7);
    dayCells.forEach((td) => {
      expect(td.className).toContain("w-9");
    });
  });

  it("does not apply flex-1 to weekday or day cells", () => {
    const { container } = render(<Calendar mode="single" />);
    const weekdayCells = container.querySelectorAll("th");
    const dayCells = container.querySelectorAll("td");
    weekdayCells.forEach((th) => {
      expect(th.className).not.toContain("flex-1");
    });
    dayCells.forEach((td) => {
      expect(td.className).not.toContain("flex-1");
    });
  });

  it("applies gap-2 to weekday header row and week rows for visible spacing", () => {
    const { container } = render(<Calendar mode="single" />);
    const thead = container.querySelector("thead tr");
    expect(thead).not.toBeNull();
    expect((thead as Element).className).toContain("gap-2");

    const weekRows = container.querySelectorAll("tbody tr");
    weekRows.forEach((tr) => {
      expect(tr.className).toContain("gap-2");
    });
  });
});
